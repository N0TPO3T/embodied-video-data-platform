"use client";

import { CheckCircle2, CloudUpload, FileVideo, Info, ShieldCheck, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { useDemoStore } from "../../data/DemoStoreContext";
import { uploadVideo } from "../../submissions/upload/multipartUploader";

const isSupported = (file: File) => /\.(mov|mp4)$/i.test(file.name);

export function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<Array<{
    key: string;
    name: string;
    progress: number;
    status: "hashing" | "uploading" | "queued" | "failed";
    error?: string;
  }>>([]);
  const { upsertSubmission } = useDemoStore();

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
    try {
      const submission = await uploadVideo(file, {
        onProgress: (progress) =>
          updateUpload(key, { progress, status: "uploading" }),
      });
      upsertSubmission(submission);
      updateUpload(key, { progress: 100, status: "queued" });
    } catch (reason) {
      updateUpload(key, {
        status: "failed",
        error: reason instanceof Error ? reason.message : "上传失败，请重试",
      });
    }
  }

  function acceptFiles(files: File[]) {
    const valid = files.filter(isSupported);
    if (valid.length !== files.length) setError("仅支持 MOV 和 MP4 视频");
    else setError("");
    if (!valid.length) return;
    const created = valid.map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      status: "hashing" as const,
      file,
    }));
    setUploads((current) => [
      ...created.map(({ key, name, progress, status }) => ({
        key,
        name,
        progress,
        status,
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
          <button className="upload-dropzone" onClick={() => inputRef.current?.click()}>
            <span><CloudUpload size={27} /></span>
            <strong>点击选择或拖拽视频到这里</strong>
            <small>MOV、MP4 格式 · 单文件建议不超过 2GB · 支持批量上传</small>
            <em>选择视频文件</em>
          </button>
          {error && <div className="inline-alert inline-alert-error"><XCircle size={16} />{error}</div>}
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
                          : item.error ?? "上传失败，请重试"}
                  </small>
                  <i><b style={{ width: `${item.progress}%` }} /></i>
                </div>
                {item.status === "queued" ? <CheckCircle2 size={18} /> : item.status === "failed" ? <XCircle size={18} /> : <CloudUpload size={18} />}
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
