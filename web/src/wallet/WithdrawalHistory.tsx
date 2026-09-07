"use client";
import { useEffect, useState } from "react";
import { listWithdrawals } from "./client/walletApi";
import { withdrawalLabels, type WithdrawalList } from "./contracts";

export function WithdrawalHistory({ revision = 0 }: { revision?: number }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<WithdrawalList | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    listWithdrawals({ page }).then(value => { if (active) setData(value); }).catch(() => { if (active) setError("提现申请读取失败，请刷新重试"); });
    return () => { active = false; };
  }, [page, revision]);
  return <section className="content-card table-card">
    <div className="card-heading"><h2>提现申请记录</h2></div>
    <p>申请及导出均不代表付款；处理中金额保持预留，财务确认付款后才计入已提现。历史已提现仍保留在钱包流水中。</p>
    {error ? <p role="alert">{error}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>申请 / 时间</th><th>收款信息（脱敏）</th><th>金额</th><th>状态</th><th>结果</th></tr></thead><tbody>
      {data?.requests.map(row => <tr key={row.id}><td>{row.id}<small className="row-sub">{new Date(row.createdAt).toLocaleString()}</small></td><td>{row.method === "bank" ? "银行账户" : "支付宝"} {row.accountMasked} / {row.nameMasked}</td><td>{row.amount.toFixed(2)} 元</td><td>{withdrawalLabels[row.status]}</td><td>{row.reason || (row.paidAt ? `付款时间 ${new Date(row.paidAt).toLocaleString()}；凭证 ${row.transferReference}` : "等待人工处理")}</td></tr>)}
      {data?.requests.length === 0 && <tr><td colSpan={5}>暂无提现申请</td></tr>}
    </tbody></table></div>}
    <div className="card-heading"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {data?.pagination.totalPages ?? 1} 页</span><button type="button" disabled={!data || page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>下一页</button></div>
  </section>;
}
