"use client";

import { useRef, useState, type FormEvent, type RefObject } from "react";

import { Modal } from "../../components/Modal";
import { useInteractions } from "../../interactions/InteractionContext";
import { createPointRule } from "../../points/client/pointCycleApi";
import type {
  BackendPointRule,
  BackendPointRuleCoefficientBand,
} from "../../points/contracts";

const DEFAULT_BANDS: BackendPointRuleCoefficientBand[] = [
  { minScore: 80, maxScore: 100, ratio: 1, label: "优质" },
  { minScore: 70, maxScore: 79, ratio: 0.85, label: "合格" },
  { minScore: 60, maxScore: 69, ratio: 0.7, label: "基础" },
  { minScore: 0, maxScore: 59, ratio: 0, label: "不计分" },
];

export function PointRuleModal({
  open,
  currentRule,
  onCreated,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  currentRule?: BackendPointRule;
  onCreated(rule: BackendPointRule): void;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { notify } = useInteractions();
  const [version, setVersion] = useState("");
  const [defaultPoints, setDefaultPoints] = useState(
    String(currentRule?.defaultPointsPerMinute ?? 12),
  );
  const [description, setDescription] = useState(
    currentRule?.description ?? "",
  );
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
    const parsedPoints = Number(defaultPoints);
    if (!Number.isFinite(parsedPoints) || parsedPoints < 0) {
      setError("请输入有效的每分钟积分");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const rule = await createPointRule({
        version: version.trim(),
        defaultPointsPerMinute: parsedPoints,
        coefficientBands: currentRule?.coefficientBands ?? DEFAULT_BANDS,
        description,
      });
      onCreated(rule);
      notify("success", "积分规则已发布");
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请重试");
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <Modal
      open={open}
      title="发布积分规则"
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
            placeholder="POINTS-2026-09"
            required
          />
        </label>
        <label>
          默认每分钟积分
          <input
            type="number"
            min="0"
            step="0.01"
            value={defaultPoints}
            onChange={(event) => setDefaultPoints(event.target.value)}
          />
        </label>
        <label>
          规则说明
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="point-rule-band-preview">
          {(currentRule?.coefficientBands ?? DEFAULT_BANDS).map((band) => (
            <span key={`${band.minScore}-${band.maxScore}`}>
              {band.minScore === 0
                ? `低于 ${band.maxScore + 1} 分`
                : `${band.minScore}-${band.maxScore} 分`}
              ：{band.ratio.toFixed(2)}
            </span>
          ))}
        </div>
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
