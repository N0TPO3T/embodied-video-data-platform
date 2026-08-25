export type CollectionTaskStatus = "draft" | "published" | "paused" | "closed";
export type TaskNormalizationStatus = "pending" | "ready" | "failed";

export type NormalizedRequirementItem = {
  type: "hard" | "soft";
  content: string;
  rationale?: string;
};

/** 与服务端 / AI 规范化输出的结构保持一致 */
export type NormalizedTaskRequirements = {
  scene_description: string;
  requirements: NormalizedRequirementItem[];
  quality_notes: string[];
};

export type CollectionTask = {
  id: string;
  title: string;
  description: string;
  sceneName: string;
  sceneLabelId: string | null;
  rawRequirements: string;
  normalizedRequirements: NormalizedTaskRequirements | null;
  normalizationStatus: TaskNormalizationStatus;
  pricePointsPerMinute: number | null;
  status: CollectionTaskStatus;
  revision: number;
  createdByName: string;
  publishedAt: number | null;
  pausedAt: number | null;
  closedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type CollectionTaskForCollector = {
  id: string;
  title: string;
  description: string;
  sceneName: string;
  sceneLabelId: string | null;
  normalizedRequirements: NormalizedTaskRequirements | null;
  pricePointsPerMinute: number | null;
  status: CollectionTaskStatus;
  revision: number;
  publishedAt: number | null;
};

export type CreateTaskInput = {
  title: string;
  description?: string;
  sceneName: string;
  rawRequirements: string;
  pricePointsPerMinute?: number | null;
};

export type UpdateTaskInput = Partial<CreateTaskInput>;

export type ConfirmRequirementsInput = {
  scene_description: string;
  requirements: NormalizedRequirementItem[];
  quality_notes?: string[];
};

export type TaskListResult = {
  tasks: CollectionTask[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type TaskListQuery = {
  status?: "all" | CollectionTaskStatus;
  q?: string;
  page?: number;
  pageSize?: number;
};
