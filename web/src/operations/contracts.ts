export type BackendQueueJob = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  status: "pending" | "published";
  attempts: number;
  availableAt: number;
  publishedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  ageMs: number;
  waitMs: number;
  queuedForMs: number;
  publishLatencyMs?: number;
};

export type BackendWorkerHeartbeat = {
  id: string;
  kind: "media" | "ai_quality";
  hostName: string;
  processId: number;
  status: "idle" | "running" | "stopped";
  currentSubmissionId?: string;
  currentTaskStartedAt?: number;
  currentTaskAgeMs?: number;
  completedTaskCount: number;
  failedTaskCount: number;
  lastTaskDurationMs?: number;
  averageTaskDurationMs: number;
  maxTaskDurationMs: number;
  runningTooLong: boolean;
  taskTimeoutMs: number;
  lastError?: string;
  startedAt: number;
  lastSeenAt: number;
  stale: boolean;
};

export type BackendWorkerReclaimResult = {
  reclaimed: Array<{
    submissionId: string;
    previousStatus: string;
    nextStatus: string;
    eventType: string;
  }>;
  stuck: Array<{
    submissionId: string;
    previousStatus: string;
    reason: string;
  }>;
};

export type BackendQueueSnapshot = {
  summary: {
    total: number;
    pending: number;
    published: number;
    failed: number;
    media: number;
    ai: number;
    averagePublishLatencyMs: number;
  };
  jobs: BackendQueueJob[];
  workers: BackendWorkerHeartbeat[];
  inactive?: BackendWorkerHeartbeat[];
  inactiveCount?: number;
};

export type BackendOperationsNotification = {
  id: string;
  title: string;
  detail: string;
  tone: "info" | "success" | "warning" | "danger";
  path: string;
  count: number;
  createdAt: number;
};

export type BackendNavigationBadge = {
  path: string;
  label: string;
  count: number;
};

export type BackendOperationsStatus = {
  generatedAt: number;
  unreadCount: number;
  summary: {
    processingSubmissions: number;
    failedSubmissions: number;
    reviewPending: number;
    unsettledEligible: number;
    pendingJobs: number;
    failedJobs: number;
    workerAlerts: number;
    recentAudits: number;
  };
  navigationBadges: BackendNavigationBadge[];
  notifications: BackendOperationsNotification[];
};
