"use client";

import { CheckCircle2, CloudUpload, FileVideo, Info, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDemoStore } from "../../data/DemoStoreContext";
import { listActiveUploads } from "../../submissions/client/submissionApi";
import type { ActiveUploadResult } from "../../submissions/contracts";
import { resumeUploadVideo, uploadVideo } from "../../submissions/upload/multipartUploader";
import { uploadSizeError } from "../../submissions/upload/uploadLimits";

const isSupported = (file: File) => /\.(mov|mp4)$/i.test(file.name);

export function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const resumeTargetRef = useRef<ActiveUploadResult | null>(null);
  const [error, setError] = useState("");
  const [authorization, setAuthorization] = useState({
    dataUsageAuthorized: false,
    privacyConfirmed: false,
    sensitiveContentConfirmed: false,
  });
  const [activeUploads, setActiveUploads] = useState<ActiveUploadResult[]>([]);
  const [uploads, setUploads] = useState<Array<{
    key: string;
    name: string;
    progress: number;
    status: "hashing" | "uploading" | "queued" | "failed" | "paused";
    file?: File;
    session?: ActiveUploadResult;
    controller?: AbortController;
    error?: string;
  }>>([]);
  const { upsertSubmission } = useDemoStore();

  useEffect(() => {
    let active = true;
    listActiveUploads()
      .then((items) => {
        if (!active) return;
        setActiveUploads(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function updateUpload(
    key: string,
    values: Partial<(typeof uploads)[number]>,
  ) {
    setUploads((current) =>
      current.map((item) =>
        item.key === key ? { ...item, ...values } : item,
      ),
    );
  }

  async function upload(file: File, key: string) {
    const controller = new AbortController();
    updateUpload(key, { file, controller });
    try {
      const submission = await uploadVideo(file, {
        signal: controller.signal,
        authorization,
        onProgress: (progress) =>
          updateUpload(key, { progress, status: "uploading" }),
      });
      upsertSubmission(submission);
      updateUpload(key, { progress: 100, status: "queued", controller: undefined });
    } catch (reason) {
      if (controller.signal.aborted) {
        const active = await listActiveUploads().catch(() => []);
        const session = active.find(
          (item) =>
            item.submission.fileName === file.name &&
            Number(item.submission.sizeBytes) === file.size,
        );
        setActiveUploads(active);
        updateUpload(key, {
          status: "paused",
          file,
          session,
          controller: undefined,
          error: session ? "已暂停，可继续上传" : "已暂停，请在可恢复上传中继续",
        });
        return;
      }
      updateUpload(key, {
        status: "failed",
        controller: undefined,
        error: reason instanceof Error ? reason.message : "上传失败，请重试",
      });
    }
  }

  async function resumeUpload(
    file: File,
    session: ActiveUploadResult,
    key = `resume-${session.submission.id}`,
  ) {
    const controller = new AbortController();
    setUploads((current) => [
      {
        key,
        name: session.submission.fileName,
        progress: 0,
        status: "uploading",
        file,
        session,
        controller,
      },
      ...current.filter((item) => item.key !== key),
    ]);
    try {
      const submission = await resumeUploadVideo(file, session, {
        signal: controller.signal,
        onProgress: (progress) =>
          updateUpload(key, { progress, status: "uploading" }),
      });
      upsertSubmission(submission);
      setActiveUploads((current) =>
        current.filter((item) => item.submission.id !== session.submission.id),
      );
      updateUpload(key, { progress: 100, status: "queued", controller: undefined });
    } catch (reason) {
      if (controller.signal.aborted) {
        updateUpload(key, {
          status: "paused",
          file,
          session,
          controller: undefined,
          error: "已暂停，可继续上传",
        });
        return;
      }
      updateUpload(key, {
        status: "failed",
        controller: undefined,
        error:
          reason instanceof Error
            ? reason.message
            : "恢复上传失败，请重新选择原文件",
      });
    }
  }

  function pauseUpload(key: string) {
    setUploads((current) => {
      const target = current.find((item) => item.key === key);
      target?.controller?.abort();
      return current;
    });
  }

  function continueUpload(item: (typeof uploads)[number]) {
    if (!item.file || !item.session) return;
    void resumeUpload(item.file, item.session, item.key);
  }

  function chooseResumeFile(session: ActiveUploadResult) {
    resumeTargetRef.current = session;
    resumeInputRef.current?.click();
  }

  function acceptResumeFile(file?: File) {
    const session = resumeTargetRef.current;
    resumeTargetRef.current = null;
    if (!file || !session) return;
    void resumeUpload(file, session);
    if (resumeInputRef.current) resumeInputRef.current.value = "";
  }

  function acceptFiles(files: File[]) {
    const supported = files.filter(isSupported);
    const valid = supported.filter((file) => !uploadSizeError(file));
    if (supported.length !== files.length) {
      setError("仅支持 MOV 和 MP4 视频");
    } else {
      const sizeError = supported
        .map((file) => uploadSizeError(file))
        .find((message): message is string => Boolean(message));
      setError(sizeError ?? "");
    }
    if (!valid.length) return;
    if (
      !authorization.dataUsageAuthorized ||
      !authorization.privacyConfirmed ||
      !authorization.sensitiveContentConfirmed
    ) {
      setError("上传前请先确认数据授权、隐私规范和敏感内容处理要求");
      return;
    }
    const created = valid.map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      status: "hashing" as const,
      file,
    }));
    setUploads((current) => [
      ...created.map(({ key, name, progress, status, file }) => ({
        key,
        name,
        progress,
        status,
        file,
      })),
      ...current,
    ]);
    for (const item of created) void upload(item.file, item.key);
  }

  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">视频数据入口</p><h1>上传视频</h1><span>支持批量选择，系统会为每个文件创建独立处理任务</span></div></div>
      <section className="upload-layout">
        <div className="content-card upload-main-card">
          <input ref={inputRef} className="file-input" aria-label="选择视频文件" accept=".mov,.mp4,video/quicktime,video/mp4" multiple type="file" onChange={(event) => acceptFiles(Array.from(event.target.files ?? []))} />
          <input ref={resumeInputRef} className="file-input" aria-label="选择恢复上传文件" accept=".mov,.mp4,video/quicktime,video/mp4" type="file" onChange={(event) => acceptResumeFile(event.target.files?.[0])} />
          <div className="upload-consent-panel">
            <label><input type="checkbox" checked={authorization.dataUsageAuthorized} onChange={(event) => setAuthorization((current) => ({ ...current, dataUsageAuthorized: event.target.checked }))} />我确认拥有本次上传视频的数据使用授权</label>
            <label><input type="checkbox" checked={authorization.privacyConfirmed} onChange={(event) => setAuthorization((current) => ({ ...current, privacyConfirmed: event.target.checked }))} />我已按隐私规范检查人脸、门牌、屏幕账号、定位等信息</label>
            <label><input type="checkbox" checked={authorization.sensitiveContentConfirmed} onChange={(event) => setAuthorization((current) => ({ ...current, sensitiveContentConfirmed: event.target.checked }))} />我确认发现敏感内容时已遮挡、重采或按要求处理</label>
          </div>
          <button
            className="upload-dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              acceptFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <span><CloudUpload size={27} /></span>
            <strong>点击选择或拖拽视频到这里</strong>
            <small>MOV、MP4 格式 · 单文件最大 2 GiB · 支持批量上传</small>
            <em>选择视频文件</em>
          </button>
          {error && <div className="inline-alert inline-alert-error"><XCircle size={16} />{error}</div>}
          {activeUploads.length > 0 && <div className="upload-queue"><div className="card-heading"><div><h2>可恢复上传</h2><p>刷新前未完成的任务，可重新选择原文件继续上传</p></div></div>{activeUploads.map((item) => <div className="upload-item" key={item.submission.id}><span><FileVideo size={18} /></span><div><strong>{item.submission.fileName}</strong><small>{item.upload.partCount} 个分片 · 需要选择同名同大小文件</small></div><button className="table-action" onClick={() => chooseResumeFile(item)}>继续上传</button></div>)}</div>}
          <div className="upload-queue">
            <div className="card-heading"><div><h2>本次上传</h2><p>{uploads.length ? `${uploads.length} 个视频上传任务` : "选择文件后在此查看上传进度"}</p></div></div>
            {uploads.length ? uploads.map((item) => (
              <div className="upload-item" key={item.key}>
                <span><FileVideo size={18} /></span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.status === "hashing"
                      ? "正在计算文件校验值"
                      : item.status === "uploading"
                        ? `正在上传 ${item.progress}%`
                        : item.status === "queued"
                          ? "上传完成，等待媒体处理"
                          : item.status === "paused"
                            ? item.error ?? "已暂停，可继续上传"
                          : item.error ?? "上传失败，请重试"}
                  </small>
                  <i><b style={{ width: `${item.progress}%` }} /></i>
                </div>
                {item.status === "uploading" ? <button className="table-action" onClick={() => pauseUpload(item.key)}>暂停</button> : null}
                {item.status === "paused" && item.session ? <button className="table-action" onClick={() => continueUpload(item)}>继续</button> : null}
                {item.status === "queued" ? <CheckCircle2 className="upload-icon-ok" size={18} /> : item.status === "failed" ? <XCircle className="upload-icon-failed" size={18} /> : item.status === "paused" ? <Info className="upload-icon-paused" size={18} /> : <CloudUpload className="upload-icon-active" size={18} />}
              </div>
            )) : <div className="empty-inline">暂无待上传文件</div>}
          </div>
        </div>
        <aside className="content-card upload-guide-card">
          <div className="card-heading"><div><h2>上传前检查</h2><p>符合要求的数据更容易通过质检</p></div></div>
          <ul className="check-list"><li><ShieldCheck size={16} /><span><strong>第一视角连续拍摄</strong><small>保持双手和主要操作对象始终可见</small></span></li><li><ShieldCheck size={16} /><span><strong>画面清晰稳定</strong><small>避免过曝、严重晃动和长时间遮挡</small></span></li><li><ShieldCheck size={16} /><span><strong>单一完整任务</strong><small>从准备到收尾保留完整动作链路</small></span></li></ul>
          <div className="tip-box"><Info size={16} /><span><strong>隐私提示</strong>上传前请确认画面中不包含人脸、门牌、屏幕账号等敏感信息。</span></div>
        </aside>
      </section>
    </div>
  );
}
