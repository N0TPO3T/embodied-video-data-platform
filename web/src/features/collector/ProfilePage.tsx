"use client";

import { CreditCard, ShieldCheck, UserRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { useDemoStore } from "../../data/DemoStoreContext";

export function ProfilePage() {
  const { currentUser, currentTeam } = useDemoStore();
  const [saved, setSaved] = useState(false);
  function save(event: FormEvent) { event.preventDefault(); setSaved(true); }
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">个人账号</p><h1>个人资料</h1><span>维护基础信息和模拟收款账户</span></div></div><div className="profile-grid"><aside className="content-card profile-card"><span className="profile-avatar">{currentUser.avatar}</span><h2>{currentUser.name}</h2><p>{currentTeam?.name} · 数采人员</p><div><span><UserRound size={15} />账号 {currentUser.account}</span><span><ShieldCheck size={15} />身份已验证</span></div></aside><section className="content-card"><div className="card-heading"><div><h2>账户信息</h2><p>演示版本不会保存真实个人信息</p></div></div><form className="profile-form" onSubmit={save}><div className="form-grid"><label><span>姓名</span><input defaultValue={currentUser.name} /></label><label><span>登录账号</span><input defaultValue={currentUser.account} disabled /></label><label><span>手机号</span><input defaultValue={currentUser.phone} /></label><label><span>所属团队</span><input defaultValue={currentTeam?.name} disabled /></label></div><div className="form-section-title"><CreditCard size={16} />模拟收款账户</div><label><span>支付宝账号</span><input defaultValue={currentUser.alipayAccount} /></label><button className="button button-primary" type="submit">保存资料</button>{saved && <p className="form-message success">资料已保存</p>}</form></section></div></div>;
}
