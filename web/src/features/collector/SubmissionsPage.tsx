"use client";

import { useEffect, useMemo, useState } from "react";

import { FilterBar } from "../../components/FilterBar";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";
import { isActivePassedSubmission } from "../../domain/calculations";
import type { Submission } from "../../domain/types";
import { searchSubmissions } from "../../submissions/client/submissionApi";
import type { BackendSubmissionListPagination } from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

const PAGE_SIZE = 20;

type ListMode = "loading" | "live" | "demo";

function hasQualityResult(submission: Submission): boolean {
  return [
    "scored",
    "hard_reject",
    "review_pending",
    "system_failed",
  ].includes(submission.qualityResult?.status ?? "");
}

function backendStatus(status: string, qualityOnly: boolean): string {
  if (qualityOnly && status === "all") return "reviewed";
  return status;
}

function localFilter(
  submissions: Submission[],
  ownerId: string,
  query: string,
  status: string,
  qualityOnly: boolean,
): Submission[] {
  const normalized = query.trim().toLowerCase();
  return submissions.filter((item) => {
    if (item.ownerId !== ownerId) return false;
    if (qualityOnly && !hasQualityResult(item)) return false;
    const text =
      `${item.fileName} ${item.id} ${item.scene} ${item.action}`.toLowerCase();
    if (normalized && !text.includes(normalized)) return false;
    if (status === "all") return true;
    if (status === "passed" || status === "failed") {
      return item.qualityStatus === status;
    }
    if (status === "unsettled") {
      return (
        item.settlementStatus === "unsettled" &&
        isActivePassedSubmission(item)
      );
    }
    return item.processingStatus === status;
  });
}

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
    let active = true;
    searchSubmissions({
      q: query,
      status: backendStatus(status, qualityOnly),
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
          currentUser.id,
          query,
          status,
          qualityOnly,
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
  }, [currentUser.id, page, qualityOnly, query, state.submissions, status]);

  const range = useMemo(() => {
    if (pagination.total === 0) return "0";
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(
      pagination.total,
      start + submissions.length - 1,
    );
    return `${start}-${end}`;
  }, [pagination, submissions.length]);

  function view(item: Submission) {
    navigate(`/collector/submissions/${item.id}`);
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">个人数据范围</p>
          <h1>{qualityOnly ? "质检结果" : "我的数据"}</h1>
          <span>
            {qualityOnly
              ? "查看评分、问题区间与返工建议"
              : "跟踪从上传到结算的完整状态"}
          </span>
        </div>
        {!qualityOnly && (
          <button
            className="button button-primary"
            onClick={() => navigate("/collector/upload")}
          >
            上传新视频
          </button>
        )}
      </div>
      <section className="content-card table-card">
        <FilterBar
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          status={status}
          onStatusChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <div className="table-summary">
          <span>
            {mode === "live"
              ? `后端筛选 ${range} / ${pagination.total} 条数据`
              : mode === "loading"
                ? "正在读取后端数据"
                : `演示筛选 ${range} / ${pagination.total} 条数据`}
          </span>
          <span>数据范围：仅本人</span>
        </div>
        <SubmissionTable submissions={submissions} loading={mode === "loading"} onAction={view} />
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
