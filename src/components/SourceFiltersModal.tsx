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

interface FilterTypeDefinition {
  type: SourceFilter["type"];
  label: string;
  category: "Audio" | "Effect";
  desc: string;
}

const FILTER_TYPES: FilterTypeDefinition[] = [
  { type: "vst", label: "VST 2.x / VST3 Plug-in", category: "Audio", desc: "Run third-party VST compressor, EQ, reverb, or waves plugins via libobs host" },
  { type: "au", label: "Audio Unit (AU) Plug-in", category: "Audio", desc: "macOS native CoreAudio plugin host (Logic / FabFilter / Universal Audio)" },
  { type: "noise_suppress", label: "Noise Suppression (RNNoise)", category: "Audio", desc: "Remove HVAC hum, room hiss, or podium mic noise" },
  { type: "noise_gate", label: "Noise Gate", category: "Audio", desc: "Silence room bleed below open/close threshold with hold timing" },
  { type: "gain", label: "Gain", category: "Audio", desc: "Digital trim adjustment (-30 dB to +30 dB)" },
  { type: "compressor", label: "Compressor / Limiter", category: "Audio", desc: "Smooth dynamic range for spoken word or live worship vocals" },
  { type: "expander", label: "Expander", category: "Audio", desc: "Gently attenuate low-level noise floor and mic bleed" },
  { type: "basic_eq", label: "3-Band EQ", category: "Audio", desc: "Shape Low (120 Hz), Mid (1 kHz), and High (6 kHz) frequencies" },
  { type: "invert_polarity", label: "Invert Polarity", category: "Audio", desc: "Flip audio phase 180° to resolve multi-mic cancellation" },
  { type: "async_delay", label: "Audio Async Delay", category: "Audio", desc: "Delay audio stream (0–950 ms) for A/V lip-sync alignment" },
  { type: "chroma_key", label: "Chroma Key", category: "Effect", desc: "Remove green/blue screen backgrounds" },
  { type: "luma_key", label: "Luma Key", category: "Effect", desc: "Key out bright or dark luminance regions cleanly" },
  { type: "color_correction", label: "Color Correction", category: "Effect", desc: "Adjust gamma, contrast, brightness, saturation, and hue" },
  { type: "lut", label: "Apply LUT (.cube / .png)", category: "Effect", desc: "Apply cinematic 3D LUT color grading" },
  { type: "crop_pad", label: "Crop / Pad", category: "Effect", desc: "Trim Left/Right/Top/Bottom edges cleanly" },
  { type: "sharpness", label: "Sharpness", category: "Effect", desc: "Enhance edge detail on cameras and screen captures (0.00–1.00)" },
  { type: "scroll", label: "Scroll", category: "Effect", desc: "Continuous horizontal or vertical scroll for tickers and backgrounds" },
];

const DEFAULT_FILTER_SETTINGS: Record<SourceFilter["type"], Record<string, unknown>> = {
  vst: { pluginPath: "", preset: "Default" },
  au: { pluginPath: "", preset: "Default" },
  noise_suppress: { method: "rnnoise" },
  noise_gate: { openThresholdDb: -26, closeThresholdDb: -32, holdTimeMs: 200 },
  gain: { db: 0 },
  compressor: { ratio: 4, thresholdDb: -18, attackMs: 6, releaseMs: 60, outputGainDb: 0 },
  expander: { ratio: 2, thresholdDb: -40, attackMs: 10, releaseMs: 50, outputGainDb: 0 },
  basic_eq: { lowDb: 0, midDb: 0, highDb: 0 },
  invert_polarity: {},
  async_delay: { delayMs: 0 },
  chroma_key: { keyColor: "#00b140", similarity: 400, smoothness: 80 },
  luma_key: { lumaMax: 1, lumaMin: 0, lumaMaxSmooth: 0 },
  color_correction: { gamma: 0, contrast: 0, brightness: 0, saturation: 0 },
  lut: { lutPath: "" },
  crop_pad: { left: 0, right: 0, top: 0, bottom: 0 },
  sharpness: { sharpness: 0.08 },
  scroll: { speedX: 0, speedY: 0, loop: true },
};

interface SliderSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
  decimals?: number;
}

