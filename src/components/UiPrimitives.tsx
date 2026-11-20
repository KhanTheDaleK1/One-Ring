import React, { useCallback, useEffect, useRef, useState } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

/** Consistent, honest "nothing here yet" surface with an optional next action. */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}) => (
  <div className="empty-state">
    {icon && <div aria-hidden="true">{icon}</div>}
    <h3 className="empty-state__title">{title}</h3>
    {description && <p className="empty-state__description">{description}</p>}
    {actionLabel && onAction && (
      <button type="button" className="btn btn-sm" onClick={onAction}>
        {actionLabel}
      </button>
    )}
  </div>
);

export type NoticeTone = "success" | "warning" | "error" | "info";

export interface NoticeProps {
  tone: NoticeTone;
  message: React.ReactNode;
  onDismiss?: () => void;
  /** Success/info notices auto-dismiss; warnings and errors persist. */
  autoDismissMs?: number;
  className?: string;
}

export const Notice: React.FC<NoticeProps> = ({
  tone,
  message,
  onDismiss,
  autoDismissMs,
  className,
}) => {
  const role = tone === "error" || tone === "warning" ? "alert" : "status";
  const defaultTimeout = tone === "success" || tone === "info" ? 5000 : undefined;

  useEffect(() => {
    const timeout = autoDismissMs ?? defaultTimeout;
    if (!timeout || !onDismiss) return;
    const handle = window.setTimeout(onDismiss, timeout);
    return () => window.clearTimeout(handle);
  }, [autoDismissMs, defaultTimeout, onDismiss, message]);

  return (
    <div className={`notice notice--${tone}${className ? ` ${className}` : ""}`} role={role}>
      <span className="notice__message">{message}</span>
      {onDismiss && (
        <button
          type="button"
          className="notice__dismiss"
          onClick={onDismiss}
          aria-label={`Dismiss ${tone} notice`}
        >
          ×
        </button>
      )}
    </div>
  );
};

export interface AsyncAction<TArgs extends unknown[], TResult> {
  pending: boolean;
  error: string | null;
  result: TResult | null;
  run: (...args: TArgs) => Promise<TResult>;
  reset: () => void;
}

/**
 * Tracks pending/error/result for any promise-returning action. `run` rejects on
 * failure so callers can branch, while `error` drives inline honest feedback.
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>
): AsyncAction<TArgs, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const mountedRef = useRef(true);
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (...args: TArgs): Promise<TResult> => {
    setPending(true);
    setError(null);
    try {
      const value = await actionRef.current(...args);
      if (mountedRef.current) setResult(value);
      return value;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The action could not be completed.";
      if (mountedRef.current) setError(message);
      throw caught;
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setPending(false);
    setError(null);
    setResult(null);
  }, []);

  return { pending, error, result, run, reset };
}

export default { EmptyState, Notice, useAsyncAction };
