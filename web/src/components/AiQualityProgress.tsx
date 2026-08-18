"use client";

import { useEffect, useState } from "react";

export const AI_PROGRESS_STAGES = [
  { stage: "downloading", label: "下载视频" },
  { stage: "media_analysis", label: "媒体解析" },
  { stage: "initial_review", label: "AI 初检" },
  { stage: "secondary_review", label: "条件复核" },
  { stage: "completed", label: "完成" },
] as const;

function stageIndex(stage?: string): number {
  if (!stage) return 0;
  const index = AI_PROGRESS_STAGES.findIndex((item) => item.stage === stage);
  return index === -1 ? 0 : index;
}

export { stageIndex };

export function stageLabel(stage?: string): string {
  if (stage === "queued") return "排队等待";
  if (stage === "failed") return "执行失败";
  if (stage === "stuck") return "任务卡住";
  return AI_PROGRESS_STAGES[stageIndex(stage)]?.label ?? "排队等待";
}

export function stagePercent(stage?: string): number {
  if (stage === "completed" || stage === "failed" || stage === "stuck") return 100;
  return Math.min(96, ((stageIndex(stage) + 1) / AI_PROGRESS_STAGES.length) * 100);
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds
    ? `${minutes} 分 ${remainingSeconds} 秒`
    : `${minutes} 分钟`;
}

export function AiQualityProgress({
  stage,
  updatedAt,
}: {
  stage?: string;
  updatedAt?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (!stage) return null;
  const index = stageIndex(stage);
  const finished = stage === "completed" || stage === "failed" || stage === "stuck";
  const elapsedMs = updatedAt && !finished ? Math.max(0, now - updatedAt) : 0;
  const width =
    stage === "completed"
      ? 100
      : stage === "failed" || stage === "stuck"
        ? 100
        : Math.min(96, ((index + 1) / AI_PROGRESS_STAGES.length) * 100);

  return (
    <div className="ai-progress">
      <div className="ai-progress-steps">
        {AI_PROGRESS_STAGES.map((item, itemIndex) => (
          <div
            key={item.stage}
            className={
              itemIndex < index || stage === "completed"
                ? "active"
                : itemIndex === index && !finished
                  ? "current"
                  : ""
            }
          >
            <i>{itemIndex + 1}</i>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="ai-progress-bar"><i style={{ width: `${width}%` }} /></div>
      <p>
        {stage === "completed"
          ? "AI 质检已完成"
          : stage === "failed"
            ? "AI 质检执行失败"
            : stage === "stuck"
              ? "任务已卡住，等待管理员处理"
              : `当前阶段：${stageLabel(stage)}${elapsedMs > 0 ? ` · 已耗时 ${formatElapsed(elapsedMs)}` : ""}`}
      </p>
    </div>
  );
}
