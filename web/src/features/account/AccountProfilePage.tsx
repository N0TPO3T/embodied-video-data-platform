"use client";

import { ShieldCheck, UserRound } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import {
  AccountApiError,
  changeOwnPassword,
} from "../../auth/client/accountApi";
import { useIdentity } from "../../auth/client/IdentityContext";

const roleLabels = {
  collector: "数采人员",
  leader: "团长",
  admin: "平台管理员",
};

const statusLabels = {
  active: "正常",
  disabled: "已停用",
};

export function AccountProfilePage() {
  const { currentAccount, teams } = useIdentity();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const team = teams.find((candidate) => candidate.id === currentAccount.teamId);

  function clearPasswords() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (newPassword !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 64) {
      setError("密码长度需为 8 到 64 位");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await changeOwnPassword(currentPassword, newPassword);
      clearPasswords();
      window.location.assign("/login");
    } catch (reason) {
      clearPasswords();
      setError(
        reason instanceof AccountApiError
          ? reason.message
          : "修改密码失败，请稍后重试",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">个人账号</p>
          <h1>个人资料</h1>
          <span>查看账号信息并修改登录密码</span>
        </div>
      </div>
      <div className="profile-grid">
        <aside className="content-card profile-card">
          <span className="profile-avatar">
            {currentAccount.displayName.slice(0, 1)}
          </span>
          <h2>{currentAccount.displayName}</h2>
          <p>{roleLabels[currentAccount.role]}</p>
          <div>
            <span>
              <UserRound size={15} /> 用户名 {currentAccount.username}
            </span>
            <span>
              <ShieldCheck size={15} /> {statusLabels[currentAccount.status]}
            </span>
          </div>
        </aside>
        <section className="content-card">
          <div className="card-heading">
            <div>
              <h2>账户信息</h2>
              <p>以下信息由身份服务维护。</p>
            </div>
          </div>
          <dl className="metadata-grid">
            <div>
              <small>显示名称</small>
              <strong>{currentAccount.displayName}</strong>
            </div>
            <div>
              <small>用户名</small>
              <strong>{currentAccount.username}</strong>
            </div>
            <div>
              <small>角色</small>
              <strong>{roleLabels[currentAccount.role]}</strong>
            </div>
            <div>
              <small>所属团队</small>
              <strong>{team?.name ?? "未分配团队"}</strong>
            </div>
            <div>
              <small>账号状态</small>
              <strong>{statusLabels[currentAccount.status]}</strong>
            </div>
          </dl>
          <form className="profile-form" onSubmit={submit}>
            <div className="form-section-title">修改密码</div>
            <label>
              <span>当前密码</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <div className="form-grid">
              <label>
                <span>新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>确认新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </label>
            </div>
            {error && (
              <p className="form-alert" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "修改中…" : "修改密码"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
