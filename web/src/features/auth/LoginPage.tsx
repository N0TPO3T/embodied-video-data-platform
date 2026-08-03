"use client";

import { ArrowLeft, ArrowRight, Database, ShieldCheck, Upload, Users } from "lucide-react";
import { BrandMark } from "../../components/BrandMark";
import type { Role } from "../../domain/types";

const accounts = [
  { role: "collector" as Role, title: "数采人员", name: "林晓雨", detail: "上传视频、查看质检与收入", icon: Upload, action: "以数采人员身份进入" },
  { role: "leader" as Role, title: "团长", name: "周明远", detail: "管理成员、团队数据与结算前复核", icon: Users, action: "以团长身份进入" },
  { role: "admin" as Role, title: "平台管理员", name: "陈屿", detail: "管理全平台数据、规则、结算与提现", icon: ShieldCheck, action: "以管理员身份进入" },
];

export function LoginPage({ onEnter, navigate }: { onEnter(role: Role): void; navigate(path: string): void }) {
  return (
    <div className="login-page">
      <div className="login-aside">
        <BrandMark />
        <div className="login-aside-copy">
          <span className="eyebrow"><Database size={15} /> Embodied Data Platform</span>
          <h1>从视频提交到<br />数据资产的完整闭环</h1>
          <p>一个账号入口，按角色进入不同工作台，完整演示数据上传、AI 质检、人工复核、结算和资产入库。</p>
        </div>
        <button className="back-link" onClick={() => navigate("/")}><ArrowLeft size={16} /> 返回官网</button>
      </div>
      <main className="login-panel">
        <div className="login-panel-inner">
          <div className="login-heading"><span>可点击产品演示</span><h2>选择演示身份</h2><p>无需输入密码，可随时在工作台切换角色。</p></div>
          <div className="account-list">
            {accounts.map(({ role, title, name, detail, icon: Icon, action }) => (
              <button key={role} className="account-card" aria-label={action} onClick={() => onEnter(role)}>
                <span className={`account-icon account-${role}`}><Icon size={21} /></span>
                <div><strong>{title}<em>{name}</em></strong><small>{detail}</small></div>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
          <div className="login-note"><ShieldCheck size={16} /> 此版本仅使用演示数据，不包含真实个人或资金信息。</div>
        </div>
      </main>
    </div>
  );
}
