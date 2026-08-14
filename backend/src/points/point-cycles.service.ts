import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository, type EntityManager } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { PointCycleAdjustmentEntity } from "../database/entities/point-cycle-adjustment.entity.js";
import { PointCycleEntity } from "../database/entities/point-cycle.entity.js";
import { PointCycleItemEntity } from "../database/entities/point-cycle-item.entity.js";
import { PointRuleVersionEntity } from "../database/entities/point-rule-version.entity.js";
import { QualityRuleVersionEntity } from "../database/entities/quality-rule-version.entity.js";
import { SubmissionDuplicateCandidateEntity } from "../database/entities/submission-duplicate-candidate.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import {
  pointRuleSnapshot,
  pointsForRule,
  settlementRatioForScore,
} from "../rules/rule-calculator.js";
import { loadLatestPointCycleAdjustments } from "./latest-point-cycle-adjustments.js";
import { PointCycleFailure } from "./point-cycle-failure.js";
import { PointCyclesPolicy } from "./point-cycles.policy.js";
import { PointRulesService } from "./point-rules.service.js";

type Candidate = {
  submission: SubmissionEntity;
  quality: VideoQualityResultEntity;
  durationMs: number;
  finalScore: number;
  settlementRatio: number;
  invalidDurationMs: number;
  effectiveDurationMs: number;
  pointsPerMinute: number;
  points: number;
};

