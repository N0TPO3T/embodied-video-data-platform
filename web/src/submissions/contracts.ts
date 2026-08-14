export type BackendUploadStatus =
  | "created"
  | "uploading"
  | "uploaded"
  | "aborted";

export type BackendProcessingStatus =
  | "uploading"
  | "queued"
  | "probing"
  | "awaiting_ai"
  | "ai_processing"
  | "completed"
  | "system_failed";

export type BackendQualityStatus =
  | "queued"
  | "running"
  | "scored"
  | "hard_reject"
  | "review_pending"
  | "system_failed";

export type BackendQualityResult = {
  status: BackendQualityStatus;
  attempts: number;
  promptRevision: number;
  promptContentSha256: string;
  initialModel: string;
  reviewModel: string;
  modelRuns: Array<Record<string, unknown>>;
  finalScore: number | null;
  aiFinalScore?: number | null;
  rawTotalScore: number | null;
  settlementRatio: number | null;
  passed?: boolean | null;
  passThreshold?: number;
  invalidDurationMs: number | null;
  billableDurationMs: number | null;
  summary: string;
  recommendations: string[];
  deductions: Array<Record<string, unknown>>;
  reviewRequired: boolean;
  reviewReasons: string[];
  reviewRevision?: number;
  manualReview?: {
    reviewedByAccountId: string;
    reviewedByName: string;
    reviewedAt: number;
    reason: string;
    issues: Array<{ label: string; start: number; end: number }>;
    finalScore: number | null;
  };
  manualIssues?: Array<{ label: string; start: number; end: number }>;
  lastError?: string;
  detectedTask?: {
    scene_id?: string;
    task_id?: string;
    variant_id?: string;
    task_summary?: string;
    confidence?: number;
  };
  invalidSegments: Array<{
    reasonCode: string;
    startMs: number;
    endMs: number;
    source: string;
  }>;
  startedAt?: number;
  completedAt?: number;
};

export type BackendMediaSegment = {
  id: string;
  type: "black" | "freeze";
  startSeconds: number;
  endSeconds: number;
  invalid: boolean;
  evidenceObjectKey?: string;
};

export type BackendSubmission = {
  id: string;
  fileName: string;
  ownerId: string;
  ownerName: string;
  teamId: string;
  teamName: string;
  sizeBytes: string;
  uploadStatus: BackendUploadStatus;
  processingStatus: BackendProcessingStatus;
  settlementStatus?: "settled" | "unsettled";
  duplicateCandidates?: Array<{
    id: string;
    candidateSubmissionId: string;
    candidateFileName?: string;
    similarity: number;
    status: "candidate" | "cleared";
    details?: Record<string, unknown>;
    createdAt: number;
  }>;
  failureCode?: string;
  failureMessage?: string;
  isTestData: boolean;
  assetStatus?: "active" | "quarantined";
  storageStatus?: "available" | "deleted";
  storage?: {
    status: "available" | "deleted";
    retainUntil?: number;
    deletedAt?: number;
    deletedByAccountId?: string;
    deletedByName?: string;
    deleteReason?: string;
  };
  quarantine?: {
    reason: string;
    quarantinedAt?: number;
    quarantinedByAccountId?: string;
    quarantinedByName?: string;
  };
  authorization?: {
    dataUsageAuthorized: boolean;
    privacyConfirmed: boolean;
    sensitiveContentConfirmed: boolean;
    uploadPolicyVersion: string;
    confirmedAt?: number;
  };
  createdAt: number;
  uploadedAt?: number;
  media?: {
    durationSeconds: number;
    width: number;
    height: number;
    frameRate: number;
    codec: string;
    bitrate: string | null;
    sizeBytes: string;
  };
  segments: BackendMediaSegment[];
  quality?: BackendQualityResult;
  audit?: Array<{
    id: string;
    actor: string;
    action: string;
    reason: string;
    createdAt: number;
    previousScore?: number;
    nextScore?: number;
  }>;
};

export type BackendSubmissionListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type BackendSubmissionListResult = {
  submissions: BackendSubmission[];
  pagination: BackendSubmissionListPagination;
};

export type ReviewSubmissionQualityInput = {
  finalScore: number;
  reason: string;
  issues: Array<{ label: string; start: number; end: number }>;
  expectedReviewRevision?: number;
  quarantine?: boolean;
};

export type RerunAiQualityInput = {
  reason: string;
};

export type RenameSubmissionInput = {
  fileName: string;
  reason?: string;
};

export type DeleteSubmissionInput = {
  reason: string;
  force?: boolean;
};

export type DeleteSubmissionResult = {
  deletedSubmissionId: string;
  deletedFileName: string;
  deletedObjectKeys: string[];
  abortedUploadId?: string;
};

export type ClearDuplicateCandidateInput = {
  reason: string;
};

export type BackendSubmissionPreview = {
  url: string;
  expiresAt: number;
  contentType: string;
  fileName: string;
  source?: "web_preview" | "original";
  hls?: {
    url: string;
    contentType: string;
    qualities: Array<{ quality: string; width: number; height: number }>;
  };
  thumbnail?: {
    url: string;
    expiresAt: number;
    contentType: string;
  };
  evidenceFrames?: Array<{
    segmentId: string;
    type: "black" | "freeze";
    startSeconds: number;
    endSeconds: number;
    url: string;
    expiresAt: number;
    contentType: string;
  }>;
};

export type CreateUploadResult = {
  submission: BackendSubmission;
  upload: {
    uploadId: string;
    partSizeBytes: number;
    partCount: number;
    expiresInSeconds: number;
  };
};

export type ActiveUploadResult = CreateUploadResult;

export type PresignedPart = {
  partNumber: number;
  url: string;
  expiresAt: number;
};

export interface SubmissionUploadApi {
  createUpload(input: {
    fileName: string;
    contentType: "video/mp4" | "video/quicktime";
    sizeBytes: number;
    checksumSha256: string;
    dataUsageAuthorized: boolean;
    privacyConfirmed: boolean;
    sensitiveContentConfirmed: boolean;
  }): Promise<CreateUploadResult>;
  presignParts(id: string, partNumbers: number[]): Promise<PresignedPart[]>;
  verifyResumeUpload(
    id: string,
    input: { fileName: string; sizeBytes: number; checksumSha256: string },
  ): Promise<ActiveUploadResult>;
  completeUpload(
    id: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<BackendSubmission>;
  abortUpload(id: string): Promise<void>;
}
