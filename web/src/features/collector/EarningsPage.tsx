"use client";

import { Banknote, CircleDollarSign, Clock3, Wallet } from "lucide-react";
import { FormEvent, useState } from "react";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";

const withdrawalLabel = { pending: ["审核中", "warning"], approved: ["待打款", "info"], paid: ["已到账", "success"], rejected: ["已驳回", "danger"] } as const;

export function EarningsPage() {
  const { state, currentUser, requestWithdrawal } = useDemoStore();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    try { requestWithdrawal(Number(amount)); setMessage("提现申请已提交，金额已转入冻结中"); setAmount(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "申请失败"); }
  }
  const records = state.withdrawals.filter((item) => item.userId === currentUser.id);
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">个人资金账户</p><h1>收入与提现</h1><span>演示金额仅用于展示结算和审核流程</span></div></div><div className="metric-grid"><MetricCard label="可用余额" value={`¥${state.wallet.available.toFixed(2)}`} detail="可发起提现" icon={Wallet} /><MetricCard label="待结算" value={`¥${state.wallet.pending.toFixed(2)}`} detail="下个批次入账" icon={Clock3} tone="amber" /><MetricCard label="提现冻结" value={`¥${state.wallet.frozen.toFixed(2)}`} detail="审核或打款中" icon={Banknote} tone="violet" /><MetricCard label="累计提现" value={`¥${state.wallet.withdrawn.toFixed(2)}`} detail="历史已到账" icon={CircleDollarSign} tone="green" /></div><div className="earnings-grid"><section className="content-card"><div className="card-heading"><div><h2>申请提现</h2><p>最低提现金额 ¥{state.wallet.minimumWithdrawal}</p></div></div><form className="withdrawal-form" onSubmit={submit}><label><span>提现金额</span><div className="money-input"><em>¥</em><input aria-label="提现金额" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></label><div className="form-hint"><span>收款账户</span><strong>{currentUser.alipayAccount}</strong></div><button className="button button-primary" type="submit">提交提现申请</button>{message && <p className={message.includes("已提交") ? "form-message success" : "form-message error"}>{message}</p>}</form></section><section className="content-card table-card"><div className="card-heading"><div><h2>提现记录</h2><p>最近的申请与打款状态</p></div></div><div className="record-list">{records.map((record) => { const [label,tone]=withdrawalLabel[record.status]; return <div key={record.id}><span><strong>¥{record.amount.toFixed(2)}</strong><small>{record.createdAt} · {record.account}</small></span><StatusBadge label={label} tone={tone} /></div>; })}</div></section></div></div>;
}
