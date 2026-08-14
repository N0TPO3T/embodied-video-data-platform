"use client";

import { useEffect, useMemo, useState } from "react";

import { FilterBar } from "../../components/FilterBar";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";
import { isActivePassedSubmission } from "../../domain/calculations";
import type { Submission } from "../../domain/types";
import {
  searchSubmissions,
  submissionsExportUrl,
} from "../../submissions/client/submissionApi";
import type { BackendSubmissionListPagination } from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

const PAGE_SIZE = 20;

type ListMode = "loading" | "live" | "demo";

function localFilter(
  submissions: Submission[],
  teamId: string | undefined,
  query: string,
  status: string,
): Submission[] {
  const normalized = query.trim().toLowerCase();
  return submissions.filter((item) => {
    if (item.teamId !== teamId) return false;
    const text =
      `${item.fileName}${item.ownerName}${item.scene}`.toLowerCase();
    if (normalized && !text.includes(normalized)) return false;
    if (status === "all") return true;
    if (status === "passed" || status === "failed") {
      return item.qualityStatus === status;
    }
    if (status === "unsettled") {
      return item.settlementStatus === status && isActivePassedSubmission(item);
    }
    return item.processingStatus === status;
  });
}

function processingCount(submissions: Submission[]): number {
  return submissions.filter((item) =>
    ["uploading", "queued", "processing"].includes(item.processingStatus),
  ).length;
}

export function TeamSubmissionsPage() {
  const { state, currentTeam } = useDemoStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<ListMode>("loading");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [pagination, setPagination] =
    useState<BackendSubmissionListPagination>({
      page: 1,
      pageSize: PAGE_SIZE,
      total: 0,
      totalPages: 1,
    });

  useEffect(() => {
    setPage(1);
  }, [query, status]);

  useEffect(() => {
    let active = true;
    setMode((current) => (current === "demo" ? current : "loading"));
    searchSubmissions({
      q: query,
      status,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (!active) return;
        setSubmissions(result.submissions.map(backendSubmissionToDomain));
        setPagination(result.pagination);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        const filtered = localFilter(
          state.submissions,
          currentTeam?.id,
          query,
          status,
        );
        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * PAGE_SIZE;
        setSubmissions(filtered.slice(start, start + PAGE_SIZE));
        setPagination({
          page: safePage,
          pageSize: PAGE_SIZE,
          total: filtered.length,
          totalPages,
        });
        setMode("demo");
      });
    return () => {
      active = false;
    };
  }, [currentTeam?.id, page, query, state.submissions, status]);

  const range = useMemo(() => {
    if (pagination.total === 0) return "0";
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(
      pagination.total,
      start + submissions.length - 1,
    );
    return `${start}-${end}`;
  }, [pagination, submissions.length]);
  const exportUrl = useMemo(
    () => submissionsExportUrl({ q: query, status }),
    [query, status],
  );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">团队数据范围</p>
          <h1>团队数据</h1>
          <span>仅展示 {currentTeam?.name ?? "本团队"} 的成员提交</span>
        </div>
        <a className="button button-primary" href={exportUrl}>
          导出团队数据
        </a>
      </div>
      <section className="content-card table-card">
        <FilterBar
          value={query}
          onChange={setQuery}
          status={status}
          onStatusChange={setStatus}
          placeholder="搜索成员、文件或场景"
        />
        <div className="table-summary">
          <span>
            {mode === "live"
              ? `后端筛选 ${range} / ${pagination.total} 条团队数据`
              : mode === "loading"
                ? "正在读取后端团队数据"
                : `演示筛选 ${range} / ${pagination.total} 条团队数据`}
          </span>
          <span>处理中 {processingCount(submissions)} 条</span>
        </div>
        <SubmissionTable submissions={submissions} showOwner />
        <div className="table-summary">
          <span>
            第 {pagination.page} / {pagination.totalPages} 页
          </span>
          <span className="row-actions">
            <button
              className="table-action"
              disabled={pagination.page <= 1}
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              上一页
            </button>
            <button
              className="table-action"
              disabled={pagination.page >= pagination.totalPages}
              type="button"
              onClick={() =>
                setPage((current) =>
                  Math.min(pagination.totalPages, current + 1),
                )
              }
            >
              下一页
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
