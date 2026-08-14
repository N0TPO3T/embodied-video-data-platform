import { AlertTriangle, ArrowLeft, Clock3, Coins, CopyCheck, FileVideo, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { QualityScore } from "../../components/QualityScore";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";
import { effectiveDuration, estimatePoints } from "../../domain/calculations";
import type { Submission } from "../../domain/types";
import { getPointRule } from "../../points/client/pointCycleApi";
import type { BackendPointRule } from "../../points/contracts";
import {
  getSubmission,
  getSubmissionPreview,
} from "../../submissions/client/submissionApi";
import type { BackendSubmissionPreview } from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

export function SubmissionDetail({
  id,
  navigate,
  backPath = "/collector/submissions",
  backLabel = "返回我的数据",
}: {
  id: string;
  navigate(path: string): void;
  backPath?: string;
  backLabel?: string;
}) {
  const { state, currentUser } = useDemoStore();
  const [item, setItem] = useState<Submission | null>(null);
  const [detailState, setDetailState] = useState<"loading" | "ready" | "missing">("loading");
  const [preview, setPreview] = useState<BackendSubmissionPreview | null>(null);
  const [previewState, setPreviewState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [pointRule, setPointRule] = useState<BackendPointRule | null>(null);
  const [pointRuleState, setPointRuleState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  useEffect(() => {
    let active = true;
    setDetailState("loading");
    setItem(null);
    getSubmission(id)
      .then((submission) => {
        if (!active) return;
        setItem(backendSubmissionToDomain(submission));
        setDetailState("ready");
      })
      .catch(() => {
        if (!active) return;
        const fallback = state.submissions.find(
          (submission) =>
            submission.id === id &&
            (currentUser.role === "admin" ||
              submission.ownerId === currentUser.id),
        );
        setItem(fallback ?? null);
        setDetailState(fallback ? "ready" : "missing");
      });
    return () => {
      active = false;
    };
  }, [currentUser.id, id, state.submissions]);
  useEffect(() => {
    let active = true;
    setPreviewState("loading");
    setPreview(null);
    getSubmissionPreview(id)
      .then((nextPreview) => {
        if (!active) return;
        setPreview(nextPreview);
        setPreviewState("ready");
      })
      .catch(() => {
        if (!active) return;
        setPreviewState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    let active = true;
    getPointRule()
      .then((rule) => {
        if (!active) return;
        setPointRule(rule);
        setPointRuleState("ready");
      })
      .catch(() => {
        if (active) setPointRuleState("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);
  if (detailState === "loading") {
    return (
      <div className="empty-state">
        <FileVideo size={28} />
        <strong>正在读取这条数据</strong>
        <span>请稍候</span>
      </div>
    );
  }
  if (!item) {
    return <div className="empty-state"><FileVideo size={28} /><strong>找不到这条数据</strong><button className="text-button" onClick={() => navigate(backPath)}>{backLabel}</button></div>;
  }
  const submissionTeam = state.teams.find((team) => team.id === item.teamId);
  const teamPointsPerMinute = submissionTeam?.unitPricePerMinute ?? 0;
  const points = pointRule
    ? item.qualityStatus === "passed"
      ? estimatePoints(
          teamPointsPerMinute > 0
            ? teamPointsPerMinute
            : pointRule.defaultPointsPerMinute,
          item.durationSeconds,
          item.invalidSeconds,
          item.finalScore,
          pointRule.coefficientBands,
        )
      : 0
    : null;
  const pointsLabel = item.qualityStatus === "pending"
    ? "—"
    : points === null
      ? pointRuleState === "loading"
        ? "规则读取中"
        : "规则不可用"
      : `${points.toFixed(2)} 分`;
  const quality = item.qualityResult;
  const duplicateCandidate = item.duplicateCandidates?.find(
    (candidate) => candidate.status === "candidate",
  );
  const evidenceByRange = new Map(
    (preview?.evidenceFrames ?? []).map((frame) => [
      `${Math.round(frame.startSeconds * 1_000)}-${Math.round(frame.endSeconds * 1_000)}`,
      frame,
    ]),
  );
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
      <button className="back-page" onClick={() => navigate(backPath)}><ArrowLeft size={16} />{backLabel}</button>
      <div className="page-heading"><div><p className="page-kicker">{item.id}</p><h1>{item.fileName}</h1><span>{item.createdAt} · {item.resolution} · {item.sizeMb} MB</span></div><StatusBadge label={label} tone={tone} /></div>
      {item.assetStatus === "quarantined" && <div className="form-message error">该视频已进入敏感隔离区：{item.quarantine?.reason ?? "敏感内容隔离"}</div>}
      {item.storageStatus === "deleted" && <div className="form-message error">该视频对象已删除：{item.storage?.deleteReason ?? "对象已删除"}</div>}
      {duplicateCandidate && <div className="form-message warning"><CopyCheck size={14} />该视频疑似与 {duplicateCandidate.candidateFileName ?? duplicateCandidate.candidateSubmissionId} 重复，相似度 {Math.round(duplicateCandidate.similarity * 100)}%，管理员确认前不会进入积分锁定。</div>}
      <div className="detail-grid">
        <section className="video-preview">{preview ? <><video controls preload="metadata" poster={preview.thumbnail?.url} aria-label={`${preview.fileName} 预览`}>{preview.hls ? <source src={preview.hls.url} type={preview.hls.contentType} /> : null}<source src={preview.url} type={preview.contentType} /></video><span>{preview.hls ? `HLS ${preview.hls.qualities.map((quality) => quality.quality).join(" / ")}` : `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}`}</span></> : <div><FileVideo size={42} /><strong>{previewState === "loading" ? "正在生成预览地址" : "已保存原始视频"}</strong><small>{previewState === "unavailable" ? "当前无法取得短期预览地址" : "视频证据存储于本地对象存储"}</small></div>} {!preview ? <span>{Math.floor(item.durationSeconds / 60)}:{String(item.durationSeconds % 60).padStart(2, "0")}</span> : null}</section>
        <aside className="content-card score-panel">
          <div className="card-heading"><div><h2>质量结论</h2><p>{quality ? `${quality.initialModel} · 提示词 V${quality.promptRevision}` : "等待正式 AI 结果"}</p></div><QualityScore score={item.finalScore} ratio={quality?.settlementRatio} passed={quality?.passed} /></div>
          <div className="score-meter"><i style={{ width: `${item.finalScore}%` }} /></div>
          <dl><div><dt><Clock3 size={15} />有效积分时长</dt><dd>{effectiveDuration(item.durationSeconds, item.invalidSeconds)} 秒</dd></div><div><dt><Coins size={15} />预计积分</dt><dd>{pointsLabel}</dd></div></dl>
          {quality?.summary && <p className="quality-summary">{quality.summary}</p>}
          {quality?.lastError && <p className="form-message error">{quality.lastError}</p>}
        </aside>
      </div>
      <div className="dashboard-grid">
        <section className="content-card"><div className="card-heading"><div><h2>AI 内容理解</h2><p>场景、任务和对象来自持久化模型结果</p></div><Sparkles size={18} /></div><div className="metadata-grid"><div><small>场景</small><strong>{item.scene}</strong></div><div><small>动作</small><strong>{item.action}</strong></div><div><small>操作对象</small><strong>{item.object}</strong></div></div>{quality?.recommendations.length ? <div className="recommend-list">{quality.recommendations.map((recommendation, index) => <div key={`${index}-${recommendation}`}><em>{String(index + 1).padStart(2, "0")}</em><span><strong>{recommendation}</strong></span></div>)}</div> : null}</section>
        <aside className="content-card"><div className="card-heading"><div><h2>质量问题区间</h2><p>无效时长共 {item.invalidSeconds} 秒</p></div></div>{item.issues.length ? <div className="issue-list">{item.issues.map((issue) => {
          const evidence = evidenceByRange.get(`${Math.round(issue.start * 1_000)}-${Math.round(issue.end * 1_000)}`);
          return <div key={`${issue.label}-${issue.start}-${issue.end}`}><AlertTriangle size={15} />{evidence ? <img src={evidence.url} alt={`${issue.label} 证据帧`} /> : null}<span><strong>{issue.label}</strong><small>{issue.start}s — {issue.end}s</small></span></div>;
        })}</div> : <div className="success-empty">未发现明显质量问题</div>}</aside>
      </div>
    </div>
  );
}
