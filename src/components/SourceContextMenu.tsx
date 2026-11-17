import React, { useState } from "react";
import {
  Copy,
  ClipboardPaste,
  Trash2,
  Edit3,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Move,
  Sliders,
  Settings,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  VolumeX,
  Volume2,
  FolderPlus,
  Camera,
  Monitor,
  Palette,
  ChevronRight,
  RotateCw,
  Maximize2,
  Plus,
} from "lucide-react";
import type { SceneSourceItem, SourceFilter, SourceTransform } from "../types";

export interface SourceContextMenuProps {
  source: SceneSourceItem;
  x: number;
  y: number;
  hasClipboardSource: boolean;
  hasClipboardFilters: boolean;
  hasClipboardTransform: boolean;
  onClose: () => void;
  onOpenAdd: () => void;
  onOpenProperties: (source: SceneSourceItem) => void;
  onOpenFilters: (source: SceneSourceItem) => void;
  onOpenTransform: (source: SceneSourceItem) => void;
  onRename: (source: SceneSourceItem) => void;
  onRemove: (id: string) => void;
  onDuplicate: (source: SceneSourceItem) => void;
  onCopySource: (source: SceneSourceItem) => void;
  onPasteDuplicate: () => void;
  onCopyFilters: (source: SceneSourceItem) => void;
  onPasteFilters: (id: string) => void;
  onCopyTransform: (source: SceneSourceItem) => void;
  onPasteTransform: (id: string) => void;
  onResetTransform: (id: string) => void;
  onFitToScreen: (id: string) => void;
  onOrderAction: (id: string, action: "up" | "down" | "top" | "bottom") => void;
  onSetColorTag: (id: string, color: string | undefined) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onToggleHideInMixer: (id: string) => void;
  onSetScaleFilter: (id: string, filter: SourceTransform["scaleFilter"]) => void;
  onSetBlendingMode: (id: string, mode: SourceTransform["blendingMode"]) => void;
  onSetDeinterlacing: (id: string, mode: SourceTransform["deinterlacing"]) => void;
  onScreenshotSource: (source: SceneSourceItem) => void;
}

const COLOR_PRESETS = [
  { name: "None", value: undefined },
  { name: "Crimson", value: "#EF4444" },
  { name: "Amber", value: "#F59E0B" },
  { name: "Emerald", value: "#10B981" },
  { name: "Cobalt", value: "#3B82F6" },
  { name: "Violet", value: "#8B5CF6" },
  { name: "Cyan", value: "#06B6D4" },
  { name: "Magenta", value: "#EC4899" },
];

