"use client";

import { useInteractions } from "../interactions/InteractionContext";

export function NotificationPanel({
  navigate,
}: {
  navigate?(path: string): void;
}) {
  const { notifications, unreadCount, markAllRead, notify } = useInteractions();

  function clearUnread() {
    markAllRead();
    notify("success", "通知已全部标为已读");
  }

  return (
    <section className="notification-panel" aria-label="通知中心">
      <header>
        <div>
          <strong>通知中心</strong>
          <small>{unreadCount} 条未读</small>
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
        {notifications.map((notification) => (
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
                  onClick={() => navigate(notification.path!)}
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
