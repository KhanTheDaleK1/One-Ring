import React, { useEffect, useState } from "react";
import { Pencil, Check, X } from "lucide-react";

interface ShowNameModalProps {
  currentName: string;
  isOpen: boolean;
  onSave: (newName: string) => void;
  onClose: () => void;
}

export const ShowNameModal: React.FC<ShowNameModalProps> = ({
  currentName,
  isOpen,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(currentName);

  useEffect(() => {
    if (isOpen) setName(currentName);
  }, [isOpen, currentName]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const trimmed = name.trim();
  const canSave = trimmed.length > 0;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(10, 14, 23, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 20,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="show-name-modal-title"
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#141923",
          border: "1px solid #3B82F6",
          borderRadius: 12,
          padding: 22,
          color: "#E2E8F0",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            id="show-name-modal-title"
            style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16 }}
          >
            <Pencil size={18} color="#60A5FA" />
            Edit Service / Show Name
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close show name dialog"
            style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        <div>
          <label
            htmlFor="show-name-input"
            style={{ display: "block", fontSize: 12, color: "#94A3B8", marginBottom: 6 }}
          >
            Show title
          </label>
          <input
            id="show-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sunday Morning Service"
            autoFocus
            style={{
              width: "100%",
              height: 40,
              padding: "0 12px",
              borderRadius: 8,
              background: "#0B0D10",
              color: "#FFFFFF",
              border: "1px solid #3B82F6",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
          {!canSave && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#F87171" }}>
              Enter a show name to save.
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 14px",
              background: "#1E293B",
              border: "1px solid #475569",
              color: "#CBD5E1",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return;
              onSave(trimmed);
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              background: canSave ? "#2563EB" : "#1E293B",
              border: `1px solid ${canSave ? "#3B82F6" : "#475569"}`,
              color: canSave ? "#FFFFFF" : "#94A3B8",
              borderRadius: 6,
              cursor: canSave ? "pointer" : "not-allowed",
              fontWeight: 600,
            }}
          >
            <Check size={16} /> Save Name
          </button>
        </div>
      </div>
    </div>
  );
};
