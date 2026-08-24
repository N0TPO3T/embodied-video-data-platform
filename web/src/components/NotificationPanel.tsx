"use client";

import { useInteractions } from "../interactions/InteractionContext";

export function NotificationPanel({
  navigate,
}: {
  navigate?(path: string): void;
}) {
  const { notifications, unreadCount, markAllRead, markPathVisited, notify } =
    useInteractions();

  function clearUnread() {
    markAllRead();
    notify("success", "通知已全部标为已读");
  }

  function openNotification(path: string) {
    markPathVisited(path);
    navigate?.(path);
  }

  return (
    <section
      id="operations-notifications"
      className="notification-panel"
      aria-label="通知中心"
    >
      <header>
        <div>
          <strong>通知中心</strong>
          <small aria-live="polite">{unreadCount} 条未读</small>
        </div>
        <button
          type="button"
          className="table-action"
          onClick={clearUnread}
          disabled={unreadCount === 0}
        >
          全部标为已读
        </button>
      </header>
      <div className="notification-list">
        {notifications.length === 0 ? (
          <div className="notification-empty">
            <strong>暂无待处理通知</strong>
            <span>系统状态更新后会显示在这里</span>
          </div>
        ) : notifications.map((notification) => (
          <article
            key={notification.id}
            className={`notification-item ${notification.read ? "notification-read" : ""}`}
          >
            <span aria-hidden="true" />
            <div>
              <strong>{notification.title}</strong>
              <p>{notification.detail}</p>
              {notification.path && navigate && (
                <button
                  type="button"
                  className="table-action"
                  onClick={() => openNotification(notification.path!)}
                >
                  查看
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
