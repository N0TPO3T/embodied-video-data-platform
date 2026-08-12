import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "../database/entities/media-segment.entity.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import {
  MEDIA_COMMAND_RUNNER,
  type MediaCommandRunnerProvider,
} from "./media.tokens.js";

export class TerminalMediaError extends Error {}
export class RetryableMediaError extends Error {}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

@Injectable()
export class MediaAnalysisService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SubmissionEntity)
    private readonly submissions: Repository<SubmissionEntity>,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Inject(MEDIA_COMMAND_RUNNER)
    private readonly runner: MediaCommandRunnerProvider,
  ) {}

  async process(input: { submissionId: string }): Promise<void> {
    const submission = await this.submissions.findOneBy({
      id: input.submissionId,
    });
    if (!submission) {
      throw new TerminalMediaError("视频提交不存在");
    }
    if (submission.uploadStatus !== "uploaded") {
      throw new TerminalMediaError("视频对象尚未完成上传");
    }

    submission.processingStatus = "probing";
    submission.failureCode = null;
    submission.failureMessage = null;
    await this.submissions.save(submission);

    const directory = await mkdtemp(join(tmpdir(), "evdp-media-"));
    const mediaPath = join(
      directory,
      `original${extname(submission.originalFileName).toLowerCase()}`,
    );
    try {
      await this.storage.downloadObject({
        objectKey: submission.objectKey,
        destinationPath: mediaPath,
      });
      const checksum = await sha256File(mediaPath);
      if (checksum !== submission.checksumSha256) {
        throw new TerminalMediaError("视频 SHA-256 校验失败");
      }
      const result = await this.runner.analyze(mediaPath);
      if (
        String(result.metadata.sizeBytes) !== submission.expectedSizeBytes
      ) {
        throw new TerminalMediaError("媒体文件大小与上传记录不一致");
      }

      await this.dataSource.transaction(async (manager) => {
        await manager
          .getRepository(MediaMetadataEntity)
          .save({
            submissionId: submission.id,
            durationSeconds: result.metadata.durationSeconds.toFixed(3),
            width: result.metadata.width,
            height: result.metadata.height,
            frameRate: result.metadata.frameRate.toFixed(3),
            codec: result.metadata.codec,
            bitrate:
              result.metadata.bitrate === null
                ? null
                : String(result.metadata.bitrate),
            sizeBytes: String(result.metadata.sizeBytes),
            rawProbe: result.metadata.rawProbe,
          });
        const segments = manager.getRepository(MediaSegmentEntity);
        await segments.delete({ submissionId: submission.id });
        if (result.segments.length > 0) {
          await segments.save(
            result.segments.map((segment) => ({
              id: `SEG-${randomUUID()}`,
              submissionId: submission.id,
              type: segment.type,
              startSeconds: segment.startSeconds.toFixed(3),
              endSeconds: segment.endSeconds.toFixed(3),
              invalid: true,
              details: { source: "ffmpeg" },
            })),
          );
        }
        submission.processingStatus = "awaiting_ai";
        submission.failureCode = null;
        submission.failureMessage = null;
        await manager.getRepository(SubmissionEntity).save(submission);
        await manager
          .getRepository(JobOutboxEntity)
          .createQueryBuilder()
          .insert()
          .values({
            id: `JOB-${randomUUID()}`,
            aggregateType: "submission",
            aggregateId: submission.id,
            eventType: "ai.quality.v1",
            payload: { submissionId: submission.id },
            status: "pending",
            attempts: 0,
            availableAt: new Date(),
          })
          .orIgnore()
          .execute();
      });
    } catch (error) {
      submission.processingStatus = "system_failed";
      submission.failureCode =
        error instanceof TerminalMediaError
          ? "MEDIA_VALIDATION_FAILED"
          : "MEDIA_PROCESSING_FAILED";
      submission.failureMessage = (
        error instanceof Error ? error.message : "媒体处理失败"
      ).slice(0, 2_000);
      await this.submissions.save(submission);
      if (error instanceof TerminalMediaError) throw error;
      throw new RetryableMediaError(submission.failureMessage);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
