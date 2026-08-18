export const DIMENSION_LABELS: Record<string, string> = {
  first_person_and_composition: "第一人称与构图",
  hand_forearm_object_integrity: "手部、前臂与对象",
  frame_and_video_quality: "视频与帧质量",
  task_authenticity_completeness: "任务真实性与完整度",
  task_value_uniqueness: "任务价值与独特性",
};

export function dimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? key;
}

export function hardVetoReasonLabel(reason: string | Record<string, unknown>): string {
  if (typeof reason === "string") {
    const labels: Record<string, string> = {
      BROKEN_UNPLAYABLE: "文件损坏或无法完整解码",
      EXACT_DUPLICATE: "完全重复（SHA-256 一致）",
      FAKE_OR_NON_TASK: "虚假任务或伪造操作",
      NON_FIRST_PERSON: "非第一人称占比过高",
      NO_HAND_OR_OBJECT: "看不到任务所需手部或对象",
      UNRELATED_CONTENT: "无效或无关内容",
      PRIVACY_OR_SAFETY: "命中隐私、安全或合规风险",
    };
    return labels[reason] ?? reason;
  }
  const name = "reason" in reason ? String(reason.reason) : "";
  return name || JSON.stringify(reason);
}