export const SourceContextMenu: React.FC<SourceContextMenuProps> = ({
  source,
  x,
  y,
  hasClipboardSource,
  hasClipboardFilters,
  hasClipboardTransform,
  onClose,
  onOpenAdd,
  onOpenProperties,
  onOpenFilters,
  onOpenTransform,
  onRename,
  onRemove,
  onDuplicate,
  onCopySource,
  onPasteDuplicate,
  onCopyFilters,
  onPasteFilters,
  onCopyTransform,
  onPasteTransform,
  onResetTransform,
  onFitToScreen,
  onOrderAction,
  onSetColorTag,
  onToggleVisibility,
  onToggleLock,
  onToggleHideInMixer,
  onSetScaleFilter,
  onSetBlendingMode,
  onSetDeinterlacing,
  onScreenshotSource,
}) => {
  const [submenu, setSubmenu] = useState<
    null | "color" | "order" | "transform" | "scale" | "blending" | "deinterlace"
  >(null);

  // Clamp coordinates so menu stays comfortably inside viewport
  const clampedLeft = Math.min(x, window.innerWidth - 260);
  const clampedTop = Math.min(y, window.innerHeight - 440);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10050 }}
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: clampedTop,
          left: clampedLeft,
          width: 240,
          background: "#161B26",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: "5px 0",
          boxShadow: "0 16px 40px rgba(0,0,0,0.7)",
          color: "#E2E8F0",
          fontSize: 12.5,
          userSelect: "none",
        }}
      >
        <MenuBtn icon={<Plus size={13} />} label="Add Source" onClick={() => { onOpenAdd(); onClose(); }} />

        <div
          style={submenuTriggerStyle}
          onMouseEnter={() => setSubmenu("color")}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Palette size={13} color={source.colorTag || "#94A3B8"} /> Set Color
          </span>
          <ChevronRight size={13} color="#64748B" />
          {submenu === "color" && (
            <div style={submenuBoxStyle}>
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => {
                    onSetColorTag(source.id, c.value);
                    onClose();
                  }}
                  style={menuItemStyle}
                >
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 3,
                      background: c.value || "transparent",
                      border: "1px solid #64748B",
                      display: "inline-block",
                    }}
                  />
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <Divider />

        <MenuBtn icon={<Copy size={13} />} label="Copy" shortcut="⌘C" onClick={() => { onCopySource(source); onClose(); }} />
        <MenuBtn
          icon={<ClipboardPaste size={13} />}
          label="Paste (Duplicate)"
          disabled={!hasClipboardSource}
          onClick={() => {
            if (hasClipboardSource) {
              onPasteDuplicate();
              onClose();
            }
          }}
        />
        <MenuBtn icon={<Copy size={13} />} label="Duplicate Source..." onClick={() => { onDuplicate(source); onClose(); }} />

        <Divider />

        <MenuBtn icon={<Copy size={13} />} label="Copy Filters" onClick={() => { onCopyFilters(source); onClose(); }} />
        <MenuBtn
          icon={<ClipboardPaste size={13} />}
          label="Paste Filters"
          disabled={!hasClipboardFilters}
          onClick={() => {
            if (hasClipboardFilters) {
              onPasteFilters(source.id);
              onClose();
            }
          }}
        />

        <Divider />

        <MenuBtn icon={<Edit3 size={13} />} label="Rename" shortcut="F2" onClick={() => { onRename(source); onClose(); }} />
        <MenuBtn
          icon={source.enabled ? <EyeOff size={13} /> : <Eye size={13} />}
          label={source.enabled ? "Hide in Scene" : "Show in Scene"}
          onClick={() => { onToggleVisibility(source.id); onClose(); }}
        />
        <MenuBtn
          icon={source.locked ? <Unlock size={13} /> : <Lock size={13} />}
          label={source.locked ? "Unlock Position" : "Lock Position"}
          onClick={() => { onToggleLock(source.id); onClose(); }}
        />
        <MenuBtn
          icon={source.hideInMixer ? <Volume2 size={13} /> : <VolumeX size={13} />}
          label={source.hideInMixer ? "Show in Audio Mixer" : "Hide in Audio Mixer"}
          onClick={() => { onToggleHideInMixer(source.id); onClose(); }}
        />
        <MenuBtn
          icon={<Trash2 size={13} color="#EF4444" />}
          label="Remove"
          shortcut="Del"
          danger
          onClick={() => { onRemove(source.id); onClose(); }}
        />

        <Divider />

        {/* Order Submenu */}
        <div style={submenuTriggerStyle} onMouseEnter={() => setSubmenu("order")}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ArrowUp size={13} color="#94A3B8" /> Order
          </span>
          <ChevronRight size={13} color="#64748B" />
          {submenu === "order" && (
            <div style={submenuBoxStyle}>
              <MenuBtn icon={<ArrowUp size={13} />} label="Move Up" onClick={() => { onOrderAction(source.id, "up"); onClose(); }} />
              <MenuBtn icon={<ArrowDown size={13} />} label="Move Down" onClick={() => { onOrderAction(source.id, "down"); onClose(); }} />
              <Divider />
              <MenuBtn icon={<ChevronsUp size={13} />} label="Move to Top" onClick={() => { onOrderAction(source.id, "top"); onClose(); }} />
              <MenuBtn icon={<ChevronsDown size={13} />} label="Move to Bottom" onClick={() => { onOrderAction(source.id, "bottom"); onClose(); }} />
            </div>
          )}
        </div>

        {/* Transform Submenu */}
        <div style={submenuTriggerStyle} onMouseEnter={() => setSubmenu("transform")}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Move size={13} color="#94A3B8" /> Transform
          </span>
          <ChevronRight size={13} color="#64748B" />
          {submenu === "transform" && (
            <div style={{ ...submenuBoxStyle, width: 210 }}>
              <MenuBtn icon={<Move size={13} />} label="Edit Transform..." shortcut="⌘E" onClick={() => { onOpenTransform(source); onClose(); }} />
              <Divider />
              <MenuBtn icon={<Copy size={13} />} label="Copy Transform" onClick={() => { onCopyTransform(source); onClose(); }} />
              <MenuBtn
                icon={<ClipboardPaste size={13} />}
                label="Paste Transform"
                disabled={!hasClipboardTransform}
                onClick={() => {
                  if (hasClipboardTransform) {
                    onPasteTransform(source.id);
                    onClose();
                  }
                }}
              />
              <MenuBtn icon={<RotateCw size={13} />} label="Reset Transform" shortcut="⌘R" onClick={() => { onResetTransform(source.id); onClose(); }} />
              <Divider />
              <MenuBtn icon={<Maximize2 size={13} />} label="Fit to Screen" shortcut="⌘F" onClick={() => { onFitToScreen(source.id); onClose(); }} />
            </div>
          )}
        </div>

        {/* Scale Filtering */}
        <div style={submenuTriggerStyle} onMouseEnter={() => setSubmenu("scale")}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Monitor size={13} color="#94A3B8" /> Scale Filtering
          </span>
          <ChevronRight size={13} color="#64748B" />
          {submenu === "scale" && (
            <div style={submenuBoxStyle}>
              {(["disable", "point", "bilinear", "bicubic", "lanczos", "area"] as const).map((sf) => (
                <MenuBtn
                  key={sf}
                  label={sf.charAt(0).toUpperCase() + sf.slice(1) + (source.transform?.scaleFilter === sf ? " ✓" : "")}
                  onClick={() => { onSetScaleFilter(source.id, sf); onClose(); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Blending Mode */}
        <div style={submenuTriggerStyle} onMouseEnter={() => setSubmenu("blending")}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FolderPlus size={13} color="#94A3B8" /> Blending Mode
          </span>
          <ChevronRight size={13} color="#64748B" />
          {submenu === "blending" && (
            <div style={submenuBoxStyle}>
              {(["normal", "additive", "subtract", "screen", "multiply", "lighten", "darken"] as const).map((bm) => (
                <MenuBtn
                  key={bm}
                  label={bm.charAt(0).toUpperCase() + bm.slice(1) + (source.transform?.blendingMode === bm ? " ✓" : "")}
                  onClick={() => { onSetBlendingMode(source.id, bm); onClose(); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Deinterlacing */}
        <div style={submenuTriggerStyle} onMouseEnter={() => setSubmenu("deinterlace")}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Monitor size={13} color="#94A3B8" /> Deinterlacing
          </span>
          <ChevronRight size={13} color="#64748B" />
          {submenu === "deinterlace" && (
            <div style={submenuBoxStyle}>
              {(["disable", "discard", "retro", "blend", "linear", "yadif"] as const).map((di) => (
                <MenuBtn
                  key={di}
                  label={di.charAt(0).toUpperCase() + di.slice(1) + (source.transform?.deinterlacing === di ? " ✓" : "")}
                  onClick={() => { onSetDeinterlacing(source.id, di); onClose(); }}
                />
              ))}
            </div>
          )}
        </div>

        <Divider />

        <MenuBtn icon={<Camera size={13} />} label="Screenshot (Source)" onClick={() => { onScreenshotSource(source); onClose(); }} />
        <MenuBtn icon={<Sliders size={13} color="#A855F7" />} label="Filters & VST Plugins" onClick={() => { onOpenFilters(source); onClose(); }} />
        <MenuBtn icon={<Settings size={13} color="#60A5FA" />} label="Properties" onClick={() => { onOpenProperties(source); onClose(); }} />
      </div>
    </div>
  );
};

const MenuBtn: React.FC<{
  icon?: React.ReactNode;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}> = ({ icon, label, shortcut, danger, disabled, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    style={{
      ...menuItemStyle,
      color: disabled ? "#475569" : danger ? "#F87171" : "#E2E8F0",
      cursor: disabled ? "not-allowed" : "pointer",
      justifyContent: "space-between",
    }}
  >
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {icon}
      <span>{label}</span>
    </span>
    {shortcut && <span style={{ fontSize: 10.5, color: "#64748B" }}>{shortcut}</span>}
  </button>
);

const Divider = () => (
  <div style={{ height: 1, background: "#283344", margin: "4px 0" }} />
);

const menuItemStyle: React.CSSProperties = {
  width: "100%",
  background: "transparent",
  border: "none",
  color: "#E2E8F0",
  padding: "6px 12px",
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12.5,
  textAlign: "left",
  cursor: "pointer",
};

const submenuTriggerStyle: React.CSSProperties = {
  ...menuItemStyle,
  justifyContent: "space-between",
  position: "relative",
};

const submenuBoxStyle: React.CSSProperties = {
  position: "absolute",
  top: -4,
  left: "100%",
  marginLeft: 2,
  width: 170,
  background: "#161B26",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "4px 0",
  boxShadow: "0 12px 30px rgba(0,0,0,0.7)",
  zIndex: 10060,
};
