"use client";

import { Search, UserPlus, Users } from "lucide-react";
import { useRef, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { User } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";
import {
  MemberDetailModal,
  memberMetrics,
} from "./MemberDetailModal";

export function MembersPage() {
  const { state, currentTeam } = useDemoStore();
  const { notify } = useInteractions();
  const [query, setQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<User>();
  const detailTriggerRef = useRef<HTMLButtonElement>(null);
  const teamMemberIds = currentTeam
    ? [currentTeam.leaderId, ...currentTeam.memberIds]
    : [];
  const members = teamMemberIds
    .map((id) => state.users.find((user) => user.id === id))
    .filter((user): user is User => Boolean(user))
    .filter((user) =>
      `${user.name}${user.account}`.toLowerCase().includes(query.toLowerCase()),
    );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">{currentTeam?.name}</p>
          <h1>成员管理</h1>
          <span>查看成员活跃状态、数据贡献与质量表现</span>
        </div>
        <button
          className="button button-primary"
          onClick={() =>
            notify("info", "请联系管理员在“用户与团队”中创建账号")
          }
        >
          <UserPlus size={16} />邀请成员
        </button>
      </div>
      <section className="content-card table-card">
        <div className="filter-bar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="搜索成员"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索姓名或账号"
            />
          </label>
          <span className="filter-count"><Users size={15} />{members.length} 位成员</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>成员</th><th>角色</th><th>今日上传</th><th>有效时长</th><th>通过率</th><th>状态</th><th /></tr></thead>
            <tbody>
              {members.map((member) => {
                const metrics = memberMetrics(member.id);
                return (
                  <tr key={member.id}>
                    <td><div className="member-cell"><span>{member.avatar}</span><div><strong>{member.name}</strong><small>{member.account} · {member.phone}</small></div></div></td>
                    <td>{member.role === "leader" ? "团长" : "数采人员"}</td>
                    <td>{metrics.uploads} 条</td>
                    <td>{metrics.duration}</td>
                    <td><strong>{metrics.passRate}</strong></td>
                    <td><StatusBadge label="在线" tone="success" /></td>
                    <td>
                      <button
                        className="table-action"
                        onClick={(event) => {
                          detailTriggerRef.current = event.currentTarget;
                          setSelectedMember(member);
                        }}
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <MemberDetailModal
        member={selectedMember}
        team={currentTeam}
        open={Boolean(selectedMember)}
        onClose={() => setSelectedMember(undefined)}
        returnFocusRef={detailTriggerRef}
      />
    </div>
  );
}
