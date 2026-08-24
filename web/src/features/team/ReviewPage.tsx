"use client";

import { ClipboardCheck, LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ReviewDrawer } from "../../components/ReviewDrawer";
import { SubmissionTable } from "../../components/SubmissionTable";
import { useDemoStore } from "../../data/DemoStoreContext";
import { isActivePassedSubmission } from "../../domain/calculations";
import type { Submission } from "../../domain/types";
import { searchSubmissions } from "../../submissions/client/submissionApi";
import type { BackendSubmissionListPagination } from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

const PAGE_SIZE = 20;

type ListMode = "loading" | "live" | "demo";

function adminReviewCandidate(item: Submission): boolean {
  if (item.settlementStatus !== "unsettled") return false;
  if (isActivePassedSubmission(item)) return true;
  return (
    item.processingStatus === "completed" &&
    item.qualityStatus === "passed" &&
    item.assetStatus !== "quarantined" &&
    item.duplicateCandidates?.some(
      (candidate) => candidate.status === "candidate",
    ) === true
  );
}

function localTeamReviewCandidates(
  submissions: Submission[],
  teamId: string | undefined,
): Submission[] {
  return submissions.filter(
    (item) => item.teamId === teamId && adminReviewCandidate(item),
  );
}

function localReviewCandidates(
  submissions: Submission[],
  admin: boolean,
  teamId: string | undefined,
): Submission[] {
  return admin
    ? submissions.filter(adminReviewCandidate)
    : localTeamReviewCandidates(submissions, teamId);
}

export function ReviewPage({
  admin = false,
  navigate,
}: {
  admin?: boolean;
  navigate?: (path: string) => void;
}) {
  const { state, currentTeam } = useDemoStore();
  const [selected, setSelected] = useState<Submission | null>(null);
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

  const backendStatus = admin ? "review_queue" : "unsettled";
  const localCandidates = useMemo(
    () => localReviewCandidates(state.submissions, admin, currentTeam?.id),
    [admin, currentTeam?.id, state.submissions],
  );

  useEffect(() => {
    let active = true;
    searchSubmissions({
      status: backendStatus,
      page,
      pageSize: PAGE_SIZE,
      includeThumbnails: true,
    })
      .then((result) => {
        if (!active) return;
        setSubmissions(result.submissions.map(backendSubmissionToDomain));
        setPagination(result.pagination);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        const filtered = localCandidates;
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
  }, [backendStatus, localCandidates, page]);

  const selectedSubmission =
    submissions.find((item) => item.id === selected?.id) ?? selected;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">
            {admin ? "积分锁定前可调整" : "本团队只读视图"}
          </p>
          <h1>{admin ? "质量复核" : "质检结果"}</h1>
          <span>
            {admin
              ? "复核全平台未锁定数据，原始 AI 结果永久保留"
              : `查看 ${currentTeam?.name ?? "本团队"} 已出结果且尚未锁定的数据`}
          </span>
        </div>
        <span className="review-count">
          <ClipboardCheck size={16} />
          {mode === "loading" ? "读取中" : `${pagination.total} 条结果`}
        </span>
      </div>
      <div className="review-policy">
        <LockKeyhole size={16} />
        <span>
          <strong>{admin ? "积分锁定规则" : "只读权限"}</strong>
          {admin
            ? "积分周期生成后，视频评分、无效区间和积分结果将进入留痕调整。"
            : "团长可查看本团队结果，但不能修改 AI 原始结果或最终质检结果。"}
        </span>
      </div>
      <div className="table-summary">
        <span>
          {mode === "live"
            ? admin
              ? "质量复核候选已连接后端"
              : "团队质检结果已连接后端"
            : mode === "loading"
              ? "正在读取后端质检结果"
              : "当前展示本地示例结果"}
        </span>
        <span>
          第 {pagination.page} / {pagination.totalPages} 页
        </span>
      </div>
      <section className="content-card table-card">
        <SubmissionTable
          submissions={submissions}
          loading={mode === "loading"}
          showOwner
          actionLabel={admin ? "复核" : "查看"}
          onAction={
            admin
              ? (item) => navigate?.(`/admin/review/${item.id}`)
              : setSelected
          }
        />
        <div className="table-summary">
          <span>每页 {pagination.pageSize} 条</span>
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
      {selectedSubmission && (
        <ReviewDrawer
          submission={selectedSubmission}
          onClose={() => setSelected(null)}
          readOnly={!admin}
        />
      )}
    </div>
  );
}
