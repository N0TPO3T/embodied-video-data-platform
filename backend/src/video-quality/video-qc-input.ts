import type {
  InventoryContextInput,
  PreparedVideoEvidence,
  VideoQcInputV1,
} from "./video-quality.types.js";
import { VIDEO_QC_RESULT_SCHEMA } from "./video-quality.types.js";

export type BuildVideoQcInput = {
  videoId: string;
  evidence: PreparedVideoEvidence;
  exactBatchDuplicate: boolean;
  prohibitedContentPolicy?: string[];
  previousModelObservations?: Array<Record<string, unknown>>;
  /** 由调用方基于库存快照构造的稀缺度上下文；缺省时为 cold_start（不惩罚也不奖励） */
  inventoryContext?: InventoryContextInput;
  /** 场景/动作/对象标签字典，供模型做结构化分类 */
  labelDictionary?: string[];
};

export function buildVideoQcInput(input: BuildVideoQcInput): VideoQcInputV1 {
  const inventory = input.inventoryContext;
  return {
    schema_version: "video_qc_input_v1",
    video_id: input.videoId,
    analysis_duration_ms: input.evidence.metadata.duration_ms,
    video_input_present: true,
    media_metadata: { ...input.evidence.metadata },
    technical_metrics: {
      ...input.evidence.technicalMetrics,
      detector_windows: input.evidence.technicalMetrics.detector_windows.map(
        (window) => ({ ...window }),
      ),
    },
    task_context: {
      submitted_task_name: "",
      expected_scene_id: "",
      expected_task_id: "",
      expected_variant_id: "",
      prohibited_content_policy: input.prohibitedContentPolicy ?? [],
      label_dictionary: input.labelDictionary ?? [],
    },
    inventory_context: inventory
      ? {
          snapshot_id: inventory.snapshot_id,
          mode: inventory.mode,
          authoritative_coefficient: inventory.authoritative_coefficient,
          c_scene: inventory.c_scene,
          c_standard_task: inventory.c_standard_task,
          c_variant: inventory.c_variant,
          current_video_excluded: true,
          scene_inventory_count: inventory.scene_inventory_count,
          task_inventory_count: inventory.task_inventory_count,
          variant_inventory_count: inventory.variant_inventory_count,
        }
      : {
          snapshot_id: "quality-lab-cold-start",
          mode: "cold_start",
          authoritative_coefficient: 1,
          c_scene: 1,
          c_standard_task: 1,
          c_variant: 1,
          current_video_excluded: true,
        },
    similarity_context: {
      snapshot_id: "quality-lab-cold-start",
      file_hash_exact: input.exactBatchDuplicate,
      confirmed_duplicate: input.exactBatchDuplicate,
      authoritative_coefficient: 1,
      s_video: 0,
      s_segment: 0,
      s_semantic: 0,
      matched_duration_ratio: 0,
      temporal_order_similarity: 0,
      top_candidates: [],
    },
    previous_model_observations: input.previousModelObservations ?? [],
    requested_output_schema: VIDEO_QC_RESULT_SCHEMA,
    missing_inputs: [...input.evidence.missingMetrics],
  };
}
