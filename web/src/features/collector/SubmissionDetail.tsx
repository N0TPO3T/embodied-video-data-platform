import { AlertTriangle, ArrowLeft, Clock3, Coins, FileVideo, Sparkles } from "lucide-react";

import { QualityScore } from "../../components/QualityScore";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";
import { effectiveDuration, estimateIncome } from "../../domain/calculations";

export function SubmissionDetail({ id, navigate }: { id: string; navigate(path: string): void }) {
  const { state, currentUser, currentTeam } = useDemoStore();
  const item = state.submissions.find(
    (submission) => submission.id === id && submission.ownerId === currentUser.id,
  );
  if (!item) {
    return <div className="empty-state"><FileVideo size={28} /><strong>找不到这条数据</strong><button className="text-button" onClick={() => navigate("/collector/submissions")}>返回我的数据</button></div>;
  }
  const income = estimateIncome(
    currentTeam?.unitPricePerMinute ?? 12,
    item.durationSeconds,
    item.invalidSeconds,
    item.finalScore,
  );
  const quality = item.qualityResult;
  const label = item.qualityStatus === "passed"
    ? "质量通过"
    : item.qualityStatus === "failed"
      ? "需要返工"
      : quality?.status === "review_pending"
        ? "等待人工复核"
        : quality?.status === "system_failed"
          ? "质检异常"
          : "等待质检";
  const tone = item.qualityStatus === "passed"
    ? "success"
    : item.qualityStatus === "failed" || quality?.status === "system_failed"
      ? "danger"
      : "warning";

  return (
    <div className="page-stack">
      <button className="back-page" onClick={() => navigate("/collector/submissions")}><ArrowLeft size={16} />返回我的数据</button>
      <div className="page-heading"><div><p className="page-kicker">{item.id}</p><h1>{item.fileName}</h1><span>{item.createdAt} · {item.resolution} · {item.sizeMb} MB</span></div><StatusBadge label={label} tone={tone} /></div>
      <div className="detail-grid">
        <section className="video-preview"><div><FileVideo size={42} /><strong>已保存原始视频</strong><small>视频证据存储于本地对象存储</small></div><span>{Math.floor(item.durationSeconds / 60)}:{String(item.durationSeconds % 60).padStart(2, "0")}</span></section>
        <aside className="content-card score-panel">
          <div className="card-heading"><div><h2>质量结论</h2><p>{quality ? `${quality.initialModel} · 提示词 V${quality.promptRevision}` : "等待正式 AI 结果"}</p></div><QualityScore score={item.finalScore} /></div>
          <div className="score-meter"><i style={{ width: `${item.finalScore}%` }} /></div>
          <dl><div><dt><Clock3 size={15} />有效计费时长</dt><dd>{effectiveDuration(item.durationSeconds, item.invalidSeconds)} 秒</dd></div><div><dt><Coins size={15} />预计收入</dt><dd>¥{income.toFixed(2)}</dd></div></dl>
          {quality?.summary && <p className="quality-summary">{quality.summary}</p>}
          {quality?.lastError && <p className="form-message error">{quality.lastError}</p>}
        </aside>
      </div>
      <div className="dashboard-grid">
        <section className="content-card"><div className="card-heading"><div><h2>AI 内容理解</h2><p>场景、任务和对象来自持久化模型结果</p></div><Sparkles size={18} /></div><div className="metadata-grid"><div><small>场景</small><strong>{item.scene}</strong></div><div><small>动作</small><strong>{item.action}</strong></div><div><small>操作对象</small><strong>{item.object}</strong></div></div>{quality?.recommendations.length ? <div className="recommend-list">{quality.recommendations.map((recommendation, index) => <div key={`${index}-${recommendation}`}><em>{String(index + 1).padStart(2, "0")}</em><span><strong>{recommendation}</strong></span></div>)}</div> : null}</section>
        <aside className="content-card"><div className="card-heading"><div><h2>质量问题区间</h2><p>无效时长共 {item.invalidSeconds} 秒</p></div></div>{item.issues.length ? <div className="issue-list">{item.issues.map((issue) => <div key={`${issue.label}-${issue.start}-${issue.end}`}><AlertTriangle size={15} /><span><strong>{issue.label}</strong><small>{issue.start}s — {issue.end}s</small></span></div>)}</div> : <div className="success-empty">未发现明显质量问题</div>}</aside>
      </div>
    </div>
  );
}
