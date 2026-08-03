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

export type ToastTone = "success" | "error" | "info";
export type ToastItem = { id: number; tone: ToastTone; message: string };
export type DemoNotification = {
  id: string;
  title: string;
  detail: string;
  read: boolean;
};

type InteractionValue = {
  toasts: ToastItem[];
  notifications: DemoNotification[];
  unreadCount: number;
  notify(tone: ToastTone, message: string): void;
  dismissToast(id: number): void;
  markAllRead(): void;
};

const seedNotifications: DemoNotification[] = [
  {
    id: "NOTICE-REVIEW",
    title: "3 条数据等待结算前复核",
    detail: "请在生成新结算批次前确认质量结论。",
    read: false,
  },
  {
    id: "NOTICE-AI",
    title: "AI 任务 SUB-019 处理异常",
    detail: "视频解析失败，可在 AI 任务页重新执行。",
    read: false,
  },
  {
    id: "NOTICE-WITHDRAWAL",
    title: "提现申请 WD-20260803 已通过",
    detail: "申请已进入打款处理阶段。",
    read: false,
  },
];

const InteractionContext = createContext<InteractionValue | null>(null);

export function InteractionProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] =
    useState<DemoNotification[]>(seedNotifications);
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
      unreadCount: notifications.filter((notification) => !notification.read)
        .length,
      notify,
      dismissToast,
      markAllRead,
    }),
    [dismissToast, markAllRead, notifications, notify, toasts],
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
