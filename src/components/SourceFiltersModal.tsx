import React, { useState, useEffect } from "react";
import { scanInstalledAudioPlugins, type InstalledAudioPlugin } from "../bridge";
import { Sliders, Plus, Trash2, X, Check, Eye, EyeOff, Sparkles, Volume2 } from "lucide-react";
import type { SceneSourceItem, SourceFilter } from "../types";

interface SourceFiltersModalProps {
  source: SceneSourceItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveFilters: (sourceId: string, filters: SourceFilter[]) => void;
}

const FILTER_TYPES: Array<{ type: SourceFilter["type"]; label: string; category: "Audio" | "Effect"; desc: string }> = [
  { type: "vst", label: "VST 2.x / VST3 Plug-in", category: "Audio", desc: "Run third-party VST compressor, EQ, reverb, or waves plugins via libobs host" },
  { type: "au", label: "Audio Unit (AU) Plug-in", category: "Audio", desc: "macOS native CoreAudio plugin host (Logic / FabFilter / Universal Audio)" },
  { type: "noise_suppress", label: "Noise Suppression (RNNoise)", category: "Audio", desc: "Remove HVAC hum, room hiss, or podium mic noise" },
  { type: "gain", label: "Gain", category: "Audio", desc: "Digital trim adjustment (-30 dB to +30 dB)" },
  { type: "compressor", label: "Compressor / Limiter", category: "Audio", desc: "Smooth dynamic range for spoken word or live worship vocals" },
  { type: "chroma_key", label: "Chroma Key", category: "Effect", desc: "Remove green/blue screen backgrounds" },
  { type: "color_correction", label: "Color Correction", category: "Effect", desc: "Adjust gamma, contrast, brightness, saturation, and hue" },
  { type: "lut", label: "Apply LUT (.cube / .png)", category: "Effect", desc: "Apply cinematic 3D LUT color grading" },
  { type: "crop_pad", label: "Crop / Pad", category: "Effect", desc: "Trim Left/Right/Top/Bottom edges cleanly" },
];