const SLIDER_SPECS_BY_TYPE: Partial<Record<SourceFilter["type"], SliderSpec[]>> = {
  gain: [
    { key: "db", label: "Gain Boost / Attenuation", min: -30, max: 30, step: 0.5, defaultValue: 0, unit: " dB", decimals: 1 },
  ],
  luma_key: [
    { key: "lumaMax", label: "Luma Max", min: 0, max: 1, step: 0.01, defaultValue: 1, decimals: 2 },
    { key: "lumaMin", label: "Luma Min", min: 0, max: 1, step: 0.01, defaultValue: 0, decimals: 2 },
    { key: "lumaMaxSmooth", label: "Luma Max Smooth", min: 0, max: 1, step: 0.01, defaultValue: 0, decimals: 2 },
  ],
  noise_gate: [
    { key: "openThresholdDb", label: "Open Threshold", min: -96, max: 0, step: 1, defaultValue: -26, unit: " dB" },
    { key: "closeThresholdDb", label: "Close Threshold", min: -96, max: 0, step: 1, defaultValue: -32, unit: " dB" },
    { key: "holdTimeMs", label: "Hold Time", min: 0, max: 2000, step: 10, defaultValue: 200, unit: " ms" },
  ],
  basic_eq: [
    { key: "lowDb", label: "Low (120 Hz)", min: -20, max: 20, step: 0.5, defaultValue: 0, unit: " dB", decimals: 1 },
    { key: "midDb", label: "Mid (1 kHz)", min: -20, max: 20, step: 0.5, defaultValue: 0, unit: " dB", decimals: 1 },
    { key: "highDb", label: "High (6 kHz)", min: -20, max: 20, step: 0.5, defaultValue: 0, unit: " dB", decimals: 1 },
  ],
  sharpness: [
    { key: "sharpness", label: "Sharpness", min: 0, max: 1, step: 0.01, defaultValue: 0.08, decimals: 2 },
  ],
  async_delay: [
    { key: "delayMs", label: "Async Delay", min: 0, max: 950, step: 5, defaultValue: 0, unit: " ms" },
  ],
};

function getDynamicsSpecs(type: "compressor" | "expander"): SliderSpec[] {
  const isExpander = type === "expander";
  return [
    { key: "ratio", label: "Ratio", min: 1, max: 32, step: 0.5, defaultValue: isExpander ? 2 : 4, unit: ":1", decimals: 1 },
    { key: "thresholdDb", label: "Threshold", min: -60, max: 0, step: 0.5, defaultValue: isExpander ? -40 : -18, unit: " dB", decimals: 1 },
    { key: "attackMs", label: "Attack", min: 1, max: 500, step: 1, defaultValue: isExpander ? 10 : 6, unit: " ms" },
    { key: "releaseMs", label: "Release", min: 1, max: 1000, step: 5, defaultValue: isExpander ? 50 : 60, unit: " ms" },
    { key: "outputGainDb", label: "Output Gain", min: -32, max: 32, step: 0.5, defaultValue: 0, unit: " dB", decimals: 1 },
  ];
}

function numSetting(filter: SourceFilter, key: string, fallback: number): number {
  const raw = filter.settings[key];
  return typeof raw === "number" && !Number.isNaN(raw) ? raw : fallback;
}

interface SliderFieldProps {
  spec: SliderSpec;
  filter: SourceFilter;
  onPatch: (id: string, key: string, val: unknown) => void;
}

const SliderField: React.FC<SliderFieldProps> = ({ spec, filter, onPatch }) => {
  const value = numSetting(filter, spec.key, spec.defaultValue);
  const decimals = spec.decimals ?? 0;
  const formatted = decimals > 0 ? value.toFixed(decimals) : String(value);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{spec.label}</label>
        <span className="mono" style={{ fontSize: 11.5, color: "#93C5FD", fontWeight: 700 }}>
          {formatted}
          {spec.unit ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        aria-label={spec.label}
        onChange={(e) => onPatch(filter.id, spec.key, Number(e.target.value))}
        style={{ width: "100%", accentColor: "#3B82F6", cursor: "pointer" }}
      />
    </div>
  );
};

