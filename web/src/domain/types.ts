export type Role = "collector" | "leader" | "admin";

export type ProcessingStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type QualityStatus = "pending" | "passed" | "failed";
export type SettlementStatus = "unsettled" | "settled";
export type WithdrawalStatus =
  | "pending"
  | "approved"
  | "paid"
  | "rejected";

export interface User {
  id: string;
  name: string;
  account: string;
  role: Role;
  teamId?: string;
  avatar: string;
  phone: string;
  alipayAccount?: string;
}

export interface Team {
  id: string;
  name: string;
  leaderId: string;
  memberIds: string[];
  unitPricePerMinute: number;
}

export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  reason: string;
  createdAt: string;
  previousScore?: number;
  nextScore?: number;
}

export interface Submission {
  id: string;
  fileName: string;
  ownerId: string;
  ownerName: string;
  teamId: string;
  teamName: string;
  scene: string;
  action: string;
  object: string;
  durationSeconds: number;
  invalidSeconds: number;
  sizeMb: number;
  resolution: string;
  processingStatus: ProcessingStatus;
  qualityStatus: QualityStatus;
  aiScore: number;
  finalScore: number;
  settlementStatus: SettlementStatus;
  createdAt: string;
  completedAt?: string;
  tags: string[];
  issues: Array<{ label: string; start: number; end: number }>;
  audit: AuditRecord[];
}

export interface Withdrawal {
  id: string;
  userId: string;
  userName: string;
  amount: number;
  status: WithdrawalStatus;
  account: string;
  createdAt: string;
}

export interface SettlementBatch {
  id: string;
  date: string;
  submissionCount: number;
  effectiveMinutes: number;
  amount: number;
  status: "locked" | "processing";
}

export interface ValidationResult {
  valid: boolean;
  message: string;
}
