"use client";

import {
  Building2,
  ChevronDown,
  ChevronRight,
  Crown,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { AccountPublic, TeamPublic } from "../../auth/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import type { AccountStatus, Role } from "../../domain/types";

const roleLabel: Record<Role, string> = {
  collector: "数采人员",
  leader: "团长",
  admin: "平台管理员",
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

function AccountRows({
  accounts,
  currentAccountId,
  onEdit,
  onResetPassword,
  onToggleStatus,
  onDelete,
}: {
  accounts: AccountPublic[];
  currentAccountId: string;
  onEdit(account: AccountPublic, button: HTMLButtonElement): void;
  onResetPassword(account: AccountPublic, button: HTMLButtonElement): void;
  onToggleStatus(account: AccountPublic, button: HTMLButtonElement): void;
  onDelete(account: AccountPublic, button: HTMLButtonElement): void;
}) {
  return (
    <div className="table-scroll hierarchy-account-table-wrap">
      <table className="data-table hierarchy-account-table">
        <thead>
          <tr>
            <th>账号</th>
            <th>用户名</th>
            <th>角色</th>
            <th>状态</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const isCurrent = account.id === currentAccountId;
            const canDelete = !isCurrent && account.status === "disabled";
            return (
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
                <td><span className="mono">{account.username}</span></td>
                <td>{roleLabel[account.role]}</td>
                <td>
                  <StatusBadge
                    label={account.status === "active" ? "已启用" : "已停用"}
                    tone={account.status === "active" ? "success" : "neutral"}
                  />
                </td>
                <td>{formatUpdatedAt(account.updatedAt)}</td>
                <td className="table-actions-cell">
                  <div className="account-row-actions">
                    <button className="table-action" onClick={(event) => onEdit(account, event.currentTarget)}>编辑</button>
                    <button className="table-action" onClick={(event) => onResetPassword(account, event.currentTarget)}>重置密码</button>
                    <button
                      className="table-action"
                      disabled={isCurrent && account.status === "active"}
                      title={isCurrent && account.status === "active" ? "不能停用当前登录账号" : undefined}
                      onClick={(event) => onToggleStatus(account, event.currentTarget)}
                    >
                      {account.status === "active" ? "停用" : "启用"}
                    </button>
                    <button
                      className="table-action table-action-danger"
                      disabled={!canDelete}
                      title={
                        isCurrent
                          ? "不能删除当前登录账号"
                          : account.status === "active"
                            ? "请先停用账号，再执行删除"
                            : "永久删除该账号"
                      }
                      onClick={(event) => onDelete(account, event.currentTarget)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {accounts.length === 0 && (
        <div className="empty-state hierarchy-empty-state">
          <strong>当前层级没有匹配账号</strong>
          <span>请调整搜索词或筛选条件</span>
        </div>
      )}
    </div>
  );
}

export function OrganizationHierarchy({
  accounts,
  teams,
  currentAccountId,
  onEditTeam,
  onAssignLeader,
  onEditAccount,
  onResetPassword,
  onToggleStatus,
  onDeleteAccount,
}: {
  accounts: AccountPublic[];
  teams: TeamPublic[];
  currentAccountId: string;
  onEditTeam(team: TeamPublic, button: HTMLButtonElement): void;
  onAssignLeader(team: TeamPublic, button: HTMLButtonElement): void;
  onEditAccount(account: AccountPublic, button: HTMLButtonElement): void;
  onResetPassword(account: AccountPublic, button: HTMLButtonElement): void;
  onToggleStatus(account: AccountPublic, button: HTMLButtonElement): void;
  onDeleteAccount(account: AccountPublic, button: HTMLButtonElement): void;
}) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["platform", ...teams.map((team) => team.id)]),
  );

  const view = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchesAccount = (account: AccountPublic, groupMatches: boolean) => {
      const matchesSearch =
        !query ||
        groupMatches ||
        account.displayName.toLowerCase().includes(query) ||
        account.username.toLowerCase().includes(query) ||
        account.id.toLowerCase().includes(query);
      return (
        matchesSearch &&
        (roleFilter === "all" || account.role === roleFilter) &&
        (statusFilter === "all" || account.status === statusFilter)
      );
    };

    const teamGroups = teams.flatMap((team) => {
      const members = accounts.filter((account) => account.teamId === team.id);
      const leaders = members.filter((account) => account.role === "leader");
      const groupMatches =
        !!query &&
        (team.name.toLowerCase().includes(query) ||
          team.id.toLowerCase().includes(query) ||
          leaders.some(
            (leader) =>
              leader.displayName.toLowerCase().includes(query) ||
              leader.username.toLowerCase().includes(query),
          ));
      const visibleMembers = members.filter((account) =>
        matchesAccount(account, groupMatches),
      );
      if (query && !groupMatches && visibleMembers.length === 0) return [];
      if (!query && (roleFilter !== "all" || statusFilter !== "all") && visibleMembers.length === 0) return [];
      return [{ team, members, leaders, visibleMembers }];
    });

    const platformAccounts = accounts
      .filter((account) => account.role === "admin")
      .filter((account) => matchesAccount(account, query === "平台" || query === "管理员"));

    return {
      teamGroups,
      platformAccounts,
      visibleCount:
        platformAccounts.length +
        teamGroups.reduce((total, group) => total + group.visibleMembers.length, 0),
    };
  }, [accounts, roleFilter, search, statusFilter, teams]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const accountRowProps = {
    currentAccountId,
    onEdit: onEditAccount,
    onResetPassword,
    onToggleStatus,
    onDelete: onDeleteAccount,
  };

  return (
    <section className="content-card organization-hierarchy">
      <div className="card-heading">
        <div>
          <h2>团队与账号层级</h2>
          <p>先查看团队和团长，再展开管理团队内账号</p>
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
            placeholder="搜索团队、团长、显示名称或用户名"
          />
        </label>
        <select aria-label="角色筛选" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as Role | "all")}>
          <option value="all">全部角色</option>
          <option value="admin">管理员</option>
          <option value="leader">团长</option>
          <option value="collector">数采人员</option>
        </select>
        <select aria-label="状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AccountStatus | "all")}>
          <option value="all">全部状态</option>
          <option value="active">已启用</option>
          <option value="disabled">已停用</option>
        </select>
        <span className="filter-count">当前显示 {view.visibleCount} 个账号</span>
      </div>

      <div className="organization-groups">
        {view.platformAccounts.length > 0 && (
          <article className="organization-group organization-group-platform">
            <header className="organization-group-header">
              <button
                className="organization-toggle"
                aria-label={`平台管理，${expanded.has("platform") ? "收起" : "展开"}账号`}
                aria-expanded={expanded.has("platform")}
                onClick={() => toggle("platform")}
              >
                {expanded.has("platform") ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className="organization-icon"><ShieldCheck size={18} /></span>
                <span className="organization-title"><strong>平台管理</strong><small>不归属采集团队的管理员账号</small></span>
              </button>
              <div className="organization-group-stats">
                <span><strong>{view.platformAccounts.length}</strong><small>管理员</small></span>
              </div>
            </header>
            {expanded.has("platform") && <AccountRows accounts={view.platformAccounts} {...accountRowProps} />}
          </article>
        )}

        {view.teamGroups.map(({ team, members, leaders, visibleMembers }) => {
          const activeMembers = members.filter((account) => account.status === "active");
          const isExpanded = expanded.has(team.id);
          return (
            <article className="organization-group" key={team.id}>
              <header className="organization-group-header">
                <button
                  className="organization-toggle"
                  aria-label={`${team.name}，${isExpanded ? "收起" : "展开"}账号`}
                  aria-expanded={isExpanded}
                  onClick={() => toggle(team.id)}
                >
                  {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <span className="organization-icon"><Building2 size={18} /></span>
                  <span className="organization-title">
                    <strong>{team.name}</strong>
                    <small>{team.id} · {team.status === "active" ? "团队已启用" : "团队已停用"}</small>
                  </span>
                </button>
                <div className="organization-leader">
                  <Crown size={16} />
                  <span><small>团长</small><strong>{leaders.length ? leaders.map((leader) => leader.displayName).join(" / ") : "待指定"}</strong></span>
                </div>
                <div className="organization-group-stats">
                  <span><strong>{members.length}</strong><small>成员</small></span>
                  <span><strong>{activeMembers.length}</strong><small>启用</small></span>
                  <span><strong>{team.unitPricePerMinute}</strong><small>分/分钟</small></span>
                </div>
                <div className="organization-group-actions">
                  <button className="table-action" onClick={(event) => onEditTeam(team, event.currentTarget)}>编辑团队</button>
                  <button
                    className="table-action"
                    disabled={team.status === "disabled" || activeMembers.length === 0}
                    title={team.status === "disabled" ? "请先启用团队" : activeMembers.length === 0 ? "请先启用团队成员账号" : undefined}
                    onClick={(event) => onAssignLeader(team, event.currentTarget)}
                  >
                    <UserCog size={13} />指定团长
                  </button>
                </div>
              </header>
              {isExpanded && <AccountRows accounts={visibleMembers} {...accountRowProps} />}
            </article>
          );
        })}

        {view.teamGroups.length === 0 && view.platformAccounts.length === 0 && (
          <div className="empty-state">
            <Users size={28} />
            <strong>没有匹配的团队或账号</strong>
            <span>请调整搜索词或筛选条件</span>
          </div>
        )}
      </div>
    </section>
  );
}
