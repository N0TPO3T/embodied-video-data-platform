"use client";

import { useRef, useState, type FormEvent, type RefObject } from "react";

import {
  createQualityLabel,
  updateQualityLabel,
} from "../../ai-quality/client/aiQualityApi";
import type { LabelSet } from "../../ai-quality/contracts";
import { Modal } from "../../components/Modal";
import type { LabelConfig } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";

export const labelTypeOptions: Array<{
  value: LabelConfig["type"];
  label: string;
}> = [
  { value: "scene", label: "场景" },
  { value: "action", label: "动作" },
  { value: "object", label: "对象" },
  { value: "issue", label: "质量问题" },
];

export function labelTypeLabel(type: LabelConfig["type"]): string {
  return labelTypeOptions.find((option) => option.value === type)?.label ?? type;
}

/** 标签体系页专用：新增 / 编辑标签 */
export function LabelFormModal({
  open,
  mode,
  label,
  defaultType,
  onPublished,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  mode: "create" | "edit";
  label?: LabelConfig;
  /** 新增时预选的标签类型（由点击的分区决定） */
  defaultType?: LabelConfig["type"];
  onPublished(labelSet: LabelSet): void;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { notify } = useInteractions();
  const [labelName, setLabelName] = useState(label?.name ?? "");
  const [labelId, setLabelId] = useState(label?.id ?? "");
  const [labelType, setLabelType] = useState<LabelConfig["type"]>(
    label?.type ?? defaultType ?? "scene",
  );
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
    const trimmedName = labelName.trim();
    if (!trimmedName) {
      setError("请填写标签名称");
      return;
    }
    if (
      mode === "edit" &&
      !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(labelId.trim().toUpperCase())
    ) {
      setError("标签编号只能包含大写字母、数字和连字符");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    try {
      if (mode === "create") {
        const published = await createQualityLabel({
          name: trimmedName,
          type: labelType,
          enabled,
        });
        onPublished(published);
        notify("success", "标签已新增");
      } else if (label) {
        const published = await updateQualityLabel({
          id: label.id,
          nextId: labelId.trim().toUpperCase(),
          name: trimmedName,
          enabled,
        });
        onPublished(published);
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
      title={mode === "create" ? "新增标签" : "编辑标签"}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        {mode === "edit" && (
          <label>
            标签编号
            <input
              ref={firstInputRef}
              aria-label="标签编号"
              maxLength={64}
              value={labelId}
              onChange={(event) => setLabelId(event.target.value.toUpperCase())}
              placeholder="SCENE-001"
              required
            />
            <small className="form-help">用于任务和标签体系关联，修改后会同步更新关联任务。</small>
          </label>
        )}
        <label>
          标签名称
          <input
            ref={mode === "edit" ? undefined : firstInputRef}
            value={labelName}
            onChange={(event) => setLabelName(event.target.value)}
            placeholder={labelTypeOptions.find((option) => option.value === labelType)?.label}
            required
            maxLength={120}
          />
        </label>
        {mode === "create" && (
          <label>
            标签类型
            <select
              aria-label="标签类型"
              value={labelType}
              onChange={(event) =>
                setLabelType(event.target.value as LabelConfig["type"])
              }
            >
              {labelTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="form-help">不同分区的标签独立管理，AI 质检按类型用于分类与问题判定。</small>
          </label>
        )}
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          启用标签
        </label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close}>
            取消
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "保存中…" : "保存标签"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
