"use client";

import { useMemo, useState } from "react";
import { FilterBar } from "../../components/FilterBar";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";

export function TeamSubmissionsPage() {
  const { state, currentTeam } = useDemoStore();
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("all");
  const submissions = useMemo(() => state.submissions.filter((item) => { if (item.teamId !== currentTeam?.id) return false; const text=`${item.fileName}${item.ownerName}${item.scene}`.toLowerCase(); if (query && !text.includes(query.toLowerCase())) return false; if(status==="all") return true; if(status==="passed"||status==="failed") return item.qualityStatus===status; if(status==="unsettled") return item.settlementStatus===status; return item.processingStatus===status; }), [currentTeam?.id, query, state.submissions, status]);
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">团队数据范围</p><h1>团队数据</h1><span>仅展示 {currentTeam?.name} 的成员提交</span></div></div><section className="content-card table-card"><FilterBar value={query} onChange={setQuery} status={status} onStatusChange={setStatus} placeholder="搜索成员、文件或场景" /><div className="table-summary"><span>共 {submissions.length} 条团队数据</span><span>处理中 {submissions.filter((item)=>item.processingStatus!=="completed").length} 条</span></div><SubmissionTable submissions={submissions} showOwner /></section></div>;
}
