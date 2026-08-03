import { FileClock, ShieldCheck } from "lucide-react";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";

export function AuditLogPage() {
  const { state }=useDemoStore(); const logs=[...state.submissions.flatMap((submission)=>submission.audit.map((record)=>({...record,target:submission.id}))),{id:"AUD-PRICE",actor:"陈屿",action:"更新团队覆盖价",reason:"星火一队单价调整为 ¥12/分钟",createdAt:"2026-08-02 18:20",target:"TEAM-01"},{id:"AUD-WD",actor:"陈屿",action:"批准提现申请",reason:"收款信息核验通过",createdAt:"2026-08-02 14:28",target:"WD-002"}];
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">平台关键操作留痕</p><h1>操作日志</h1><span>记录质量调整、价格、结算、提现和用户管理动作</span></div><button className="button button-primary">导出日志</button></div><div className="audit-summary"><ShieldCheck size={18}/><span><strong>审计记录不可在演示界面修改</strong><small>生产系统中日志将写入独立的不可变存储，并保留请求与版本信息。</small></span></div><section className="content-card table-card"><div className="table-scroll"><table className="data-table"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>原因 / 说明</th><th>结果</th></tr></thead><tbody>{logs.slice(0,12).map((log,index)=><tr key={`${log.id}-${index}`}><td>{log.createdAt}</td><td><strong>{log.actor}</strong></td><td><div className="action-cell"><FileClock size={14}/>{log.action}</div></td><td>{log.target}</td><td>{log.reason}</td><td><StatusBadge label="成功" tone="success"/></td></tr>)}</tbody></table></div></section></div>;
}
