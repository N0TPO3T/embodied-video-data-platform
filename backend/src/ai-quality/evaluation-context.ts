import { createHash } from "node:crypto";

import type {
  LabelSetSnapshot,
  QualityRuleSnapshot,
} from "../rules/rule-calculator.js";

export function evaluationSystemPrompt(input: {
  basePrompt: string;
  qualityRule: QualityRuleSnapshot;
  labelSet: LabelSetSnapshot;
}): string {
  const enabledLabels = input.labelSet.labels.filter((label) => label.enabled);
  return [
    input.basePrompt.trim(),
    "",
    "# 平台运行时规则快照（服务端锁定）",
    "以下 JSON 是本次任务的权威规则与标签上下文。通过阈值由服务端复算；标签仅可从 enabled_labels 中选择，停用标签不得输出。",
    JSON.stringify({
      quality_rule: input.qualityRule,
      label_set: {
        id: input.labelSet.id,
        revision: input.labelSet.revision,
        version: input.labelSet.version,
        enabled_labels: enabledLabels,
      },
    }),
  ].join("\n");
}

export function promptContentSha256(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}
