"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToastViewport } from "../components/ToastViewport";
import type { BackendOperationsStatus } from "../operations/contracts";

export type ToastTone = "success" | "error" | "info";
export type ToastItem = { id: number; tone: ToastTone; message: string };
export type DemoNotification = {
  id: string;
  title: string;
  detail: string;
  read: boolean;
  path?: string;
  tone?: "info" | "success" | "warning" | "danger";
};

type InteractionValue = {
  toasts: ToastItem[];
  notifications: DemoNotification[];
  unreadCount: number;
  navigationBadges: BackendOperationsStatus["navigationBadges"];
  notify(tone: ToastTone, message: string): void;
  dismissToast(id: number): void;
  markAllRead(): void;
  syncOperationsStatus(status: BackendOperationsStatus): void;
};

const seedNotifications: DemoNotification[] = [
  {
    id: "NOTICE-REVIEW",
    title: "团队质检结果已更新",
    detail: "团长可只读查看本团队的终态质检结果。",
    read: false,
  },
  {
    id: "NOTICE-AI",
    title: "AI 质检任务处理异常",
    detail: "视频解析失败，可在 AI 任务页重新执行。",
    read: false,
  },
  {
    id: "NOTICE-WITHDRAWAL",
    title: "积分周期 SET-20260803 已锁定",
    detail: "本周期积分可导出给团长线下核对。",
    read: false,
  },
];

const InteractionContext = createContext<InteractionValue | null>(null);

export function InteractionProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] =
    useState<DemoNotification[]>(seedNotifications);
  const [navigationBadges, setNavigationBadges] = useState<
    BackendOperationsStatus["navigationBadges"]
  >([]);
  const nextToastId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextToastId.current++;
      setToasts((current) => [...current, { id, tone, message }].slice(-3));
      if (tone !== "error") {
        const timer = setTimeout(() => {
          dismissToast(id);
          timers.current.delete(timer);
        }, 2800);
        timers.current.add(timer);
      }
    },
    [dismissToast],
  );

  const markAllRead = useCallback(() => {
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, read: true })),
    );
  }, []);

  const syncOperationsStatus = useCallback((status: BackendOperationsStatus) => {
    setNavigationBadges(status.navigationBadges);
    setNotifications((current) => {
      const read = new Set(
        current
          .filter((notification) => notification.read)
          .map((notification) => notification.id),
      );
      return status.notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        detail: notification.detail,
        path: notification.path,
        tone: notification.tone,
        read: read.has(notification.id),
      }));
    });
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  const value = useMemo<InteractionValue>(
    () => ({
      toasts,
      notifications,
      navigationBadges,
      unreadCount: notifications.filter((notification) => !notification.read)
        .length,
      notify,
      dismissToast,
      markAllRead,
      syncOperationsStatus,
    }),
    [
      dismissToast,
      markAllRead,
      navigationBadges,
      notifications,
      notify,
      syncOperationsStatus,
      toasts,
    ],
  );

  return (
    <InteractionContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismissToast={dismissToast} />
    </InteractionContext.Provider>
  );
}

export function useInteractions(): InteractionValue {
  const value = useContext(InteractionContext);
  if (!value) {
    throw new Error("useInteractions must be used inside InteractionProvider");
  }
  return value;
}