export const SourceFiltersModal: React.FC<SourceFiltersModalProps> = ({
  source,
  isOpen,
  onClose,
  onSaveFilters,
}) => {
  const [filters, setFilters] = useState<SourceFilter[]>(source?.filters || []);
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(
    (source?.filters && source.filters[0]?.id) || null
  );
  const [addingType, setAddingType] = useState<boolean>(false);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledAudioPlugin[]>([]);

  useEffect(() => {
    if (isOpen && source) {
      const initial = source.filters || [];
      setFilters(initial);
      setSelectedFilterId(initial[0]?.id || null);
      setAddingType(false);
      scanInstalledAudioPlugins().then(setInstalledPlugins).catch(() => {});
    }
  }, [isOpen, source?.id]);

  if (!isOpen || !source) return null;

  const selectedFilter = filters.find((f) => f.id === selectedFilterId) || null;

  const handleAddFilter = (def: FilterTypeDefinition) => {
    const newFilter: SourceFilter = {
      id: "flt_" + Date.now(),
      name: def.label,
      type: def.type,
      enabled: true,
      settings: { ...DEFAULT_FILTER_SETTINGS[def.type] },
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

  const activeSliderSpecs =
    selectedFilter && (selectedFilter.type === "compressor" || selectedFilter.type === "expander")
      ? getDynamicsSpecs(selectedFilter.type)
      : selectedFilter
      ? SLIDER_SPECS_BY_TYPE[selectedFilter.type]
      : undefined;

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
          maxWidth: 760,
          maxHeight: "88vh",
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

        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, height: 380, minHeight: 0 }}>
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
              minHeight: 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1, minHeight: 0 }}>
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
                      onClick={() => {
                        setSelectedFilterId(f.id);
                        setAddingType(false);
                      }}
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
                            if (selectedFilterId === f.id) setSelectedFilterId(null);
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
                flexShrink: 0,
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
              minHeight: 0,
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

                {activeSliderSpecs && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {activeSliderSpecs.map((spec) => (
                      <SliderField
                        key={spec.key}
                        spec={spec}
                        filter={selectedFilter}
                        onPatch={patchFilterSetting}
                      />
                    ))}
                  </div>
                )}

                {selectedFilter.type === "chroma_key" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label style={labelStyle}>Key Color</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                          type="color"
                          aria-label="Key Color"
                          value={(selectedFilter.settings.keyColor as string) || "#00b140"}
                          onChange={(e) => patchFilterSetting(selectedFilter.id, "keyColor", e.target.value)}
                          style={{
                            width: 48,
                            height: 36,
                            padding: 2,
                            background: "#121721",
                            border: "1px solid #2B3545",
                            borderRadius: 6,
                            cursor: "pointer",
                          }}
                        />
                        <input
                          type="text"
                          style={inputStyle}
                          value={(selectedFilter.settings.keyColor as string) || "#00b140"}
                          onChange={(e) => patchFilterSetting(selectedFilter.id, "keyColor", e.target.value)}
                          placeholder="#00b140"
                        />
                      </div>
                    </div>
                    <SliderField
                      spec={{ key: "similarity", label: "Similarity", min: 1, max: 1000, step: 1, defaultValue: 400 }}
                      filter={selectedFilter}
                      onPatch={patchFilterSetting}
                    />
                    <SliderField
                      spec={{ key: "smoothness", label: "Smoothness", min: 1, max: 1000, step: 1, defaultValue: 80 }}
                      filter={selectedFilter}
                      onPatch={patchFilterSetting}
                    />
                  </div>
                )}

                {selectedFilter.type === "scroll" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <SliderField
                      spec={{ key: "speedX", label: "Horizontal Speed (X)", min: -500, max: 500, step: 1, defaultValue: 0, unit: " px/s" }}
                      filter={selectedFilter}
                      onPatch={patchFilterSetting}
                    />
                    <SliderField
                      spec={{ key: "speedY", label: "Vertical Speed (Y)", min: -500, max: 500, step: 1, defaultValue: 0, unit: " px/s" }}
                      filter={selectedFilter}
                      onPatch={patchFilterSetting}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#E2E8F0", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedFilter.settings.loop !== false}
                        onChange={(e) => patchFilterSetting(selectedFilter.id, "loop", e.target.checked)}
                        style={{ accentColor: "#3B82F6", cursor: "pointer" }}
                      />
                      <span>Loop continuously</span>
                    </label>
                  </div>
                )}

                {selectedFilter.type === "noise_suppress" && (
                  <div>
                    <label style={labelStyle}>Suppression Method</label>
                    <select
                      style={inputStyle}
                      value={(selectedFilter.settings.method as string) || "rnnoise"}
                      onChange={(e) => patchFilterSetting(selectedFilter.id, "method", e.target.value)}
                    >
                      <option value="rnnoise">RNNoise (Higher quality, low CPU)</option>
                      <option value="speex">Speex (Legacy low-CPU suppressor)</option>
                    </select>
                  </div>
                )}

                {selectedFilter.type === "invert_polarity" && (
                  <div style={{ padding: 12, background: "#121721", border: "1px solid #1E2533", borderRadius: 6, fontSize: 12, color: "#94A3B8" }}>
                    Inverts the audio signal phase by 180° when enabled. Toggle the eye icon on the left to bypass.
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
                          value={numSetting(selectedFilter, param, 0)}
                          onChange={(e) => patchFilterSetting(selectedFilter.id, param, Number(e.target.value))}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {selectedFilter.type === "crop_pad" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {["left", "right", "top", "bottom"].map((edge) => (
                      <div key={edge}>
                        <label style={labelStyle}>{edge} (px)</label>
                        <input
                          type="number"
                          step="1"
                          style={inputStyle}
                          value={numSetting(selectedFilter, edge, 0)}
                          onChange={(e) => patchFilterSetting(selectedFilter.id, edge, Number(e.target.value))}
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
