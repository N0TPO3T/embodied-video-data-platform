"use client";

import { useRef, useState, type FormEvent, type RefObject } from "react";

import { Modal } from "../../components/Modal";
import type { Submission } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";
import { rerunAiQuality } from "../../submissions/client/submissionApi";
import type { BackendSubmission } from "../../submissions/contracts";

export function AiRerunModal({
  submission,
  open,
  onClose,
  onRerun,
  returnFocusRef,
}: {
  submission: Submission | null;
  open: boolean;
  onClose(): void;
  onRerun(submission: BackendSubmission): void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const { notify } = useInteractions();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!submission || saving) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("请填写重跑原因");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await rerunAiQuality(submission.id, { reason: trimmed });
      onRerun(updated);
      notify("success", "AI 质检已重新排队");
      setReason("");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重跑失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="重跑 AI 质检"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      initialFocusRef={reasonRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          提交编号
          <input value={submission?.id ?? ""} disabled />
        </label>
        <label>
          重跑原因
          <textarea
            ref={reasonRef}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError("");
            }}
            placeholder="例如：模型服务恢复，重新排队质检"
            required
          />
        </label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={saving}
          >
            {saving ? "提交中" : "确认重跑"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
