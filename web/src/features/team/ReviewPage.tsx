"use client";

import { ClipboardCheck, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { ReviewDrawer } from "../../components/ReviewDrawer";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { Submission } from "../../domain/types";

export function ReviewPage({ admin = false }: { admin?: boolean }) {
  const { state, currentTeam } = useDemoStore(); const [selected, setSelected] = useState<Submission | null>(null);
  const submissions = state.submissions.filter((item) => item.processingStatus === "completed" && item.settlementStatus === "unsettled" && (admin || item.teamId === currentTeam?.id));
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">结算锁定前可调整</p><h1>{admin ? "质量复核" : "结算前复核"}</h1><span>{admin ? "复核全平台未结算数据，原始 AI 结果永久保留" : `仅可复核 ${currentTeam?.name} 的未结算数据`}</span></div><span className="review-count"><ClipboardCheck size={16} />{submissions.length} 条待复核</span></div><div className="review-policy"><LockKeyhole size={16} /><span><strong>结算锁定规则</strong>每日结算批次生成后，视频评分、无效区间和预计金额将不可修改。</span></div><section className="content-card table-card"><SubmissionTable submissions={submissions} showOwner actionLabel="复核" onAction={setSelected} /></section>{selected && <ReviewDrawer submission={state.submissions.find((item)=>item.id===selected.id) ?? selected} onClose={() => setSelected(null)} />}</div>;
}
