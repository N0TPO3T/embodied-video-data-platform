"use client";
import { useEffect, useState, type FormEvent } from "react";
import { claimWithdrawals, exportWithdrawalBatch, listWithdrawals, updateWithdrawal } from "../../wallet/client/walletApi";
import { withdrawalLabels, type WithdrawalList, type WithdrawalRequest, type WithdrawalStatus } from "../../wallet/contracts";
import { useInteractions } from "../../interactions/InteractionContext";
import { Modal } from "../../components/Modal";

export function WithdrawalsPage() {
  const { notify } = useInteractions();
  const [data, setData] = useState<WithdrawalList | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<WithdrawalStatus | "">("pending");
  const [ownerId, setOwnerId] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [exportId, setExportId] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState<{ row: WithdrawalRequest; status: "paid" | "rejected" | "failed" } | null>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null); setSelection([]); setError("");
    listWithdrawals({ page, status: status || undefined, ownerId: ownerId.trim() || undefined, batchId: batchFilter.trim() || undefined })
      .then(value => { if (active) setData(value); }).catch(() => { if (active) setError("提现申请读取失败，请刷新或检查管理员权限"); });
    return () => { active = false; };
  }, [page, status, ownerId, batchFilter, revision]);
  async function claim() {
    if (busy || !selection.length || !window.confirm(`领取 ${selection.length} 条申请并创建不可变批次？金额仍预留；导出不是付款。`)) return;
    setBusy(true);
    try {
      const result = await claimWithdrawals(selection);
      setExportId(result.batchId); setRevision(value => value + 1);
      notify("success", `批次已创建：${result.batchId}。尚未付款，请显式导出。`);
    } catch (error) { notify("error", error instanceof Error ? error.message : "领取失败"); }
    finally { setBusy(false); }
  }
  async function exportBatch() {
    const id = exportId.trim();
    if (busy || !id || !window.confirm(`导出/重新导出批次 ${id}？文件含完整收款信息。导出不是付款；重复导出须按申请 ID 核对，禁止重复转账。`)) return;
    setBusy(true);
    try {
      const blob = await exportWithdrawalBatch(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "manual-payouts.csv";
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("success", "已导出，未改变付款状态。请妥善保管并在完成核对后安全删除文件。");
    } catch (error) { notify("error", error instanceof Error ? error.message : "导出失败"); }
    finally { setBusy(false); }
  }
  function openAction(row: WithdrawalRequest, next: "paid" | "rejected" | "failed") {
    setAction({ row, status: next }); setReason(""); setReference(""); setPaidAt(""); setConfirmed(false);
  }
  async function submitAction(event: FormEvent) {
    event.preventDefault();
    if (!action || busy || !confirmed) return;
    setBusy(true);
    try {
      await updateWithdrawal(action.row.id, action.status === "paid" ? { status: "paid", transferReference: reference.trim(), paidAt: new Date(paidAt).toISOString() }
        : { status: action.status, reason: reason.trim(), ...(action.status === "failed" ? { fundsNotTransferred: true } : {}) });
      setAction(null); setRevision(value => value + 1); notify("success", "财务状态已更新");
    } catch (error) { notify("error", error instanceof Error ? error.message : "更新失败"); }
    finally { setBusy(false); }
  }
  return <div className="page-stack">
    <div className="page-heading"><div><p className="page-kicker">管理员财务</p><h1>人工提现</h1><span>领取 → 显式导出 → 财务在平台外转账 → 核对凭证并确认付款</span></div></div>
    <section className="content-card"><h2>导出不是付款</h2><p>本平台不调用支付接口。处理中资金持续预留；银行结果不明确时不要标记失败或退款。仅确认未转账或款项已退回，才能释放预留。</p>
      <p>CSV 的 account_text 列以单引号标记文本，防止长账号被科学计数或舍入；导入为文本，转账前去掉首个标记单引号。不要把文件用于自动支付导入，须人工核对账号和金额。其他文本字段也会防护表格公式。</p>
      <div className="modal-form wallet-withdraw-form"><label>批次 ID<input aria-label="导出批次 ID" value={exportId} onChange={event => setExportId(event.target.value)} maxLength={64} /></label><button className="button button-primary" disabled={busy || !exportId.trim()} onClick={exportBatch}>显式导出 / 重新导出批次</button></div>
    </section>
    <section className="content-card table-card">
      <div className="card-heading"><h2>提现申请</h2><button className="button button-primary" disabled={busy || !selection.length} onClick={claim}>领取所选并创建批次（{selection.length}）</button></div>
      <div className="filter-bar modal-form wallet-withdraw-form"><label>状态<select aria-label="提现状态" value={status} onChange={event => { setStatus(event.target.value as WithdrawalStatus | ""); setPage(1); }}><option value="">全部</option>{Object.entries(withdrawalLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>数采用户 ID<input value={ownerId} onChange={event => { setOwnerId(event.target.value); setPage(1); }} maxLength={64} /></label>
        <label>筛选批次 ID<input value={batchFilter} onChange={event => { setBatchFilter(event.target.value); setPage(1); }} maxLength={64} /></label><button className="button button-secondary" onClick={() => setRevision(value => value + 1)}>刷新</button></div>
      {error && <p role="alert">{error}</p>}
      <div className="table-scroll"><table className="data-table"><thead><tr><th>选择</th><th>申请 / 用户</th><th>提交时间</th><th>收款信息（脱敏）</th><th>金额</th><th>状态 / 结果</th><th>批次 / 操作</th></tr></thead><tbody>
        {data?.requests.map(row => <tr key={row.id}><td><input type="checkbox" aria-label={`选择 ${row.id}`} disabled={busy || row.status !== "pending"} checked={selection.includes(row.id)} onChange={event => setSelection(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} /></td><td>{row.id}<small className="row-sub">{row.ownerId}</small></td><td>{new Date(row.createdAt).toLocaleString()}</td><td>{row.method === "bank" ? "银行账户" : "支付宝"} {row.accountMasked} / {row.nameMasked}</td><td>{row.amount.toFixed(2)} 元</td><td>{withdrawalLabels[row.status]}<small className="row-sub">{row.reason ?? row.transferReference}{row.paidAt && ` / ${new Date(row.paidAt).toLocaleString()}`}</small></td><td>
          {row.batchId && <button className="table-action" onClick={() => setExportId(row.batchId!)}>{row.batchId}（选择导出）</button>}
          {row.status === "pending" && <button className="table-action" disabled={busy} onClick={() => openAction(row, "rejected")}>拒绝并退回余额</button>}
          {row.status === "processing" && <><button className="table-action" disabled={busy} onClick={() => openAction(row, "paid")}>确认实际付款</button><button className="table-action" disabled={busy} onClick={() => openAction(row, "failed")}>确认未付 / 已退回</button></>}
        </td></tr>)}
        {data?.requests.length === 0 && <tr><td colSpan={7}>暂无匹配申请</td></tr>}
      </tbody></table></div>
      <div className="card-heading"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {data?.pagination.totalPages ?? 1} 页，共 {data?.pagination.total ?? 0} 条</span><button disabled={!data || page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>下一页</button></div>
    </section>
    {action && <Modal open title={withdrawalLabels[action.status]} onClose={() => { if (!busy) setAction(null); }}><form className="modal-form" onSubmit={submitAction}>
      <p>{action.row.id} / {action.row.amount.toFixed(2)} 元 / {action.row.accountMasked}</p>
      {action.status === "paid" ? <><label>实际转账凭证 / 交易参考号<input aria-label="转账参考号" value={reference} onChange={event => setReference(event.target.value)} maxLength={120} required /></label><label>实际付款时间（本地时区）<input aria-label="付款时间" type="datetime-local" value={paidAt} onChange={event => setPaidAt(event.target.value)} required /></label></>
        : <label>原因（不要填写完整收款账号等敏感信息）<textarea aria-label="处理原因" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required /></label>}
      <label className="checkbox-field"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required />{action.status === "paid" ? "我已核对银行/支付宝记录，确认款项实际支付；此操作不是发起支付" : action.status === "failed" ? "财务已确认未转账或款项已退回（不是状态未知），允许释放预留余额" : "确认拒绝此待处理申请并退回预留余额"}</label>
      <button className="button button-primary" disabled={busy || !confirmed} type="submit">提交财务确认</button>
    </form></Modal>}
  </div>;
}
