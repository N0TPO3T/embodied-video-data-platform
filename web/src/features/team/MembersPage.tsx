"use client";

import { Search, UserPlus, Users } from "lucide-react";
import { useRef, useState } from "react";

import * as accountApi from "../../auth/client/accountApi";
import { useIdentity } from "../../auth/client/IdentityContext";
import type {
  AccountPublic,
  CreateAccountInput,
  UpdateAccountInput,
} from "../../auth/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import type { User } from "../../domain/types";
import { demoSeed } from "../../data/demoData";
import { useInteractions } from "../../interactions/InteractionContext";
import { AccountStatusModal } from "../admin/AccountStatusModal";
import { ResetPasswordModal } from "../admin/ResetPasswordModal";
import { CollectorAccountFormModal } from "./CollectorAccountFormModal";
import {
  MemberDetailModal,
  memberMetrics,
} from "./MemberDetailModal";

function accountToMember(account: AccountPublic): User {
  const compatibility = demoSeed.users.find((user) => user.id === account.id);
  return {
    id: account.id,
    name: account.displayName,
    account: account.username,
    role: account.role,
    teamId: account.teamId,
    avatar: compatibility?.avatar ?? account.displayName.slice(0, 1),
    phone: compatibility?.phone ?? "未设置",
    status: account.status,
    updatedAt: account.updatedAt,
  };
}

export function MembersPage() {
  const { accounts, currentAccount, teams, upsertAccount } = useIdentity();
  const { notify } = useInteractions();
  const [query, setQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<User>();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AccountPublic>();
  const [resetTarget, setResetTarget] = useState<AccountPublic>();
  const [statusTarget, setStatusTarget] = useState<AccountPublic>();
  const detailTriggerRef = useRef<HTMLButtonElement>(null);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);
  const currentTeam = teams.find((team) => team.id === currentAccount.teamId);
  const members = accounts
    .filter((account) => account.teamId === currentTeam?.id)
    .sort((left, right) =>
      Number(right.role === "leader") - Number(left.role === "leader"),
    )
    .map(accountToMember)
    .filter((user) =>
      `${user.name}${user.account}`.toLowerCase().includes(query.toLowerCase()),
    );

  async function create(input: CreateAccountInput) {
    const account = await accountApi.createAccount(input);
    upsertAccount(account);
    notify("success", "数采账号已创建");
    return account;
  }

  async function update(id: string, input: UpdateAccountInput) {
    const account = await accountApi.updateAccount(id, input);
    upsertAccount(account);
    notify("success", "数采名称已更新");
    return account;
  }

  function rememberAction(button: HTMLButtonElement) {
    actionTriggerRef.current = button;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">{currentTeam?.name}</p>
          <h1>成员管理</h1>
          <span>查看成员表现并管理本团队数采账号</span>
        </div>
        <button
          ref={createTriggerRef}
          className="button button-primary"
          disabled={!currentTeam}
          onClick={() => setCreateOpen(true)}
        >
          <UserPlus size={16} />
          新增数采账号
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
          <span className="filter-count">
            <Users size={15} />
            {members.length} 位成员
          </span>
        </div>
        <p
          id="member-demo-metrics-note"
          className="table-summary"
          role="note"
        >
          示例数据：今日上传、有效时长和通过率为演示业务指标
        </p>
        <div className="table-scroll">
          <table
            className="data-table"
            aria-describedby="member-demo-metrics-note"
          >
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                <th>今日上传</th>
                <th>有效时长</th>
                <th>通过率</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const metrics = memberMetrics(member.id);
                const account: AccountPublic = {
                  id: member.id,
                  displayName: member.name,
                  username: member.account,
                  role: member.role,
                  teamId: member.teamId,
                  status: member.status,
                  updatedAt: member.updatedAt,
                };
                return (
                  <tr key={member.id}>
                    <td>
                      <div className="member-cell">
                        <span>{member.avatar}</span>
                        <div>
                          <strong>{member.name}</strong>
                          <small>
                            {member.account} · {member.phone}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {member.role === "leader" ? "团长" : "数采人员"}
                    </td>
                    <td>{metrics.uploads} 条</td>
                    <td>{metrics.duration}</td>
                    <td>
                      <strong>{metrics.passRate}</strong>
                    </td>
                    <td>
                      <StatusBadge
                        label={
                          member.status === "active" ? "已启用" : "已停用"
                        }
                        tone={
                          member.status === "active" ? "success" : "neutral"
                        }
                      />
                    </td>
                    <td>
                      <div className="account-row-actions">
                        <button
                          className="table-action"
                          onClick={(event) => {
                            detailTriggerRef.current = event.currentTarget;
                            setSelectedMember(member);
                          }}
                        >
                          查看
                        </button>
                        {member.role === "collector" && (
                          <>
                            <button
                              className="table-action"
                              onClick={(event) => {
                                rememberAction(event.currentTarget);
                                setEditTarget(account);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="table-action"
                              onClick={(event) => {
                                rememberAction(event.currentTarget);
                                setResetTarget(account);
                              }}
                            >
                              重置密码
                            </button>
                            <button
                              className="table-action"
                              onClick={(event) => {
                                rememberAction(event.currentTarget);
                                setStatusTarget(account);
                              }}
                            >
                              {member.status === "active" ? "停用" : "启用"}
                            </button>
                          </>
                        )}
                      </div>
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
        team={
          currentTeam
            ? { ...currentTeam, leaderId: "", memberIds: [] }
            : undefined
        }
        open={Boolean(selectedMember)}
        onClose={() => setSelectedMember(undefined)}
        returnFocusRef={detailTriggerRef}
      />
      {createOpen && currentTeam && (
        <CollectorAccountFormModal
          mode="create"
          team={currentTeam}
          onCreate={create}
          onUpdate={update}
          onClose={() => setCreateOpen(false)}
          returnFocusRef={createTriggerRef}
        />
      )}
      {editTarget && currentTeam && (
        <CollectorAccountFormModal
          mode="edit"
          account={editTarget}
          team={currentTeam}
          onCreate={create}
          onUpdate={update}
          onClose={() => setEditTarget(undefined)}
          returnFocusRef={actionTriggerRef}
        />
      )}
      {resetTarget && (
        <ResetPasswordModal
          account={resetTarget}
          onClose={() => setResetTarget(undefined)}
          returnFocusRef={actionTriggerRef}
          onReset={async (password) => {
            await accountApi.resetAccountPassword(resetTarget.id, password);
            notify("success", "账号密码已重置");
          }}
        />
      )}
      {statusTarget && (
        <AccountStatusModal
          account={statusTarget}
          onClose={() => setStatusTarget(undefined)}
          returnFocusRef={actionTriggerRef}
          onConfirm={async () => {
            const nextStatus =
              statusTarget.status === "active" ? "disabled" : "active";
            const account = await accountApi.setAccountStatus(
              statusTarget.id,
              nextStatus,
            );
            upsertAccount(account);
            notify(
              "success",
              nextStatus === "active" ? "账号已启用" : "账号已停用",
            );
          }}
        />
      )}
    </div>
  );
}
