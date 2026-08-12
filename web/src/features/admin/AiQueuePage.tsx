"use client";

import { CheckCircle2, CircleX, Clock3, Cpu } from "lucide-react";

import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { Submission } from "../../domain/types";

function jobStatus(item: Submission): {
  label: string;
  tone: "success" | "danger" | "warning" | "info";
} {
  const status = item.qualityResult?.status;
  if (status === "scored") return { label: "质检完成", tone: "success" };
  if (status === "hard_reject") return { label: "硬性退回", tone: "danger" };
  if (status === "review_pending") return { label: "等待人工复核", tone: "warning" };
  if (status === "system_failed" || item.processingStatus === "failed") {
    return { label: "执行异常", tone: "danger" };
  }
  if (status === "running" || item.pipelineStage === "ai_processing") {
    return { label: "AI 质检中", tone: "info" };
  }
  if (item.pipelineStage === "probing") {
    return { label: "媒体分析中", tone: "info" };
  }
  if (status === "queued" || item.pipelineStage === "awaiting_ai") {
    return { label: "等待 AI 质检", tone: "warning" };
  }
  if (item.pipelineStage === "uploading") {
    return { label: "上传中", tone: "info" };
  }
  if (item.pipelineStage === "queued") {
    return { label: "等待媒体分析", tone: "warning" };
  }
  return { label: "等待处理", tone: "warning" };
}

export function AiQueuePage() {
  const { state } = useDemoStore();
  const jobs = state.submissions;
  const queued = jobs.filter(
    (item) =>
      item.pipelineStage === "queued" ||
      item.pipelineStage === "awaiting_ai" ||
      item.qualityResult?.status === "queued",
  ).length;
  const mediaRunning = jobs.filter(
    (item) => item.pipelineStage === "probing",
  ).length;
  const aiRunning = jobs.filter(
    (item) =>
      item.pipelineStage === "ai_processing" ||
      item.qualityResult?.status === "running",
  ).length;
  const completed = jobs.filter((item) =>
    ["scored", "hard_reject", "review_pending"].includes(
      item.qualityResult?.status ?? "",
    ),
  ).length;
  const failed = jobs.filter(
    (item) =>
      item.processingStatus === "failed" ||
      item.qualityResult?.status === "system_failed",
  ).length;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><p className="page-kicker">AI Worker 实时队列</p><h1>AI 任务</h1><span>正式质检使用 2 个并发槽位，状态和结果均来自持久化数据</span></div>
        <span className="live-pill"><i />AI Worker · 并发 2</span>
      </div>
      <div className="metric-grid">
        <MetricCard label="等待处理" value={String(queued)} detail="等待媒体或 AI 队列" icon={Clock3} tone="amber" />
        <MetricCard label="AI 执行中" value={String(aiRunning)} detail={`最多同时执行 2 条 · 媒体分析中 ${mediaRunning} 条`} icon={Cpu} />
        <MetricCard label="已出结果" value={String(completed)} detail="包含通过、退回和待复核" icon={CheckCircle2} tone="green" />
        <MetricCard label="异常任务" value={String(failed)} detail="已持久化失败原因" icon={CircleX} tone="violet" />
      </div>
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>任务队列</h2><p>正式提交的媒体分析与 AI 质检状态</p></div></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>提交</th><th>视频文件</th><th>模型路由</th><th>提示词</th><th>尝试次数</th><th>状态</th></tr></thead>
            <tbody>
              {jobs.map((job) => {
                const status = jobStatus(job);
                return (
                  <tr key={job.id}>
                    <td><strong>{job.id}</strong></td>
                    <td>{job.fileName}</td>
                    <td>{job.qualityResult ? `${job.qualityResult.initialModel} → ${job.qualityResult.reviewModel}` : "等待锁定模型"}</td>
                    <td>{job.qualityResult ? `V${job.qualityResult.promptRevision}` : "等待锁定版本"}</td>
                    <td>{job.qualityResult?.attempts ?? 0}</td>
                    <td><StatusBadge label={status.label} tone={status.tone} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!jobs.length && <div className="empty-state"><Cpu size={26} /><strong>暂无正式 AI 任务</strong><span>视频上传并完成媒体解析后会自动进入这里</span></div>}
        </div>
      </section>
    </div>
  );
}