function decimal(value: number, digits: number): string {
  return value.toFixed(digits);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function pointCycleId(businessDate: string): string {
  const compactDate = businessDate.replaceAll("-", "");
  return `PC-${compactDate}-${randomUUID().slice(0, 8)}`;
}

function effectiveItemValues(
  item: PointCycleItemEntity,
  adjustment?: PointCycleAdjustmentEntity,
) {
  return {
    finalScore: Number(adjustment?.nextFinalScore ?? item.finalScore),
    settlementRatio: Number(
      adjustment?.nextSettlementRatio ?? item.settlementRatio,
    ),
    effectiveDurationMs: Number(
      adjustment?.nextEffectiveDurationMs ?? item.effectiveDurationMs,
    ),
    points: Number(adjustment?.nextPoints ?? item.points),
  };
}

function publicItem(
  item: PointCycleItemEntity,
  adjustment?: PointCycleAdjustmentEntity,
) {
  const effective = effectiveItemValues(item, adjustment);
  return {
    id: item.id,
    submissionId: item.submissionId,
    ownerId: item.ownerId,
    ownerName: item.ownerName,
    teamId: item.teamId,
    teamName: item.teamName,
    fileName: item.fileName,
    finalScore: effective.finalScore,
    settlementRatio: effective.settlementRatio,
    effectiveDurationMs: effective.effectiveDurationMs,
    effectiveMinutes:
      Math.round((effective.effectiveDurationMs / 60_000) * 100) / 100,
    pointsPerMinute: Number(item.pointsPerMinute),
    points: effective.points,
    qualityRevision: item.qualityRevision,
    qualityReviewedAt: item.qualityReviewedAt?.getTime(),
  };
}

function publicCycle(
  cycle: PointCycleEntity,
  latestAdjustments = new Map<string, PointCycleAdjustmentEntity>(),
) {
  const items = cycle.items ?? [];
  const publicItems = items.map((item) =>
    publicItem(item, latestAdjustments.get(item.id)),
  );
  const visibleSubmissionCount = items.length;
  const visibleEffectiveDurationMs = publicItems.reduce(
    (total, item) => total + item.effectiveDurationMs,
    0,
  );
  const visibleTotalPoints =
    Math.round(
      publicItems.reduce((total, item) => total + item.points, 0) * 100,
    ) / 100;
  const effectiveDurationMs =
    visibleSubmissionCount > 0
      ? visibleEffectiveDurationMs
      : Number(cycle.effectiveDurationMs);
  return {
    id: cycle.id,
    businessDate: cycle.businessDate,
    status: cycle.status,
    submissionCount:
      visibleSubmissionCount > 0
        ? visibleSubmissionCount
        : cycle.submissionCount,
    effectiveDurationMs,
    effectiveMinutes:
      Math.round((effectiveDurationMs / 60_000) * 100) / 100,
    totalPoints:
      visibleSubmissionCount > 0
        ? visibleTotalPoints
        : Number(cycle.totalPoints),
    pointRuleVersionId: cycle.pointRuleVersionId,
    pointRuleRevision: cycle.pointRuleRevision,
    pointRuleSnapshot: cycle.pointRuleSnapshot,
    createdByAccountId: cycle.createdByAccountId,
    createdByName: cycle.createdByName,
    createdAt: cycle.createdAt.getTime(),
    items: publicItems,
  };
}

function csvCell(value: string | number): string {
  const raw = String(value);
  if (!/[",\n\r]/u.test(raw)) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
}

@Injectable()
export class PointCyclesService {
  constructor(
    @InjectRepository(PointCycleEntity)
    private readonly cycles: Repository<PointCycleEntity>,
    private readonly dataSource: DataSource,
    private readonly policy: PointCyclesPolicy,
    private readonly audit: AuditService,
    private readonly pointRules: PointRulesService,
  ) {}

  async preview(actor: PublicUser) {
    this.policy.requireCreate(actor);
    await this.pointRules.ensureDefault();
    const pointRule = await this.pointRules.getActiveForCalculation();
    const candidates = await this.loadCandidates(
      pointRule,
      this.dataSource.manager,
      false,
    );
    return this.publicPreview(candidates);
  }

  async list(actor: PublicUser) {
    this.policy.requireRead(actor);
    const query = this.cycles
      .createQueryBuilder("cycle")
      .leftJoinAndSelect("cycle.items", "item")
      .orderBy("cycle.createdAt", "DESC")
      .addOrderBy("item.teamName", "ASC")
      .addOrderBy("item.ownerName", "ASC")
      .addOrderBy("item.fileName", "ASC");
    if (actor.role === "leader") {
      query.andWhere("item.teamId = :teamId", { teamId: actor.teamId });
    } else if (actor.role === "collector") {
      query.andWhere("item.ownerId = :ownerId", { ownerId: actor.id });
    }
    const cycles = await query.getMany();
    const latestAdjustments = await loadLatestPointCycleAdjustments(
      this.dataSource.manager,
      cycles.flatMap((cycle) => (cycle.items ?? []).map((item) => item.id)),
    );
    return cycles.map((cycle) => publicCycle(cycle, latestAdjustments));
  }

  async get(actor: PublicUser, id: string) {
    this.policy.requireRead(actor);
    const query = this.cycles
      .createQueryBuilder("cycle")
      .leftJoinAndSelect("cycle.items", "item")
      .where("cycle.id = :id", { id })
      .orderBy("item.teamName", "ASC")
      .addOrderBy("item.ownerName", "ASC")
      .addOrderBy("item.fileName", "ASC");
    if (actor.role === "leader") {
      query.andWhere("item.teamId = :teamId", { teamId: actor.teamId });
    } else if (actor.role === "collector") {
      query.andWhere("item.ownerId = :ownerId", { ownerId: actor.id });
    }
    const cycle = await query.getOne();
    if (!cycle || (cycle.items ?? []).length === 0) {
      throw new PointCycleFailure("NOT_FOUND", "积分周期不存在", 404);
    }
    const latestAdjustments = await loadLatestPointCycleAdjustments(
      this.dataSource.manager,
      (cycle.items ?? []).map((item) => item.id),
    );
    return publicCycle(cycle, latestAdjustments);
  }

  async exportCsv(actor: PublicUser, id: string): Promise<string> {
    const cycle = await this.get(actor, id);
    const rows = [
      [
        "cycle_id",
        "business_date",
        "submission_id",
        "file_name",
        "team_id",
        "team_name",
        "owner_id",
        "owner_name",
        "final_score",
        "settlement_ratio",
        "effective_minutes",
        "points_per_minute",
        "points",
        "quality_revision",
        "quality_reviewed_at",
      ],
      ...cycle.items.map((item) => [
        cycle.id,
        cycle.businessDate,
        item.submissionId,
        item.fileName,
        item.teamId,
        item.teamName,
        item.ownerId,
        item.ownerName,
        item.finalScore.toFixed(1),
        item.settlementRatio.toFixed(4),
        item.effectiveMinutes.toFixed(2),
        item.pointsPerMinute.toFixed(4),
        item.points.toFixed(2),
        item.qualityRevision,
        item.qualityReviewedAt
          ? new Date(item.qualityReviewedAt).toISOString()
          : "",
      ]),
    ];
    return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  }

  async create(actor: PublicUser, businessDate = todayIsoDate()) {
    this.policy.requireCreate(actor);
    await this.pointRules.ensureDefault();
    return this.dataSource.transaction(async (manager) => {
      const pointRule = await this.pointRules.getActiveForCalculation(
        manager,
        true,
      );
      const candidates = await this.loadCandidates(pointRule, manager, true);
      if (candidates.length === 0) {
        throw new PointCycleFailure(
          "NO_ELIGIBLE_SUBMISSIONS",
          "当前没有可锁定积分数据",
          409,
        );
      }
      const totals = this.summarize(candidates);
      const cycleId = pointCycleId(businessDate);
      const cycle = await manager.getRepository(PointCycleEntity).save({
        id: cycleId,
        businessDate,
        status: "locked",
        submissionCount: totals.count,
        effectiveDurationMs: String(totals.effectiveDurationMs),
        totalPoints: decimal(totals.points, 2),
        pointRuleVersionId: pointRule.id,
        pointRuleRevision: pointRule.revision,
        pointRuleSnapshot: pointRuleSnapshot({
          ...pointRule,
          defaultPointsPerMinute: Number(pointRule.defaultPointsPerMinute),
        }),
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      });
      await manager.getRepository(PointCycleItemEntity).save(
        candidates.map((candidate) => ({
          id: `PCI-${randomUUID()}`,
          cycleId,
          submissionId: candidate.submission.id,
          ownerId: candidate.submission.ownerId,
          ownerName: candidate.submission.owner?.displayName ?? "",
          teamId: candidate.submission.teamId,
          teamName: candidate.submission.team?.name ?? "",
          fileName: candidate.submission.originalFileName,
          finalScore: decimal(candidate.finalScore, 1),
          settlementRatio: decimal(candidate.settlementRatio, 4),
          effectiveDurationMs: String(candidate.effectiveDurationMs),
          pointsPerMinute: decimal(candidate.pointsPerMinute, 4),
          points: decimal(candidate.points, 2),
          qualityRevision: candidate.quality.reviewRevision,
          qualityReviewedAt: candidate.quality.manualReviewedAt,
        })),
      );
      await this.audit.record(
        manager,
        actor,
        "point_cycle_lock",
        { id: cycle.id, name: cycle.businessDate },
        `锁定 ${totals.count} 条合格数据，合计 ${decimal(totals.points, 2)} 分`,
        null,
        {
          submissionCount: totals.count,
          effectiveDurationMs: totals.effectiveDurationMs,
          totalPoints: totals.points,
        },
      );
      const locked = await manager
        .getRepository(PointCycleEntity)
        .createQueryBuilder("cycle")
        .leftJoinAndSelect("cycle.items", "item")
        .where("cycle.id = :cycleId", { cycleId })
        .orderBy("item.teamName", "ASC")
        .addOrderBy("item.ownerName", "ASC")
        .addOrderBy("item.fileName", "ASC")
        .getOneOrFail();
      return publicCycle(locked);
    });
  }

  private async loadCandidates(
    pointRule: PointRuleVersionEntity,
    manager: EntityManager = this.dataSource.manager,
    lock = false,
  ): Promise<Candidate[]> {
    let lockedIds: string[] | null = null;
    if (lock) {
      const ids = await this.candidateIdQuery(manager).getRawMany<{
        submission_id: string;
      }>();
      lockedIds = ids.map((row) => row.submission_id);
      if (lockedIds.length === 0) return [];
      await manager
        .getRepository(SubmissionEntity)
        .createQueryBuilder("submission")
        .setLock("pessimistic_write")
        .where("submission.id IN (:...ids)", { ids: lockedIds })
        .getMany();
    }

    const query = manager
      .getRepository(SubmissionEntity)
      .createQueryBuilder("submission")
      .innerJoinAndSelect("submission.owner", "owner")
      .innerJoinAndSelect("submission.team", "team")
      .innerJoinAndMapOne(
        "submission.quality",
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .leftJoin(
        QualityRuleVersionEntity,
        "qualityRule",
        "qualityRule.id = quality.qualityRuleVersionId",
      )
      .leftJoinAndMapOne(
        "submission.metadata",
        MediaMetadataEntity,
        "metadata",
        "metadata.submissionId = submission.id",
      )
      .leftJoin(
        PointCycleItemEntity,
        "pointItem",
        "pointItem.submissionId = submission.id",
      )
      .leftJoin(
        SubmissionDuplicateCandidateEntity,
        "duplicateCandidate",
        "duplicateCandidate.submissionId = submission.id AND duplicateCandidate.status = :duplicateCandidateStatus",
        { duplicateCandidateStatus: "candidate" },
      )
      .where("submission.processingStatus = :completed", {
        completed: "completed",
      })
      .andWhere("submission.assetStatus = :activeAsset", {
        activeAsset: "active",
      })
      .andWhere("submission.storageStatus = :availableStorage", {
        availableStorage: "available",
      })
      .andWhere("pointItem.id IS NULL")
      .andWhere("duplicateCandidate.id IS NULL")
      .andWhere("quality.status IN (:...statuses)", {
        statuses: ["scored", "review_pending"],
      })
      .andWhere(
        "(quality.manualFinalScore IS NOT NULL OR quality.status = :scoredStatus)",
        { scoredStatus: "scored" },
      )
      .andWhere(`
        COALESCE(quality.manualFinalScore, quality.finalScore) >= COALESCE(
          (quality.qualityRuleSnapshot ->> 'passThreshold')::numeric,
          qualityRule.passThreshold,
          60
        )
      `)
      .orderBy("submission.createdAt", "ASC");
    if (lockedIds) {
      query.andWhere("submission.id IN (:...lockedIds)", { lockedIds });
    }

    const submissions = await query.getMany();
    const legacyRuleIds = [
      ...new Set(
        submissions.flatMap((submission) => {
          const quality = (
            submission as SubmissionEntity & {
              quality?: VideoQualityResultEntity | null;
            }
          ).quality;
          return quality?.qualityRuleVersionId && !quality.qualityRuleSnapshot
            ? [quality.qualityRuleVersionId]
            : [];
        }),
      ),
    ];
    const legacyRules = new Map(
      (
        legacyRuleIds.length === 0
          ? []
          : await manager
              .getRepository(QualityRuleVersionEntity)
              .findBy({ id: In(legacyRuleIds) })
      ).map((rule) => [rule.id, rule]),
    );
    return submissions.flatMap((submission) => {
      const quality = (
        submission as SubmissionEntity & {
          quality?: VideoQualityResultEntity | null;
        }
      ).quality;
      const metadata = (
        submission as SubmissionEntity & {
          metadata?: MediaMetadataEntity | null;
        }
      ).metadata;
      if (!quality) return [];
      const finalScore = Number(quality.manualFinalScore ?? quality.finalScore);
      const settlementRatio = settlementRatioForScore({
        score: finalScore,
        passThreshold:
          quality.qualityRuleSnapshot?.passThreshold ??
          (quality.qualityRuleVersionId
            ? legacyRules.get(quality.qualityRuleVersionId)?.passThreshold
            : undefined) ??
          60,
        coefficientBands: pointRule.coefficientBands,
      });
      if (
        !Number.isFinite(finalScore) ||
        !Number.isFinite(settlementRatio) ||
        settlementRatio <= 0
      ) {
        return [];
      }
      const invalidDurationMs = Number(
        quality.manualInvalidDurationMs ?? quality.invalidDurationMs ?? 0,
      );
      const durationMs = metadata
        ? Math.round(Number(metadata.durationSeconds) * 1_000)
        : Number(
            quality.manualBillableDurationMs ??
              quality.billableDurationMs ??
              0,
          ) + invalidDurationMs;
      const effectiveDurationMs = Math.max(0, durationMs - invalidDurationMs);
      const teamPointsPerMinute = Number(
        submission.team?.unitPricePerMinute ?? 0,
      );
      const pointsPerMinute =
        teamPointsPerMinute > 0
          ? teamPointsPerMinute
          : Number(pointRule.defaultPointsPerMinute);
      const points = pointsForRule({
        pointsPerMinute,
        effectiveDurationMs,
        settlementRatio,
      });
      return [
        {
          submission,
          quality,
          durationMs,
          finalScore,
          settlementRatio,
          invalidDurationMs,
          effectiveDurationMs,
          pointsPerMinute,
          points,
        },
      ];
    });
  }

  private candidateIdQuery(manager: EntityManager) {
    return manager
      .getRepository(SubmissionEntity)
      .createQueryBuilder("submission")
      .select("submission.id", "submission_id")
      .innerJoin(
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .leftJoin(
        QualityRuleVersionEntity,
        "qualityRule",
        "qualityRule.id = quality.qualityRuleVersionId",
      )
      .leftJoin(
        PointCycleItemEntity,
        "pointItem",
        "pointItem.submissionId = submission.id",
      )
      .leftJoin(
        SubmissionDuplicateCandidateEntity,
        "duplicateCandidate",
        "duplicateCandidate.submissionId = submission.id AND duplicateCandidate.status = :duplicateCandidateStatus",
        { duplicateCandidateStatus: "candidate" },
      )
      .where("submission.processingStatus = :completed", {
        completed: "completed",
      })
      .andWhere("submission.assetStatus = :activeAsset", {
        activeAsset: "active",
      })
      .andWhere("submission.storageStatus = :availableStorage", {
        availableStorage: "available",
      })
      .andWhere("pointItem.id IS NULL")
      .andWhere("duplicateCandidate.id IS NULL")
      .andWhere("quality.status IN (:...statuses)", {
        statuses: ["scored", "review_pending"],
      })
      .andWhere(
        "(quality.manualFinalScore IS NOT NULL OR quality.status = :scoredStatus)",
        { scoredStatus: "scored" },
      )
      .andWhere(`
        COALESCE(quality.manualFinalScore, quality.finalScore) >= COALESCE(
          (quality.qualityRuleSnapshot ->> 'passThreshold')::numeric,
          qualityRule.passThreshold,
          60
        )
      `)
      .orderBy("submission.createdAt", "ASC");
  }

  private publicPreview(candidates: Candidate[]) {
    const totals = this.summarize(candidates);
    return {
      submissionCount: totals.count,
      effectiveDurationMs: totals.effectiveDurationMs,
      effectiveMinutes:
        Math.round((totals.effectiveDurationMs / 60_000) * 100) / 100,
      totalPoints: totals.points,
      teamSummaries: [...totals.teamSummaries.values()].sort((left, right) =>
        left.teamName.localeCompare(right.teamName, "zh-CN"),
      ),
    };
  }

  private summarize(candidates: Candidate[]) {
    const teamSummaries = new Map<
      string,
      {
        teamId: string;
        teamName: string;
        submissionCount: number;
        effectiveDurationMs: number;
        points: number;
      }
    >();
    const totals = candidates.reduce(
      (accumulator, candidate) => {
        accumulator.count += 1;
        accumulator.effectiveDurationMs += candidate.effectiveDurationMs;
        accumulator.points += candidate.points;
        const teamId = candidate.submission.teamId;
        const existing =
          teamSummaries.get(teamId) ??
          {
            teamId,
            teamName: candidate.submission.team?.name ?? "",
            submissionCount: 0,
            effectiveDurationMs: 0,
            points: 0,
          };
        existing.submissionCount += 1;
        existing.effectiveDurationMs += candidate.effectiveDurationMs;
        existing.points =
          Math.round((existing.points + candidate.points) * 100) / 100;
        teamSummaries.set(teamId, existing);
        return accumulator;
      },
      { count: 0, effectiveDurationMs: 0, points: 0 },
    );
    return {
      count: totals.count,
      effectiveDurationMs: totals.effectiveDurationMs,
      points: Math.round(totals.points * 100) / 100,
      teamSummaries,
    };
  }
}
