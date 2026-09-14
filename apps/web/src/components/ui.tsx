"use client";

import type { ReactNode } from "react";

export function Badge({ children, cls = "" }: { children: ReactNode; cls?: string }) {
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <span
      role="switch"
      aria-checked={on}
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => !disabled && onChange(!on)}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
    />
  );
}

export function Alert({ kind, children }: { kind: "err" | "ok" | "warn"; children: ReactNode }) {
  return <div className={`alert ${kind}`}>{children}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn small" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
