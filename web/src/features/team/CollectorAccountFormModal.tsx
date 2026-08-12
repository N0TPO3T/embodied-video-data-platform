"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import type {
  AccountPublic,
  CreateAccountInput,
  UpdateAccountInput,
} from "../../auth/contracts";
import { Modal } from "../../components/Modal";

export function CollectorAccountFormModal({
  mode,
  account,
  team,
  onCreate,
  onUpdate,
  onClose,
  returnFocusRef,
}: {
  mode: "create" | "edit";
  account?: AccountPublic;
  team: Pick<import("../../auth/contracts").TeamPublic, "id" | "name">;
  onCreate(input: CreateAccountInput): Promise<AccountPublic>;
  onUpdate(
    id: string,
    input: UpdateAccountInput,
  ): Promise<AccountPublic>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [displayName, setDisplayName] = useState(
    account?.displayName ?? "",
  );
  const [username, setUsername] = useState(account?.username ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  function close() {
    if (submittingRef.current) return;
    setError("");
    setPassword("");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (mode === "create") {
        await onCreate({
          displayName,
          username,
          password,
          role: "collector",
          teamId: team.id,
        });
      } else if (account) {
        await onUpdate(account.id, {
          displayName,
          username: account.username,
          role: "collector",
          teamId: team.id,
        });
      }
      submittingRef.current = false;
      setSubmitting(false);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "保存失败，请重试",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const title = mode === "create" ? "新增数采账号" : "编辑数采账号";
  return (
    <Modal
      open
      title={title}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <p>账号将自动归属{team.name}</p>
        <label>
          显示名称
          <input
            ref={firstInputRef}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label>
          用户名
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            disabled={mode === "edit"}
            required
          />
        </label>
        {mode === "create" && (
          <label>
            初始密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={64}
              required
            />
          </label>
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
            type="submit"
            className="button button-primary"
            disabled={submitting}
          >
            {submitting
              ? "保存中…"
              : mode === "create"
                ? "创建数采账号"
                : "保存名称"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
