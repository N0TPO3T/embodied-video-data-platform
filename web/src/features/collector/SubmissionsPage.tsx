"use client";

import { useMemo, useState } from "react";
import { FilterBar } from "../../components/FilterBar";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { Submission } from "../../domain/types";

export function SubmissionsPage({
  qualityOnly = false,
  navigate,
}: {
  qualityOnly?: boolean;
  navigate(path: string): void;
}) {
  const { state, currentUser } = useDemoStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const submissions = useMemo(() => state.submissions.filter((item) => {
    if (item.ownerId !== currentUser.id) return false;
    if (qualityOnly && item.qualityStatus === "pending") return false;
    const text = `${item.fileName} ${item.id} ${item.scene} ${item.action}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (status === "all") return true;
    if (status === "passed" || status === "failed") return item.qualityStatus === status;
    if (status === "unsettled") return item.settlementStatus === "unsettled";
    return item.processingStatus === status;
  }), [currentUser.id, qualityOnly, query, state.submissions, status]);

  function view(item: Submission) { navigate(`/collector/submissions/${item.id}`); }

  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">个人数据范围</p><h1>{qualityOnly ? "质检结果" : "我的数据"}</h1><span>{qualityOnly ? "查看评分、问题区间与返工建议" : "跟踪从上传到结算的完整状态"}</span></div>{!qualityOnly && <button className="button button-primary" onClick={() => navigate("/collector/upload")}>上传新视频</button>}</div>
      <section className="content-card table-card"><FilterBar value={query} onChange={setQuery} status={status} onStatusChange={setStatus} /><div className="table-summary"><span>共 {submissions.length} 条数据</span><span>数据范围：仅本人</span></div><SubmissionTable submissions={submissions} onAction={view} /></section>
    </div>
  );
}
