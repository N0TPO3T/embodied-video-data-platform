"use client";

import type { RefObject } from "react";
import { Modal } from "../../components/Modal";
import type { Team, User } from "../../domain/types";

export type MemberMetrics = {
  uploads: number;
  duration: string;
  passRate: string;
};

const metricsByMember: Record<string, MemberMetrics> = {
  "U-LEAD-01": { uploads: 0, duration: "—", passRate: "—" },
  "U-COL-01": { uploads: 18, duration: "4.8h", passRate: "94.2%" },
  "U-COL-03": { uploads: 23, duration: "5.2h", passRate: "91.8%" },
  "U-COL-04": { uploads: 16, duration: "3.7h", passRate: "89.6%" },
  "U-COL-05": { uploads: 11, duration: "2.9h", passRate: "87.4%" },
};

export function memberMetrics(userId: string): MemberMetrics {
  return (
    metricsByMember[userId] ?? {
      uploads: 12,
      duration: "3.1h",
      passRate: "90.1%",
    }
  );
}

export function MemberDetailModal({
  member,
  team,
  open,
  onClose,
  returnFocusRef,
}: {
  member?: User;
  team?: Team;
  open: boolean;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  if (!member) return null;
  const metrics = memberMetrics(member.id);

  return (
    <Modal
      open={open}
      title="成员详情"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <div className="member-detail">
        <div className="member-detail-profile">
          <span>{member.avatar}</span>
          <div>
            <strong>{member.name}</strong>
            <small>{member.role === "leader" ? "团长" : "数采人员"}</small>
          </div>
        </div>
        <dl className="member-detail-fields">
          <div><dt>登录账号</dt><dd>{member.account}</dd></div>
          <div><dt>所属团队</dt><dd>{team?.name ?? "未加入团队"}</dd></div>
          <div><dt>手机号</dt><dd>{member.phone}</dd></div>
        </dl>
        <div className="member-detail-metrics">
          <div><span>今日上传</span><strong>{metrics.uploads} 条</strong></div>
          <div><span>有效时长</span><strong>{metrics.duration}</strong></div>
          <div><span>通过率</span><strong>{metrics.passRate}</strong></div>
        </div>
      </div>
    </Modal>
  );
}
