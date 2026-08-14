"use client";

import { Bell, LogOut, Menu, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { navigationByRole } from "../app/navigation";
import { BrandMark } from "../components/BrandMark";
import { NotificationPanel } from "../components/NotificationPanel";
import { useIdentity } from "../auth/client/IdentityContext";
import { useInteractions } from "../interactions/InteractionContext";
import { getOperationsStatus } from "../operations/client/operationsApi";

const roleLabel = {
  collector: "数采人员",
  leader: "团长",
  admin: "平台管理员",
};

export function DashboardShell({
  currentPath,
  navigate,
  onLogout,
  children,
}: {
  currentPath: string;
  navigate(path: string): void;
  onLogout(): Promise<void> | void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const loggingOutRef = useRef(false);
  const { currentAccount } = useIdentity();
  const { notify, unreadCount, navigationBadges, syncOperationsStatus } =
    useInteractions();
  const badgeByPath = useMemo(
    () => new Map(navigationBadges.map((badge) => [badge.path, badge.label])),
    [navigationBadges],
  );
  const navigation = navigationByRole[currentAccount.role];

  useEffect(() => {
    let active = true;
    getOperationsStatus()
      .then((status) => {
        if (!active) return;
        syncOperationsStatus(status);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentAccount.id, syncOperationsStatus]);

  function go(path: string) {
    setMobileOpen(false);
    navigate(path);
  }

  async function signOut() {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setLoggingOut(true);
    try {
      await onLogout();
    } catch {
      notify("error", "退出登录失败，请稍后重试");
      loggingOutRef.current = false;
      setLoggingOut(false);
    }
  }

  return (
    <div className="dashboard-frame">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <BrandMark />
          <button
            className="icon-button sidebar-close"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          <p className="nav-section-label">工作台</p>
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = currentPath === item.path;
            return (
              <a
                key={item.path}
                href={item.path}
                className={`nav-link ${active ? "nav-link-active" : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  go(item.path);
                }}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {(badgeByPath.get(item.path) ?? item.badge) && (
                  <em>{badgeByPath.get(item.path) ?? item.badge}</em>
                )}
              </a>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="system-pulse"><span />系统运行正常</div>
          <small>本地运行版 v0.1.0</small>
        </div>
      </aside>

      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <section className="dashboard-main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="打开导航"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="topbar-context">
            <span>{roleLabel[currentAccount.role]}</span>
            <small>具身视频数据生产与质量运营</small>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button notification-button"
              aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : "通知，无未读"}
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell size={19} />
              {unreadCount > 0 && <span />}
            </button>
            {notificationsOpen && <NotificationPanel navigate={go} />}
            <div className="user-chip">
              <span>{currentAccount.displayName.slice(0, 1)}</span>
              <div><strong>{currentAccount.displayName}</strong><small>{roleLabel[currentAccount.role]}</small></div>
            </div>
            <button
              className="logout-button"
              type="button"
              onClick={signOut}
              disabled={loggingOut}
            >
              <LogOut size={15} />
              {loggingOut ? "退出中…" : "退出登录"}
            </button>
          </div>
        </header>
        <main className="dashboard-content">{children}</main>
      </section>
    </div>
  );
}
