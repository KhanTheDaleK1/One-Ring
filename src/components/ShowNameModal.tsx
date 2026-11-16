import React, { useState } from "react";
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

  if (!isOpen) return null;

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
    >
      <div
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16 }}>
            <Pencil size={18} color="#60A5FA" />
            Edit Service / Show Name
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94A3B8", marginBottom: 6 }}>
            Show Title (e.g. "Sunday Morning - 10:30 AM")
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sunday Morning Worship"
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
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 14px",
              background: "#1E293B",
              border: "1px solid #334155",
              color: "#CBD5E1",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (name.trim()) onSave(name.trim());
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              background: "#2563EB",
              border: "1px solid #3B82F6",
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
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
