"use client";

import { Archive, BadgeCheck, FileVideo, Users } from "lucide-react";

import { MetricCard } from "../../components/MetricCard";
import { useDemoStore } from "../../data/DemoStoreContext";

export function AdminDashboard() {
  const { state } = useDemoStore();
  const submissions = state.submissions;
  const queued = submissions.filter(
    (item) => item.processingStatus === "queued" || item.qualityResult?.status === "queued",
  ).length;
  const running = submissions.filter(
    (item) => item.processingStatus === "processing" || item.qualityResult?.status === "running",
  ).length;
  const finished = submissions.filter((item) =>
    ["scored", "hard_reject", "review_pending"].includes(item.qualityResult?.status ?? ""),
  ).length;
  const failed = submissions.filter(
    (item) => item.processingStatus === "failed" || item.qualityResult?.status === "system_failed",
  ).length;
  const passed = submissions.filter((item) => item.qualityStatus === "passed").length;
  const terminal = submissions.filter((item) => item.qualityStatus !== "pending").length;
  const passRate = terminal ? `${((passed / terminal) * 100).toFixed(1)}%` : "暂无";

  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">全平台运营态势</p><h1>运营总览</h1><span>正式 AI 质检 Worker 已按 2 个并发槽位运行</span></div><span className="live-pill"><i />持久化数据</span></div>
      <div className="metric-grid">
        <MetricCard label="视频提交" value={`${submissions.length} 条`} detail="当前数据库可见范围" icon={FileVideo} />
        <MetricCard label="质量通过率" value={passRate} detail={`${terminal} 条已有正式结论`} icon={BadgeCheck} tone="green" />
        <MetricCard label="可交付资产" value={String(submissions.filter((item) => item.settlementStatus === "settled" && item.qualityStatus === "passed").length)} detail="已通过且完成结算" icon={Archive} tone="violet" />
        <MetricCard label="有效账号" value={String(state.users.filter((item) => item.status === "active").length)} detail="包含管理员、团长和数采" icon={Users} tone="amber" />
      </div>
      <div className="dashboard-grid">
        <section className="content-card content-card-wide"><div className="card-heading"><div><h2>正式 AI 质检</h2><p>当前主流程使用 Qwen3.7 模型路由</p></div></div><div className="pipeline-list"><div><span>初检模型</span><strong>qwen3.7-plus</strong><em>正式任务</em></div><div><span>条件复核</span><strong>qwen3.7-flash</strong><em>按规则触发</em></div><div><span>并发上限</span><strong>2</strong><em>单 Worker 实例</em></div><div><span>结果存储</span><strong>PostgreSQL</strong><em>重启后保留</em></div></div></section>
        <aside className="content-card"><div className="card-heading"><div><h2>处理流水线</h2><p>当前正式任务状态</p></div></div><div className="pipeline-list"><div><span>等待处理</span><strong>{queued}</strong><em>媒体或 AI 队列</em></div><div><span>分析中</span><strong>{running}</strong><em>最多并发 2 条</em></div><div><span>已出结果</span><strong>{finished}</strong><em>持久化完成</em></div><div><span>异常任务</span><strong className="danger-text">{failed}</strong><em>可查看原因</em></div></div></aside>
      </div>
    </div>
  );
}
