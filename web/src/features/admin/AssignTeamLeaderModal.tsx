"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import type { AccountPublic, TeamPublic } from "../../auth/contracts";
import { Modal } from "../../components/Modal";

export function AssignTeamLeaderModal({
  team,
  accounts,
  onAssign,
  onClose,
  returnFocusRef,
}: {
  team: TeamPublic;
  accounts: AccountPublic[];
  onAssign(accountId: string): Promise<void>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const candidates = accounts.filter(
    (account) => account.teamId === team.id && account.status === "active",
  );
  const currentLeaders = candidates.filter((account) => account.role === "leader");
  const [accountId, setAccountId] = useState(
    currentLeaders[0]?.id ?? candidates[0]?.id ?? "",
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const selectRef = useRef<HTMLElement>(null);

  function close() {
    if (submittingRef.current) return;
    setError("");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onAssign(accountId);
      submittingRef.current = false;
      setSubmitting(false);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "指定团长失败");
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      title={`指定团长 · ${team.name}`}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={selectRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <p>
          新团长必须是本团队的启用账号。现有其他团长会自动调整为数采人员，相关账号需重新登录。
        </p>
        <label>
          团长账号
          <select
            ref={selectRef as import("react").RefObject<HTMLSelectElement | null>}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            disabled={candidates.length === 0}
            required
          >
            <option value="" disabled>请选择成员</option>
            {candidates.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName}（{account.username}）
                {account.role === "leader" ? " · 现任团长" : ""}
              </option>
            ))}
          </select>
        </label>
        {candidates.length === 0 && (
          <p className="inline-alert inline-alert-error">
            该团队暂无启用账号。请先创建或启用一个团队成员。
          </p>
        )}
        {error && <p className="modal-error" role="alert">{error}</p>}
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
            disabled={
              submitting ||
              !accountId ||
              (currentLeaders.length === 1 && accountId === currentLeaders[0]?.id)
            }
          >
            {submitting ? "指定中…" : "确认指定"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
