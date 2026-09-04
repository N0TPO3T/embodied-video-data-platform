export type TaskAssetFilters = {
  q?: string; sceneKeys?: string[]; sceneMappingStatuses?: string[]; taskVerbs?: string[]; taskLabelIds?: string[];
  objectLabelIds?: string[]; toolLabelIds?: string[]; handModes?: string[]; executionPatterns?: string[];
  interactionPrimitives?: string[]; complexitySignals?: string[]; completions?: string[]; resultStatuses?: string[];
  failureRecoveryStatuses?: string[]; semanticVerifications?: string[]; sourceAnnotationAcceptances?: string[];
  boundarySources?: string[]; materializationModes?: string[]; hasAudio?: string; hasUnmappedLabels?: string;
  hasUncertainty?: string; minDurationMs?: string; maxDurationMs?: string; sourceGroupId?: string; includeHistorical?: "true" | "false";
  page?: number; pageSize?: number; sortBy?: string; sortOrder?: string;
};
export type TaskAssetSummary = {
  assetCount: number; totalSegmentDurationMs: number; totalStorageBytes: number; sourceGroupCount: number;
  humanVerifiedCount: number; inheritedCount: number; mappedSceneCount: number; proposedSceneCount: number;
  unknownSceneCount: number; unmappedLabelAssetCount: number; uncertainAssetCount: number;
};
// proposedCount is included in unmappedCount; the two counts must not be added.
type LabelSet = { ids: string[]; names: string[]; rawTexts: string[]; unmappedCount: number; proposedCount: number };
export type TaskAsset = {
  assetId: string; currentAnnotationRevisionId: string; annotationRevision: number; isCurrent: boolean;
  scene: { groupKey: string; mappingStatus: string; id: string | null; name: string | null; coarseLabel: string | null; fineLabel: string | null; verification: string };
  task: { description: string; verb: string; labelId: string | null; labelName: string | null; mappingStatus: string };
  objects: LabelSet; tools: LabelSet; handMode: string; executionPattern: string; interactionPrimitives: string[]; complexitySignals: string[];
  completion: string; resultStatus: string; failureRecovery: string; semanticVerification: string; sourceAnnotationAcceptance: string; boundarySource: string;
  media: { durationMs: number; width: number; height: number; frameRate: number; hasAudio: boolean; materializationMode: string; sizeBytes: number };
  sourceGroupId: string; hasUncertainty: boolean; hasUnmappedLabels: boolean; warningCount: number; createdAt: number; publishedAt: number | null;
};
export type TaskAssetList = {
  summary: TaskAssetSummary;
  indexHealth: { totalPublishedAssets: number; projectedCurrentAssets: number; missingProjectionAssets: number; staleProjectionAssets: number; projectionVersion: string };
  items: TaskAsset[]; pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export type TaskAssetValueCount = { value: string; count: number };
export type TaskAssetLabelCount = { id: string | null; name: string; count: number };
export type TaskAssetFacets = {
  scenes: Array<{ key: string; id: string | null; name: string | null; status: string; count: number }>;
  taskVerbs: TaskAssetValueCount[]; taskLabels: TaskAssetLabelCount[]; objects: TaskAssetLabelCount[]; tools: TaskAssetLabelCount[];
  handModes: TaskAssetValueCount[]; interactionPrimitives: TaskAssetValueCount[]; completions: TaskAssetValueCount[]; results: TaskAssetValueCount[]; semanticVerifications: TaskAssetValueCount[];
};
export type TaskAssetScene = Omit<TaskAssetSummary, "mappedSceneCount" | "proposedSceneCount" | "unknownSceneCount"> & {
  sceneKey: string; sceneId: string | null; sceneName: string | null; mappingStatus: string;
  completeCount: number; incompleteCount: number; partialCount: number; uncertainCompletionCount: number;
  successCount: number; failureCount: number; partialResultCount: number; unknownResultCount: number; notApplicableResultCount: number;
  topTaskVerbs: TaskAssetValueCount[]; topObjects: TaskAssetLabelCount[]; topTools: TaskAssetLabelCount[];
};
export type TaskAssetSceneSummary = {
  rows: TaskAssetScene[]; totals: Pick<TaskAssetSummary, "assetCount" | "totalSegmentDurationMs" | "totalStorageBytes" | "sourceGroupCount">;
};
