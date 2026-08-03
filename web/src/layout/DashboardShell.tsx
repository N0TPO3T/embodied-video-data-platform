"use client";

import { Bell, ChevronDown, Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { navigationByRole } from "../app/navigation";
import { BrandMark } from "../components/BrandMark";
import { NotificationPanel } from "../components/NotificationPanel";
import { useDemoStore } from "../data/DemoStoreContext";
import { useInteractions } from "../interactions/InteractionContext";

const roleLabel = {
  collector: "数采人员",
  leader: "团长",
  admin: "平台管理员",
};

export function DashboardShell({
  currentPath,
  navigate,
  children,
}: {
  currentPath: string;
  navigate(path: string): void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { currentUser, loginAs } = useDemoStore();
  const { unreadCount } = useInteractions();
  const navigation = navigationByRole[currentUser.role];

  function go(path: string) {
    setMobileOpen(false);
    navigate(path);
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
                {item.badge && <em>{item.badge}</em>}
              </a>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="system-pulse"><span />系统运行正常</div>
          <small>演示版 v0.1.0</small>
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
            <span>{roleLabel[currentUser.role]}</span>
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
            {notificationsOpen && <NotificationPanel />}
            <label className="demo-role-switcher">
              <span>演示角色</span>
              <select
                aria-label="演示角色"
                value={currentUser.role}
                onChange={(event) => {
                  const role = event.target.value as keyof typeof roleLabel;
                  loginAs(role);
                  go(role === "collector" ? "/collector" : role === "leader" ? "/team" : "/admin");
                }}
              >
                <option value="collector">数采人员</option>
                <option value="leader">团长</option>
                <option value="admin">平台管理员</option>
              </select>
              <ChevronDown size={14} />
            </label>
            <div className="user-chip">
              <span>{currentUser.avatar}</span>
              <div><strong>{currentUser.name}</strong><small>{roleLabel[currentUser.role]}</small></div>
            </div>
          </div>
        </header>
        <main className="dashboard-content">{children}</main>
      </section>
    </div>
  );
}
