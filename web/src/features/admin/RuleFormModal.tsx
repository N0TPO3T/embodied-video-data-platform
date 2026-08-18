"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  AiQualityApiError,
  createQualityRule,
  updateQualityLabel,
} from "../../ai-quality/client/aiQualityApi";
import type { LabelSet, QualityRule } from "../../ai-quality/contracts";
import { Modal } from "../../components/Modal";
import { demoFallbackEnabled } from "../../config/demoFallback";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { LabelConfig } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";

export function RuleFormModal({
  open,
  mode,
  label,
  currentRule,
  onRulePublished,
  onLabelSetPublished,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  mode: "rule" | "label";
  label?: LabelConfig;
  currentRule?: Pick<QualityRule, "passThreshold">;
  onRulePublished?(rule: QualityRule): void;
  onLabelSetPublished?(labelSet: LabelSet): void;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { state, createRuleVersion, updateLabel } = useDemoStore();
  const { notify } = useInteractions();
  const [version, setVersion] = useState("");
  const [threshold, setThreshold] = useState(
    String(currentRule?.passThreshold ?? state.rule.passThreshold),
  );
  const [description, setDescription] = useState("");
  const [labelName, setLabelName] = useState(label?.name ?? "");
  const [enabled, setEnabled] = useState(label?.enabled ?? true);
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
    if (mode === "rule") {
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
    } else if (!labelName.trim()) {
      setError("请填写标签名称");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    try {
      if (mode === "rule") {
        const input = {
          version: version.trim(),
          passThreshold: Number(threshold),
          description,
        };
        try {
          const published = await createQualityRule(input);
          onRulePublished?.(published);
        } catch (caught) {
          if (
            !demoFallbackEnabled ||
            (caught instanceof AiQualityApiError && caught.status < 500)
          ) {
            throw caught;
          }
          createRuleVersion(input);
        }
        notify("success", "规则版本已发布");
      } else if (label) {
        const input = { id: label.id, name: labelName.trim(), enabled };
        try {
          const published = await updateQualityLabel(input);
          onLabelSetPublished?.(published);
        } catch (caught) {
          if (
            !demoFallbackEnabled ||
            (caught instanceof AiQualityApiError && caught.status < 500)
          ) {
            throw caught;
          }
          updateLabel(input);
        }
        notify("success", "标签已更新");
      }
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
      title={mode === "rule" ? "新建规则版本" : "编辑标签"}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        {mode === "rule" ? (
          <>
            <label>
              版本名称
              <input ref={firstInputRef} value={version} onChange={(event) => setVersion(event.target.value)} placeholder="RULE-2026-09" required />
            </label>
            <label>
              通过阈值
              <input type="number" min="0" max="100" step="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} required />
            </label>
            <label>
              规则说明
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label>
              标签名称
              <input ref={firstInputRef} value={labelName} onChange={(event) => setLabelName(event.target.value)} required />
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              启用标签
            </label>
          </>
        )}
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close}>取消</button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "保存中…" : mode === "rule" ? "发布规则" : "保存标签"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
