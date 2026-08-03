import { AlertTriangle, ArrowLeft, Clock3, Coins, FileVideo, Sparkles } from "lucide-react";
import { QualityScore } from "../../components/QualityScore";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";
import { effectiveDuration, estimateIncome } from "../../domain/calculations";

export function SubmissionDetail({ id, navigate }: { id: string; navigate(path: string): void }) {
  const { state, currentUser, currentTeam } = useDemoStore();
  const item = state.submissions.find((submission) => submission.id === id && submission.ownerId === currentUser.id);
  if (!item) return <div className="empty-state"><FileVideo size={28} /><strong>找不到这条数据</strong><button className="text-button" onClick={() => navigate("/collector/submissions")}>返回我的数据</button></div>;
  const income = estimateIncome(currentTeam?.unitPricePerMinute ?? 12, item.durationSeconds, item.invalidSeconds, item.finalScore);

  return (
    <div className="page-stack">
      <button className="back-page" onClick={() => navigate("/collector/submissions")}><ArrowLeft size={16} />返回我的数据</button>
      <div className="page-heading"><div><p className="page-kicker">{item.id}</p><h1>{item.fileName}</h1><span>{item.createdAt} · {item.resolution} · {item.sizeMb} MB</span></div><StatusBadge label={item.qualityStatus === "passed" ? "质量通过" : item.qualityStatus === "failed" ? "需要返工" : "等待质检"} tone={item.qualityStatus === "passed" ? "success" : item.qualityStatus === "failed" ? "danger" : "warning"} /></div>
      <div className="detail-grid">
        <section className="video-preview"><div><FileVideo size={42} /><strong>视频预览区域</strong><small>演示版本不加载真实原始视频</small></div><span>{Math.floor(item.durationSeconds / 60)}:{String(item.durationSeconds % 60).padStart(2, "0")}</span></section>
        <aside className="content-card score-panel"><div className="card-heading"><div><h2>质量结论</h2><p>模型 v2.8 自动评估</p></div><QualityScore score={item.finalScore} /></div><div className="score-meter"><i style={{ width: `${item.finalScore}%` }} /></div><dl><div><dt><Clock3 size={15} />有效计费时长</dt><dd>{effectiveDuration(item.durationSeconds, item.invalidSeconds)} 秒</dd></div><div><dt><Coins size={15} />预计收入</dt><dd>¥{income.toFixed(2)}</dd></div></dl></aside>
      </div>
      <div className="dashboard-grid"><section className="content-card"><div className="card-heading"><div><h2>AI 内容理解</h2><p>场景、动作、对象和关键标签</p></div><Sparkles size={18} /></div><div className="metadata-grid"><div><small>场景</small><strong>{item.scene}</strong></div><div><small>动作</small><strong>{item.action}</strong></div><div><small>操作对象</small><strong>{item.object}</strong></div></div><div className="tag-list">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section><aside className="content-card"><div className="card-heading"><div><h2>质量问题区间</h2><p>无效时长共 {item.invalidSeconds} 秒</p></div></div>{item.issues.length ? <div className="issue-list">{item.issues.map((issue) => <div key={`${issue.start}-${issue.end}`}><AlertTriangle size={15} /><span><strong>{issue.label}</strong><small>{issue.start}s — {issue.end}s</small></span></div>)}</div> : <div className="success-empty">未发现明显质量问题</div>}</aside></div>
    </div>
  );
}
