"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Modal } from "../../components/Modal";
import { useDemoStore } from "../../data/DemoStoreContext";
import { useInteractions } from "../../interactions/InteractionContext";

export function InviteMemberModal({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { inviteMember } = useDemoStore();
  const { notify } = useInteractions();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  function resetAndClose() {
    setName("");
    setPhone("");
    setError("");
    setSubmitting(false);
    submittingRef.current = false;
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    try {
      inviteMember({ name, phone });
      notify("success", "成员已加入团队");
      resetAndClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "邀请失败，请重试");
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <Modal
      open={open}
      title="邀请成员"
      onClose={resetAndClose}
      returnFocusRef={returnFocusRef}
      initialFocusRef={nameRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          成员姓名
          <input
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </label>
        <label>
          手机号
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="11 位大陆手机号"
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
            onClick={resetAndClose}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={submitting}
          >
            {submitting ? "邀请中…" : "确认邀请"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
