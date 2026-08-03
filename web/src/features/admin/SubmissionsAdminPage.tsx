"use client";

import { useMemo, useState } from "react";
import { FilterBar } from "../../components/FilterBar";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";

export function SubmissionsAdminPage() {
  const { state } = useDemoStore(); const [query,setQuery]=useState(""); const [status,setStatus]=useState("all");
  const submissions=useMemo(()=>state.submissions.filter((item)=>{ const text=`${item.fileName}${item.ownerName}${item.teamName}${item.scene}`.toLowerCase(); if(query&&!text.includes(query.toLowerCase()))return false; if(status==="all")return true; if(status==="passed"||status==="failed")return item.qualityStatus===status; if(status==="unsettled")return item.settlementStatus===status; return item.processingStatus===status;}),[query,state.submissions,status]);
  return <div className="page-stack"><div className="page-heading"><div><p className="page-kicker">全平台数据范围</p><h1>数据提交</h1><span>统一检索视频、成员、团队、处理与结算状态</span></div><button className="button button-primary">导出当前结果</button></div><section className="content-card table-card"><FilterBar value={query} onChange={setQuery} status={status} onStatusChange={setStatus} placeholder="搜索编号、视频、成员、团队或场景"/><div className="table-summary"><span>当前 {submissions.length} 条</span><span>数据更新于 17:26</span></div><SubmissionTable submissions={submissions} showOwner /></section></div>;
}
