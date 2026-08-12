"use client";

import { FileClock, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listAccountAudit } from "../../auth/client/accountApi";
import type {
  AccountAuditLog,
  KnownAccountAuditAction,
} from "../../auth/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";
import { useInteractions } from "../../interactions/InteractionContext";

type AuditRow = {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  target: string;
  reason: string;
};

const accountActionLabels: Record<KnownAccountAuditAction, string> = {
  create: "创建账号",
  update: "更新账号",
  reset_password: "重置密码",
  change_password: "修改密码",
  enable: "启用账号",
  disable: "停用账号",
  local_identity_reconcile: "本地账号校准",
  team_create: "创建团队",
  team_update: "更新团队",
};

function accountActionLabel(action: string): string {
  return accountActionLabels[action as KnownAccountAuditAction] ?? "未知操作";
}

function formatCreatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(timestamp)
    .replaceAll("/", "-");
}

function accountLogToRow(log: AccountAuditLog): AuditRow {
  return {
    id: log.id,
    createdAt: formatCreatedAt(log.createdAt),
    actor: log.actorName,
    action: accountActionLabel(log.action),
    target: log.targetName,
    reason: log.summary,
  };
}

export function AuditLogPage() {
  const { state, currentUser } = useDemoStore();
  const { notify } = useInteractions();
  const [accountLogs, setAccountLogs] = useState<AccountAuditLog[]>([]);
  const [accountLogError, setAccountLogError] = useState(false);

  useEffect(() => {
    if (currentUser.role !== "admin") return;
    let active = true;

    listAccountAudit()
      .then((logs) => {
        if (!active) return;
        setAccountLogs(logs);
        setAccountLogError(false);
      })
      .catch(() => {
        if (!active) return;
        setAccountLogError(true);
      });

    return () => {
      active = false;
    };
  }, [currentUser.role]);

  const logs = useMemo<AuditRow[]>(
    () => [
      ...accountLogs.map(accountLogToRow),
      ...state.operationLogs,
      ...state.submissions.flatMap((submission) =>
        submission.audit.map((record) => ({
          ...record,
          target: submission.id,
        })),
      ),
    ],
    [accountLogs, state.operationLogs, state.submissions],
  );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">平台关键操作留痕</p>
          <h1>操作日志</h1>
          <span>记录质量调整、价格、结算、提现和用户管理动作</span>
        </div>
        <button
          className="button button-primary"
          onClick={() => notify("info", "导出任务已创建")}
        >
          导出日志
        </button>
      </div>
      <div className="audit-summary">
        <ShieldCheck size={18} />
        <span>
          <strong>账户操作已写入持久化审计记录</strong>
          <small>
            {accountLogError
              ? "账户日志加载失败，当前仍可查看业务演示日志。"
              : "账号创建、修改、密码重置及状态变更均会保留操作记录。"}
          </small>
        </span>
      </div>
      <section className="content-card table-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>动作</th>
                <th>对象</th>
                <th>原因 / 说明</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 20).map((log, index) => (
                <tr key={`${log.id}-${index}`}>
                  <td>{log.createdAt}</td>
                  <td>
                    <strong>{log.actor}</strong>
                  </td>
                  <td>
                    <div className="action-cell">
                      <FileClock size={14} />
                      {log.action}
                    </div>
                  </td>
                  <td>{log.target}</td>
                  <td>{log.reason}</td>
                  <td>
                    <StatusBadge label="成功" tone="success" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
