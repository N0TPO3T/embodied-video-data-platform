"use client";

import {
  Building2,
  Search,
  ShieldCheck,
  UserCog,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import * as accountApi from "../../auth/client/accountApi";
import { useIdentity } from "../../auth/client/IdentityContext";
import type {
  AccountPublic,
  CreateTeamInput,
  CreateAccountInput,
  TeamPublic,
  UpdateTeamInput,
  UpdateAccountInput,
} from "../../auth/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import type { AccountStatus, Role } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";
import { AccountStatusModal } from "./AccountStatusModal";
import { AssignTeamLeaderModal } from "./AssignTeamLeaderModal";
import { ResetPasswordModal } from "./ResetPasswordModal";
import { TeamFormModal } from "./TeamFormModal";
import { UserFormModal } from "./UserFormModal";

const roleLabel: Record<Role, string> = {
  collector: "数采人员",
  leader: "团长",
  admin: "管理员",
};

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

export function UsersTeamsPage() {
  const {
    accounts,
    currentAccount,
    teams,
    upsertAccount,
    upsertTeam,
  } = useIdentity();
  const { notify } = useInteractions();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AccountPublic>();
  const [resetTarget, setResetTarget] = useState<AccountPublic>();
  const [statusTarget, setStatusTarget] = useState<AccountPublic>();
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [editTeamTarget, setEditTeamTarget] = useState<TeamPublic>();
  const [leaderTeamTarget, setLeaderTeamTarget] = useState<TeamPublic>();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [statusFilter, setStatusFilter] = useState<
    AccountStatus | "all"
  >("all");
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);
  const createTeamTriggerRef = useRef<HTMLButtonElement>(null);
  const teamActionTriggerRef = useRef<HTMLButtonElement>(null);

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesSearch =
        !query ||
        account.displayName.toLowerCase().includes(query) ||
        account.username.toLowerCase().includes(query);
      const matchesRole =
        roleFilter === "all" || account.role === roleFilter;
      const matchesStatus =
        statusFilter === "all" || account.status === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [accounts, roleFilter, search, statusFilter]);

  async function create(input: CreateAccountInput) {
    const account = await accountApi.createAccount(input);
    upsertAccount(account);
    notify("success", "账号已创建");
    return account;
  }

  async function update(id: string, input: UpdateAccountInput) {
    const account = await accountApi.updateAccount(id, input);
    upsertAccount(account);
    notify("success", "账号信息已更新");
    return account;
  }

  async function createTeam(input: CreateTeamInput) {
    const team = await accountApi.createTeam(input);
    upsertTeam(team);
    notify("success", "团队已创建");
    return team;
  }

  async function updateTeam(id: string, input: UpdateTeamInput) {
    const team = await accountApi.updateTeam(id, input);
    upsertTeam(team);
    notify("success", "团队信息已更新");
    return team;
  }

  async function assignLeader(teamId: string, accountId: string) {
    const changed = await accountApi.assignTeamLeader(teamId, accountId);
    changed.forEach(upsertAccount);
    notify("success", "团长已更新，相关账号需重新登录");
  }

  function rememberActionTrigger(button: HTMLButtonElement) {
    actionTriggerRef.current = button;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">组织与权限</p>
          <h1>用户与团队</h1>
          <span>创建真实登录账号、设置角色并维护团队归属</span>
        </div>
        <div className="page-heading-actions">
          <button
            ref={createTeamTriggerRef}
            className="button button-secondary"
            onClick={() => setCreateTeamOpen(true)}
          >
            <Building2 size={16} />
            新增团队
          </button>
          <button
            ref={createTriggerRef}
            className="button button-primary"
            onClick={() => setCreateOpen(true)}
          >
            <UserRoundPlus size={16} />
            新增账号
          </button>
        </div>
      </div>

      <div className="people-summary">
        <article>
          <Users size={22} />
          <span>
            <strong>{accounts.length}</strong>
            <small>登录账号</small>
          </span>
        </article>
        <article>
          <ShieldCheck size={22} />
          <span>
            <strong>{teams.length}</strong>
            <small>运营团队</small>
          </span>
        </article>
        <div>
          {teams.map((team) => (
            <span key={team.id}>
              <strong>
                {team.name}{team.status === "disabled" ? " · 已停用" : ""}
              </strong>
              <small>
                {accounts.filter((account) => account.teamId === team.id).length} 名成员 ·
                {team.unitPricePerMinute} 分/分钟
              </small>
            </span>
          ))}
        </div>
      </div>

      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h2>团队列表</h2>
            <p>维护团队状态、积分规则和团长人选</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table team-management-table">
            <thead>
              <tr>
                <th>团队</th>
                <th>团长</th>
                <th>成员数</th>
                <th>每分钟积分</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const members = accounts.filter(
                  (account) => account.teamId === team.id,
                );
                const leaders = members.filter(
                  (account) => account.role === "leader",
                );
                return (
                  <tr key={team.id}>
                    <td>
                      <div className="member-cell">
                        <span><Building2 size={14} /></span>
                        <div>
                          <strong>{team.name}</strong>
                          <small>{team.id}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {leaders.length > 0
                        ? `${leaders.map((leader) => leader.displayName).join(" / ")}${leaders.length > 1 ? "（待统一）" : ""}`
                        : "待指定"}
                    </td>
                    <td>{members.length} 人</td>
                    <td>{team.unitPricePerMinute} 分/分钟</td>
                    <td>
                      <StatusBadge
                        label={team.status === "active" ? "已启用" : "已停用"}
                        tone={team.status === "active" ? "success" : "neutral"}
                      />
                    </td>
                    <td>{formatUpdatedAt(team.updatedAt)}</td>
                    <td>
                      <div className="account-row-actions">
                        <button
                          className="table-action"
                          onClick={(event) => {
                            teamActionTriggerRef.current = event.currentTarget;
                            setEditTeamTarget(team);
                          }}
                        >
                          编辑团队
                        </button>
                        <button
                          className="table-action"
                          disabled={team.status === "disabled" || members.length === 0}
                          title={
                            team.status === "disabled"
                              ? "请先启用团队"
                              : members.length === 0
                                ? "请先为团队创建成员账号"
                                : undefined
                          }
                          onClick={(event) => {
                            teamActionTriggerRef.current = event.currentTarget;
                            setLeaderTeamTarget(team);
                          }}
                        >
                          <UserCog size={13} />
                          指定团长
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {teams.length === 0 && (
            <div className="empty-state">
              <strong>还没有团队</strong>
              <span>先创建团队，再添加团长和数采人员账号</span>
            </div>
          )}
        </div>
      </section>

      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h2>账号列表</h2>
            <p>账号状态、角色权限与团队归属</p>
          </div>
        </div>
        <div className="filter-bar account-filter-bar">
          <label className="search-field">
            <Search size={15} />
            <span className="sr-only">搜索账号</span>
            <input
              aria-label="搜索账号"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索显示名称或用户名"
            />
          </label>
          <select
            aria-label="角色筛选"
            value={roleFilter}
            onChange={(event) =>
              setRoleFilter(event.target.value as Role | "all")
            }
          >
            <option value="all">全部角色</option>
            <option value="admin">管理员</option>
            <option value="leader">团长</option>
            <option value="collector">数采人员</option>
          </select>
          <select
            aria-label="状态筛选"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as AccountStatus | "all",
              )
            }
          >
            <option value="all">全部状态</option>
            <option value="active">已启用</option>
            <option value="disabled">已停用</option>
          </select>
          <span className="filter-count">
            共 {filteredAccounts.length} 个账号
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table account-table">
            <thead>
              <tr>
                <th>账号</th>
                <th>用户名</th>
                <th>角色</th>
                <th>所属团队</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <div className="member-cell">
                      <span>{account.displayName.slice(0, 1)}</span>
                      <div>
                        <strong>{account.displayName}</strong>
                        <small>{account.id}</small>
                      </div>
                    </div>
                  </td>
                  <td>{account.username}</td>
                  <td>{roleLabel[account.role]}</td>
                  <td>
                    {teams.find(
                      (team) => team.id === account.teamId,
                    )?.name ?? "平台"}
                  </td>
                  <td>
                    <StatusBadge
                      label={
                        account.status === "active"
                          ? "已启用"
                          : "已停用"
                      }
                      tone={
                        account.status === "active"
                          ? "success"
                          : "neutral"
                      }
                    />
                  </td>
                  <td>{formatUpdatedAt(account.updatedAt)}</td>
                  <td>
                    <div className="account-row-actions">
                      <button
                        className="table-action"
                        onClick={(event) => {
                          rememberActionTrigger(event.currentTarget);
                          setEditTarget(account);
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="table-action"
                        onClick={(event) => {
                          rememberActionTrigger(event.currentTarget);
                          setResetTarget(account);
                        }}
                      >
                        重置密码
                      </button>
                      <button
                        className="table-action"
                        disabled={
                          account.id === currentAccount.id &&
                          account.status === "active"
                        }
                        title={
                          account.id === currentAccount.id &&
                          account.status === "active"
                            ? "不能停用当前登录账号"
                            : undefined
                        }
                        onClick={(event) => {
                          rememberActionTrigger(event.currentTarget);
                          setStatusTarget(account);
                        }}
                      >
                        {account.status === "active" ? "停用" : "启用"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredAccounts.length === 0 && (
            <div className="empty-state">
              <strong>没有匹配账号</strong>
              <span>请调整搜索词或筛选条件</span>
            </div>
          )}
        </div>
      </section>

      {createOpen && (
        <UserFormModal
          open
          mode="create"
          onCreate={create}
          onUpdate={update}
          onClose={() => setCreateOpen(false)}
          returnFocusRef={createTriggerRef}
        />
      )}
      {createTeamOpen && (
        <TeamFormModal
          mode="create"
          onCreate={createTeam}
          onUpdate={updateTeam}
          onClose={() => setCreateTeamOpen(false)}
          returnFocusRef={createTeamTriggerRef}
        />
      )}
      {editTeamTarget && (
        <TeamFormModal
          mode="edit"
          team={editTeamTarget}
          memberCount={
            accounts.filter(
              (account) =>
                account.teamId === editTeamTarget.id &&
                account.status === "active",
            ).length
          }
          onCreate={createTeam}
          onUpdate={updateTeam}
          onClose={() => setEditTeamTarget(undefined)}
          returnFocusRef={teamActionTriggerRef}
        />
      )}
      {leaderTeamTarget && (
        <AssignTeamLeaderModal
          team={leaderTeamTarget}
          accounts={accounts}
          onAssign={(accountId) => assignLeader(leaderTeamTarget.id, accountId)}
          onClose={() => setLeaderTeamTarget(undefined)}
          returnFocusRef={teamActionTriggerRef}
        />
      )}
      {editTarget && (
        <UserFormModal
          open
          mode="edit"
          account={editTarget}
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
            const result = await accountApi.resetAccountPassword(
              resetTarget.id,
              password,
            );
            notify("success", "账号密码已重置");
            if (result.reauthenticate) {
              window.location.assign("/login");
            }
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
              statusTarget.status === "active"
                ? "disabled"
                : "active";
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
