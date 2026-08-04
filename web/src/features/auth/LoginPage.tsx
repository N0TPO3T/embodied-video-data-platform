"use client";

import {
  ArrowLeft,
  Database,
  LogIn,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import {
  AccountApiError,
  login,
} from "../../auth/client/accountApi";
import type { AccountPublic } from "../../auth/contracts";
import { BrandMark } from "../../components/BrandMark";

type LoginResult = {
  user: AccountPublic;
  homePath: string;
};

export function LoginPage({
  navigate,
  onAuthenticated,
}: {
  navigate(path: string): void;
  onAuthenticated(result: LoginResult): void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    try {
      const result = await login(username, password);
      onAuthenticated(result);
    } catch (caught) {
      setError(
        caught instanceof AccountApiError
          ? caught.message
          : "登录失败，请稍后重试",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-aside">
        <BrandMark />
        <div className="login-aside-copy">
          <span className="eyebrow">
            <Database size={15} /> Embodied Data Platform
          </span>
          <h1>
            从视频提交到
            <br />
            数据资产的完整闭环
          </h1>
          <p>
            使用平台账号登录，系统会按照账号角色进入对应工作台。
            视频业务流程当前仍使用演示数据。
          </p>
        </div>
        <button className="back-link" onClick={() => navigate("/")}>
          <ArrowLeft size={16} /> 返回官网
        </button>
      </div>
      <main className="login-panel">
        <div className="login-panel-inner">
          <div className="login-heading">
            <span>账号登录</span>
            <h2>登录数据平台</h2>
            <p>请输入管理员分配的用户名和密码。</p>
          </div>
          <form className="login-form" onSubmit={submit}>
            <label>
              <span>用户名</span>
              <input
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <label>
              <span>密码</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error && (
              <p className="form-alert" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button-primary login-submit"
              type="submit"
              disabled={submitting}
            >
              <LogIn size={17} />
              {submitting ? "登录中…" : "登录"}
            </button>
          </form>
          <div className="login-note">
            <ShieldCheck size={16} />
            登录失败次数过多时，账号会被临时锁定以保护安全。
          </div>
        </div>
      </main>
    </div>
  );
}
