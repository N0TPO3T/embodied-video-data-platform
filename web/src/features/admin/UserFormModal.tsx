"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Modal } from "../../components/Modal";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { Role, User } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";

export function UserFormModal({
  open,
  mode,
  user,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  mode: "create" | "edit";
  user?: User;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { state, addUser, updateUser } = useDemoStore();
  const { notify } = useInteractions();
  const [name, setName] = useState("");
  const [account, setAccount] = useState("");
  const [role, setRole] = useState<Role>("collector");
  const [teamId, setTeamId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? "");
    setAccount(user?.account ?? "");
    setRole(user?.role ?? "collector");
    setTeamId(user?.teamId ?? state.teams[0]?.id ?? "");
    setError("");
    setSubmitting(false);
    submittingRef.current = false;
  }, [mode, open, state.teams, user]);

  function close() {
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
      if (mode === "create") {
        addUser({
          name,
          account,
          role,
          teamId: role === "admin" ? undefined : teamId,
        });
        notify("success", "用户已创建");
      } else if (user) {
        updateUser({
          userId: user.id,
          role,
          teamId: role === "admin" ? undefined : teamId,
        });
        notify("success", "用户配置已更新");
      }
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请重试");
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  const title = mode === "create" ? "新增用户" : "配置用户";
  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          姓名
          <input
            ref={firstInputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={mode === "edit"}
          />
        </label>
        <label>
          登录账号
          <input
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            disabled={mode === "edit"}
            autoComplete="username"
          />
        </label>
        <label>
          角色
          <select
            value={role}
            onChange={(event) => {
              const nextRole = event.target.value as Role;
              setRole(nextRole);
              if (nextRole !== "admin" && !teamId) {
                setTeamId(state.teams[0]?.id ?? "");
              }
            }}
          >
            <option value="collector">数采人员</option>
            <option value="leader">团长</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        {role !== "admin" && (
          <label>
            所属团队
            <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              {state.teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close}>取消</button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "保存中…" : mode === "create" ? "创建用户" : "保存配置"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
