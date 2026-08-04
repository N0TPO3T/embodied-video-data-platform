"use client";

import {
  useRef,
  useState,
  type RefObject,
} from "react";
import type { AccountPublic } from "../../auth/contracts";
import { Modal } from "../../components/Modal";

export function AccountStatusModal({
  account,
  onConfirm,
  onClose,
  returnFocusRef,
}: {
  account: AccountPublic;
  onConfirm(): Promise<void>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const enabling = account.status === "disabled";
  const action = enabling ? "启用" : "停用";
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  function close() {
    if (submittingRef.current) return;
    setError("");
    onClose();
  }

  async function confirm() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm();
      submittingRef.current = false;
      setSubmitting(false);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : `${action}账号失败`,
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      title={`${action}账号`}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={confirmRef}
    >
      <div className="account-status-confirmation">
        <p>
          确认{action}“{account.displayName}（{account.username}）”吗？
        </p>
        {!enabling && (
          <p className="inline-alert inline-alert-error">
            停用后该账号的已登录会话将立即失效。
          </p>
        )}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={close}
            disabled={submitting}
          >
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="button button-primary"
            onClick={confirm}
            disabled={submitting}
          >
            {submitting ? `${action}中…` : `确认${action}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
