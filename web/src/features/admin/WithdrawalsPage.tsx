"use client";

import { CheckCircle2, HandCoins, X, XCircle } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { Withdrawal } from "../../domain/types";

const labels={pending:["待审核","warning"],approved:["待打款","info"],paid:["已打款","success"],rejected:["已驳回","danger"]} as const;
export function WithdrawalsPage() {
  const { state,reviewWithdrawal }=useDemoStore(); const [selected,setSelected]=useState<Withdrawal|null>(null);
  function review(status:"approved"|"rejected"){ if(!selected)return; reviewWithdrawal(selected.id,status); setSelected(null); }
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">资金审核队列</p><h1>提现审核</h1><span>核对用户、金额和收款账户后批准或驳回申请</span></div><span className="review-count"><HandCoins size={16}/>{state.withdrawals.filter((item)=>item.status==="pending").length} 笔待审核</span></div><section className="content-card table-card"><div className="card-heading"><div><h2>提现申请</h2><p>演示审批不会触发真实支付</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>申请编号</th><th>用户</th><th>金额</th><th>收款账户</th><th>申请时间</th><th>状态</th><th/></tr></thead><tbody>{state.withdrawals.map((item)=>{const [label,tone]=labels[item.status];return <tr key={item.id}><td>{item.id}</td><td><strong>{item.userName}</strong></td><td><strong>¥{item.amount.toFixed(2)}</strong></td><td>{item.account}</td><td>{item.createdAt}</td><td><StatusBadge label={label} tone={tone}/></td><td><button className="table-action" aria-label="审核" onClick={()=>setSelected(item)}>审核</button></td></tr>})}</tbody></table></div></section>{selected&&<><button className="drawer-backdrop" aria-label="关闭提现审核" onClick={()=>setSelected(null)}/><aside className="withdrawal-drawer"><header><div><span>提现申请审核</span><h2>{selected.id}</h2></div><button className="icon-button" aria-label="关闭提现审核" onClick={()=>setSelected(null)}><X size={18}/></button></header><div className="withdrawal-amount"><small>申请金额</small><strong>¥{selected.amount.toFixed(2)}</strong><span>{selected.userName} · {selected.account}</span></div><dl><div><dt>账号状态</dt><dd>正常</dd></div><div><dt>实名验证</dt><dd>已通过</dd></div><div><dt>最近提现</dt><dd>30 天内 2 次</dd></div><div><dt>风险检查</dt><dd className="success-text">未发现异常</dd></div></dl><div className="drawer-actions"><button className="button reject-button" onClick={()=>review("rejected")}><XCircle size={16}/>驳回申请</button><button className="button button-primary" onClick={()=>review("approved")}><CheckCircle2 size={16}/>批准申请</button></div></aside></>}</div>;
}
