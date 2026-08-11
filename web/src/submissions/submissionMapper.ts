import type { ProcessingStatus, Submission } from "../domain/types";
import type {
  BackendMediaSegment,
  BackendProcessingStatus,
  BackendSubmission,
} from "./contracts";

function processingStatus(status: BackendProcessingStatus): ProcessingStatus {
  if (status === "uploading") return "uploading";
  if (status === "queued") return "queued";
  if (status === "probing" || status === "awaiting_ai") return "processing";
  if (status === "completed") return "completed";
  return "failed";
}

function invalidSeconds(segments: BackendMediaSegment[]): number {
  const ranges = segments
    .filter((segment) => segment.invalid)
    .map((segment) => [segment.startSeconds, segment.endSeconds] as const)
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let start: number | null = null;
  let end: number | null = null;
  for (const [nextStart, nextEnd] of ranges) {
    if (start === null || end === null) {
      start = nextStart;
      end = nextEnd;
    } else if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  if (start !== null && end !== null) total += end - start;
  return Math.round(total * 1_000) / 1_000;
}

function createdAt(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function backendSubmissionToDomain(
  source: BackendSubmission,
): Submission {
  return {
    id: source.id,
    fileName: source.fileName,
    ownerId: source.ownerId,
    ownerName: source.ownerName,
    teamId: source.teamId,
    teamName: source.teamName,
    scene: "待 AI 识别",
    action: source.processingStatus === "awaiting_ai" ? "等待 AI 质检" : "媒体处理中",
    object: "待 AI 识别",
    durationSeconds: source.media
      ? Math.round(source.media.durationSeconds)
      : 0,
    invalidSeconds: invalidSeconds(source.segments),
    sizeMb:
      Math.round((Number(source.sizeBytes) / 1024 / 1024) * 10) / 10,
    resolution: source.media
      ? `${source.media.width}×${source.media.height}`
      : "解析中",
    processingStatus: processingStatus(source.processingStatus),
    qualityStatus: "pending",
    aiScore: 0,
    finalScore: 0,
    settlementStatus: "unsettled",
    createdAt: createdAt(source.createdAt),
    tags: source.isTestData ? ["测试数据"] : [],
    issues: source.segments.map((segment) => ({
      label: segment.type === "black" ? "黑屏" : "画面冻结",
      start: segment.startSeconds,
      end: segment.endSeconds,
    })),
    audit: [],
  };
}