export const SourceFiltersModal: React.FC<SourceFiltersModalProps> = ({
  source,
  isOpen,
  onClose,
  onSaveFilters,
}) => {
  if (!isOpen || !source) return null;

  const [filters, setFilters] = useState<SourceFilter[]>(source.filters || []);
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(
    (source.filters && source.filters[0]?.id) || null
  );
  const [addingType, setAddingType] = useState<boolean>(false);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledAudioPlugin[]>([]);

  useEffect(() => {
    if (isOpen) {
      scanInstalledAudioPlugins().then(setInstalledPlugins).catch(() => {});
    }
  }, [isOpen]);

  const selectedFilter = filters.find((f) => f.id === selectedFilterId) || null;

  const handleAddFilter = (def: (typeof FILTER_TYPES)[number]) => {
    const newFilter: SourceFilter = {
      id: "flt_" + Date.now(),
      name: def.label,
      type: def.type,
      enabled: true,
      settings:
        def.type === "gain"
          ? { db: 0 }
          : def.type === "vst" || def.type === "au"
          ? { pluginPath: "", preset: "Default" }
          : def.type === "color_correction"
          ? { gamma: 0, contrast: 0, brightness: 0, saturation: 0 }
          : {},
    };
    const next = [...filters, newFilter];
    setFilters(next);
    setSelectedFilterId(newFilter.id);
    setAddingType(false);
  };

  const patchFilterSetting = (id: string, key: string, val: unknown) => {
    setFilters((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, settings: { ...f.settings, [key]: val } } : f
      )
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(8, 11, 16, 0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10004,
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 740,
          background: "#121721",
          border: "1px solid #3B82F6",
          borderRadius: 12,
          padding: 24,
          color: "#E2E8F0",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "0 20px 50px rgba(0,0,0,0.65)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Sliders size={20} color="#60A5FA" />
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#FFFFFF" }}>
                Filters & Plug-ins: {source.name}
              </h3>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>
                Attach VST / AU audio processors & real-time video effect filters
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, minHeight: 280 }}>
          {/* Left: Filter Chain Stack */}
          <div
            style={{
              background: "#0B0E14",
              border: "1px solid #1E2533",
              borderRadius: 8,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 230 }}>
              {filters.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "#64748B", fontSize: 12 }}>
                  No filters active. Click &quot;+ Add Filter&quot; below to attach VST, AU, or Video Effects.
                </div>
              ) : (
                filters.map((f) => {
                  const active = f.id === selectedFilterId;
                  return (
                    <div
                      key={f.id}
                      onClick={() => setSelectedFilterId(f.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                        background: active ? "#1E293B" : "#121721",
                        border: active ? "1px solid #3B82F6" : "1px solid #1E2533",
                      }}
                    >
                      <div style={{ overflow: "hidden" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: f.enabled ? "#FFFFFF" : "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {f.name}
                        </div>
                        <div style={{ fontSize: 10, color: "#60A5FA", textTransform: "uppercase" }}>
                          {f.type.replace(/_/g, " ")}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFilters((prev) => prev.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x)));
                          }}
                          style={{ background: "transparent", border: "none", color: f.enabled ? "#60A5FA" : "#475569", cursor: "pointer", padding: 2 }}
                        >
                          {f.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFilters((prev) => prev.filter((x) => x.id !== f.id));
                          }}
                          style={{ background: "transparent", border: "none", color: "#EF4444", cursor: "pointer", padding: 2 }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => setAddingType(!addingType)}
              style={{
                width: "100%",
                height: 34,
                background: "#2563EB",
                border: "1px solid #3B82F6",
                color: "#FFFFFF",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Plus size={14} /> Add Filter / Plugin
            </button>
          </div>

          {/* Right: Either Add Selector OR Selected Filter Settings */}
          <div
            style={{
              background: "#0B0E14",
              border: "1px solid #1E2533",
              borderRadius: 8,
              padding: 16,
              overflowY: "auto",
            }}
          >
            {addingType ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 4 }}>
                  Select Filter or Audio Plug-in Type
                </div>
                {FILTER_TYPES.map((def) => (
                  <button
                    key={def.type}
                    type="button"
                    onClick={() => handleAddFilter(def)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      background: "#161B24",
                      border: "1px solid #283344",
                      borderRadius: 6,
                      color: "#FFFFFF",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                        {def.category === "Audio" ? <Volume2 size={14} color="#10B981" /> : <Sparkles size={14} color="#A855F7" />}
                        {def.label}
                      </div>
                      <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{def.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : selectedFilter ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#FFFFFF" }}>{selectedFilter.name} Settings</div>
                {(selectedFilter.type === "vst" || selectedFilter.type === "au") && (
                  <>
                    <div>
                      <label style={labelStyle}>Plug-in File / Bundle Name</label>
                      <select
                        style={{ ...inputStyle, marginBottom: 6 }}
                        value={(selectedFilter.settings.pluginPath as string) || ""}
                        onChange={(e) => patchFilterSetting(selectedFilter.id, "pluginPath", e.target.value)}
                      >
                        <option value="">-- Select Installed OS Plug-in ({installedPlugins.length} found) --</option>
                        {installedPlugins.map((pl) => (
                          <option key={pl.path} value={pl.path}>
                            [{pl.format}] {pl.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        style={inputStyle}
                        value={(selectedFilter.settings.pluginPath as string) || ""}
                        onChange={(e) => patchFilterSetting(selectedFilter.id, "pluginPath", e.target.value)}
                        placeholder="Or enter custom VST3 / AU bundle path"
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Preset Slot</label>
                      <input
                        type="text"
                        style={inputStyle}
                        value={(selectedFilter.settings.preset as string) || "Default"}
                        onChange={(e) => patchFilterSetting(selectedFilter.id, "preset", e.target.value)}
                      />
                    </div>
                  </>
                )}

                {selectedFilter.type === "gain" && (
                  <div>
                    <label style={labelStyle}>Gain Boost / Attenuation ({(selectedFilter.settings.db as number) || 0} dB)</label>
                    <input
                      type="range"
                      min={-30}
                      max={30}
                      step={0.5}
                      value={(selectedFilter.settings.db as number) || 0}
                      onChange={(e) => patchFilterSetting(selectedFilter.id, "db", Number(e.target.value))}
                      style={{ width: "100%" }}
                    />
                  </div>
                )}

                {selectedFilter.type === "color_correction" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {["gamma", "contrast", "brightness", "saturation"].map((param) => (
                      <div key={param}>
                        <label style={labelStyle}>{param}</label>
                        <input
                          type="number"
                          step="0.1"
                          style={inputStyle}
                          value={(selectedFilter.settings[param] as number) || 0}
                          onChange={(e) => patchFilterSetting(selectedFilter.id, param, Number(e.target.value))}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {selectedFilter.type === "lut" && (
                  <div>
                    <label style={labelStyle}>LUT File Path (.cube or Hald PNG)</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={(selectedFilter.settings.lutPath as string) || ""}
                      onChange={(e) => patchFilterSetting(selectedFilter.id, "lutPath", e.target.value)}
                      placeholder="/Library/Application Support/OneRing/LUTs/WarmWorship.cube"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: "#64748B", fontSize: 13, paddingTop: 40, textAlign: "center" }}>
                Select a filter on the left to adjust parameters, or add a new VST / AU / Video Effect filter.
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 14px",
              background: "#1E2533",
              border: "1px solid #2E3748",
              color: "#CBD5E1",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSaveFilters(source.id, filters);
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 18px",
              background: "#2563EB",
              border: "1px solid #3B82F6",
              color: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <Check size={16} /> Apply Filter Chain
          </button>
        </div>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: "#94A3B8",
  marginBottom: 4,
  textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  background: "#121721",
  border: "1px solid #2B3545",
  borderRadius: 6,
  color: "#FFFFFF",
  fontSize: 13,
  boxSizing: "border-box",
};
