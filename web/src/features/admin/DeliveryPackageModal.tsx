"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Modal } from "../../components/Modal";
import { useDemoStore } from "../../data/DemoStoreContext";
import { useInteractions } from "../../interactions/InteractionContext";

export function DeliveryPackageModal({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { state, createDeliveryPackage } = useDemoStore();
  const { notify } = useInteractions();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const assetCount = state.submissions.filter(
    (item) => item.settlementStatus === "settled" && item.qualityStatus === "passed",
  ).length;

  useEffect(() => {
    if (!open) return;
    setName("");
    setError("");
    setSubmitting(false);
    submittingRef.current = false;
  }, [open]);

  function close() {
    setName("");
    setError("");
    setSubmitting(false);
    submittingRef.current = false;
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || assetCount === 0) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      createDeliveryPackage({ name });
      notify("success", "交付包已创建");
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "交付包创建失败");
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <Modal open={open} title="创建交付包" onClose={close} returnFocusRef={returnFocusRef} initialFocusRef={nameRef}>
      <form className="modal-form" onSubmit={submit}>
        <div className="delivery-count"><small>当前已结算且质检通过</small><strong>{assetCount} 条可交付资产</strong></div>
        <label>
          交付包名称
          <input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：八月家庭任务包" />
        </label>
        {assetCount === 0 && <p className="modal-error">当前没有可交付资产</p>}
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close}>取消</button>
          <button type="submit" className="button button-primary" disabled={assetCount === 0 || submitting}>
            {submitting ? "创建中…" : "确认创建"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
