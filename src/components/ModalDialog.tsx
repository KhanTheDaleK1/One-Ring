import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );
}

export interface ModalDialogProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional element to receive focus when the dialog opens. */
  initialFocusRef?: React.RefObject<HTMLElement>;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  /** Prevent Escape/backdrop dismissal while work is in flight. */
  disableClose?: boolean;
  descriptionId?: string;
  panelStyle?: React.CSSProperties;
  backdropStyle?: React.CSSProperties;
  className?: string;
}

/**
 * One accessible dialog shell: dialog semantics, Escape/backdrop dismissal,
 * initial focus, a Tab focus trap and focus restoration on close/unmount.
 */
export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  title,
  onClose,
  children,
  initialFocusRef,
  closeOnBackdrop = true,
  closeOnEscape = true,
  disableClose = false,
  descriptionId,
  panelStyle,
  backdropStyle,
  className,
}) => {
  const generatedId = useId();
  const titleId = `onering-dialog-title-${generatedId.replace(/:/g, "")}`;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const target = initialFocusRef?.current ?? getFocusable(panel)[0] ?? panel;
      target.focus();
    }
    return () => {
      const restore = restoreFocusRef.current;
      if (restore && document.contains(restore)) restore.focus();
      restoreFocusRef.current = null;
    };
  }, [isOpen, initialFocusRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape && !disableClose) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, closeOnEscape, disableClose, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="onering-dialog-backdrop"
      style={backdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && !disableClose) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={`onering-dialog-panel${className ? ` ${className}` : ""}`}
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="onering-dialog-header">
          <h2 id={titleId} className="onering-dialog-title">
            {title}
          </h2>
        </div>
        <div className="onering-dialog-body">{children}</div>
      </div>
    </div>,
    document.body
  );
};

export default ModalDialog;
