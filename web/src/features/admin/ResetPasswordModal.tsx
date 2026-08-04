"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type { AccountPublic } from "../../auth/contracts";
import { Modal } from "../../components/Modal";

export function ResetPasswordModal({
  account,
  onReset,
  onClose,
  returnFocusRef,
}: {
  account: AccountPublic;
  onReset(password: string): Promise<void>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  function close() {
    if (submittingRef.current) return;
    setPassword("");
    setConfirmation("");
    setError("");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    if (password.length < 8 || password.length > 64) {
      setError("密码长度需为 8 到 64 位");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onReset(password);
      setPassword("");
      setConfirmation("");
      submittingRef.current = false;
      setSubmitting(false);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "密码重置失败",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      title={`重置密码 · ${account.displayName}`}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          新密码
          <input
            ref={firstInputRef}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          确认新密码
          <input
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
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
            type="submit"
            className="button button-primary"
            disabled={submitting}
          >
            {submitting ? "重置中…" : "确认重置"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
