"use client";

import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import type { ToastItem } from "../interactions/InteractionContext";

const iconByTone = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
};

export function ToastViewport({
  toasts,
  dismissToast,
}: {
  toasts: ToastItem[];
  dismissToast(id: number): void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-viewport" aria-label="操作提示">
      {toasts.map((toast) => {
        const Icon = iconByTone[toast.tone];
        return (
          <div
            key={toast.id}
            className={`toast-item toast-${toast.tone}`}
            role={toast.tone === "error" ? "alert" : "status"}
            aria-label={toast.message}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label={`关闭${toast.message}`}
              onClick={() => dismissToast(toast.id)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
