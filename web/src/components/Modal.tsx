"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

export function Modal({
  open,
  title,
  onClose,
  children,
  returnFocusRef,
  initialFocusRef,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeOnEscape = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;

    const returnTarget = returnFocusRef?.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableSelector = [
      "button:not([disabled])",
      "[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusableElements = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");

    const initialTarget =
      initialFocusRef?.current ?? focusableElements()[0] ?? dialogRef.current;
    initialTarget?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOnEscape();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = elements[0]!;
      const last = elements.at(-1)!;
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialogRef.current?.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnTarget?.focus();
    };
  }, [initialFocusRef, open, returnFocusRef]);

  if (!open) return null;

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeFromBackdrop}>
      <section
        ref={dialogRef}
        className="modal-card"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button modal-close"
            aria-label={`关闭${title}`}
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
