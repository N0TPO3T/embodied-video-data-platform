"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { createQualityRule } from "../../ai-quality/client/aiQualityApi";
import type { QualityRule } from "../../ai-quality/contracts";
import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";

/** 规则与提示词页：新建质量规则版本 */
export function RuleFormModal({
  open,
  currentRule,
  onRulePublished,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  currentRule?: Pick<QualityRule, "passThreshold">;
  onRulePublished(rule: QualityRule): void;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { notify } = useInteractions();
  const [version, setVersion] = useState("");
  const [threshold, setThreshold] = useState(
    String(currentRule?.passThreshold ?? 60),
  );
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  function close() {
    if (submittingRef.current) return;
    setError("");
    setSubmitting(false);
    submittingRef.current = false;
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!version.trim()) {
      setError("请填写版本名称");
      return;
    }
    const parsedThreshold = Number(threshold);
    if (
      !Number.isFinite(parsedThreshold) ||
      parsedThreshold < 0 ||
      parsedThreshold > 100
    ) {
      setError("请输入 0 到 100 之间的通过阈值");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    try {
      const input = {
        version: version.trim(),
        passThreshold: parsedThreshold,
        description,
      };
      const published = await createQualityRule(input);
      onRulePublished(published);
      notify("success", "规则版本已发布");
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请重试");
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <Modal
      open={open}
      title="新建规则版本"
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          版本名称
          <input
            ref={firstInputRef}
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="RULE-2026-09"
            required
          />
        </label>
        <label>
          通过阈值
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            required
          />
        </label>
        <label>
          规则说明
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close}>
            取消
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "保存中…" : "发布规则"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
