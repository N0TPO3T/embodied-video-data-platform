"use client";

import { FileVideo, Play, RefreshCw, RotateCcw, Scissors } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  generateTaskSegments,
  getTaskSegmentAssets,
  getTaskSegmentPreview,
  retryTaskSegment,
} from "../operations/client/operationsApi";
import type { BackendTaskSegmentAsset } from "../operations/contracts";
import { StatusBadge } from "./StatusBadge";

function status(asset: BackendTaskSegmentAsset) {
  switch (asset.generationStatus) {
    case "ready":
      return { label: "ready", tone: "success" as const };
    case "failed":
      return { label: "failed", tone: "danger" as const };
    case "skipped":
      return { label: "skipped", tone: "warning" as const };
    case "processing":
      return { label: "processing", tone: "info" as const };
    default:
      return { label: "queued", tone: "neutral" as const };
  }
}

function timestamp(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = Math.round(safe % 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function fileSize(value: string | null): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
}

export function TaskSegmentDemo({
  annotationRunId,
  submissionId,
  canGenerate,
}: {
  annotationRunId: string;
  submissionId: string;
  canGenerate: boolean;
}) {
  const [assets, setAssets] = useState<BackendTaskSegmentAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const load = useCallback(async (quiet = false) => {
    try {
      const result = await getTaskSegmentAssets({
        annotationRunId,
        page: 1,
        pageSize: 50,
      });
      setAssets(result.assets);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "任务片段读取失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [annotationRunId]);

  async function refresh() {
    setLoading(true);
    await load();
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const hasActiveAssets = useMemo(
    () => assets.some(
      (asset) =>
        asset.generationStatus === "queued" ||
        asset.generationStatus === "processing",
    ),
    [assets],
  );

  useEffect(() => {
    if (!hasActiveAssets) return;
    const timer = window.setInterval(() => void load(true), 2_000);
    return () => window.clearInterval(timer);
  }, [hasActiveAssets, load]);

  async function generate() {
    try {
      setSaving(true);
      setError("");
      const result = await generateTaskSegments(annotationRunId);
      setMessage(
        `任务 ${result.taskCount} 个：新建 ${result.created}，已有 ${result.existing}，跳过 ${result.skipped}`,
      );
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "任务片段生成触发失败");
    } finally {
      setSaving(false);
    }
  }

  async function retry(assetId: string) {
    try {
      setSaving(true);
      setError("");
      await retryTaskSegment(assetId);
      setMessage("失败片段已重新排队");
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "片段重试失败");
    } finally {
      setSaving(false);
    }
  }

  async function play(assetId: string) {
    try {
      setError("");
      const preview = await getTaskSegmentPreview(assetId);
      setPreviewUrls((current) => ({ ...current, [assetId]: preview.url }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "片段预览失败");
    }
  }

  return (
    <section className="task-segment-demo" aria-label="任务片段 Demo">
      <div className="ai-conclusion-head">
        <span><Scissors size={14} />任务片段 Demo</span>
        <StatusBadge label="internal_only" tone="info" />
      </div>
      <small className="field-hint">
        {annotationRunId} · task_segment_demo_policy_v1 · DEMO_DEFAULT
      </small>
      <div className="task-segment-actions">
        <button
          className="table-action"
          type="button"
          disabled={saving || !canGenerate}
          onClick={() => void generate()}
        >
          <Scissors size={15} />生成任务片段
        </button>
        <button
          className="table-action"
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />刷新
        </button>
      </div>
      {!canGenerate ? (
        <p className="form-message info">只有正式 auto_accepted 或 human_verified Run 可以生成。</p>
      ) : null}
      {message ? <p className="form-message info">{message}</p> : null}
      {error ? <p className="form-message error">{error}</p> : null}
      {loading ? (
        <p><FileVideo size={15} />正在读取任务片段…</p>
      ) : assets.length === 0 ? (
        <p>尚未生成任务片段。</p>
      ) : (
        <div className="task-segment-list">
          {assets.map((asset) => {
            const currentStatus = status(asset);
            return (
              <fieldset className="issue-editor task-segment-card" key={asset.id}>
                <legend>Task #{asset.taskIndex} · {asset.taskLabel}</legend>
                <div className="issue-editor-heading">
                  <span>{timestamp(asset.clipStartMs)} → {timestamp(asset.clipEndMs)}</span>
                  <StatusBadge label={currentStatus.label} tone={currentStatus.tone} />
                </div>
                <small>{asset.completion} / {asset.resultStatus} · {asset.taskVerb}</small>
                <small>
                  Run：<a href={`/admin/ai/annotation-runs/${encodeURIComponent(asset.annotationRunId)}/review`}>{asset.annotationRunId}</a>
                </small>
                <small>
                  Submission：<a href={`/admin/submissions/${encodeURIComponent(submissionId)}`}>{submissionId}</a>
                </small>
                <small>MinIO Key：<code>{asset.clipObjectKey ?? "—"}</code></small>
                <small>SHA-256：<code>{asset.clipSha256 ?? "—"}</code></small>
                <small>
                  时长 {asset.clipDurationMs === null ? "—" : `${asset.clipDurationMs}ms`} · {fileSize(asset.clipSizeBytes)}
                  {asset.codec
                    ? ` · ${asset.codec} ${asset.width}×${asset.height} @ ${asset.frameRate?.toFixed(2)}fps`
                    : ""}
                  {asset.hasAudio === null ? "" : asset.hasAudio ? " · 含音频" : " · 无音频"}
                </small>
                {asset.validationWarnings.length > 0 ? (
                  <details>
                    <summary>技术校验 warning（{asset.validationWarnings.length}）</summary>
                    <pre>{asset.validationWarnings.join("\n")}</pre>
                  </details>
                ) : null}
                {asset.failureMessage ? (
                  <p className="form-message error">{asset.failureCode}：{asset.failureMessage}</p>
                ) : null}
                {asset.generationStatus === "ready" ? (
                  <button className="table-action" type="button" onClick={() => void play(asset.id)}>
                    <Play size={14} />播放片段
                  </button>
                ) : null}
                {asset.generationStatus === "failed" || asset.generationStatus === "skipped" ? (
                  <button
                    className="table-action"
                    disabled={saving}
                    type="button"
                    onClick={() => void retry(asset.id)}
                  >
                    <RotateCcw size={14} />重新生成
                  </button>
                ) : null}
                {previewUrls[asset.id] ? (
                  <video className="task-segment-player" controls preload="metadata">
                    <source src={previewUrls[asset.id]} type="video/mp4" />
                  </video>
                ) : null}
              </fieldset>
            );
          })}
        </div>
      )}
    </section>
  );
}
