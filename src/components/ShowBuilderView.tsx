import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  Download,
  FilePlus2,
  FolderOpen,
  ListPlus,
  Music4,
  Pencil,
  Plus,
  Settings,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  AppStateSnapshot,
  CameraPreset,
  DcaChannel,
  RingShowFile,
  ServiceCue,
  SlideCue,
  SlideKind,
} from "../types";
import { buildShowFile, downloadShowFile, readShowFile } from "../showFile";

export type BuilderIntent = "broadcast" | "dca" | "camera" | "slides" | null;

type ModalState =
  | { kind: "broadcast"; cue?: ServiceCue }
  | { kind: "dca"; dca?: DcaChannel }
  | { kind: "camera"; camera?: CameraPreset }
  | { kind: "slides" }
  | null;

interface ShowBuilderViewProps {
  state: AppStateSnapshot;
  intent: BuilderIntent;
  onIntentHandled: () => void;
  onApplyShowFile: (show: RingShowFile) => void;
  onOpenSettings: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 9px",
  borderRadius: 8,
  background: "#0B0D10",
  color: "#F3F4F6",
  border: "1px solid #2E3746",
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: "#D1D5DB",
  marginBottom: 4,
};

const primaryButton: React.CSSProperties = {
  height: 38,
  padding: "0 13px",
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "#2563EB",
  borderColor: "#60A5FA",
};

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label style={{ display: "block" }}>
    <span style={labelStyle}>{label}</span>
    {children}
  </label>
);

const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => (
  <div
    role="presentation"
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 1100,
      background: "rgba(2,4,8,0.74)",
      display: "grid",
      placeItems: "center",
      padding: 24,
      backdropFilter: "blur(2px)",
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="card"
      style={{ width: "min(720px, 100%)", padding: 20, maxHeight: "90vh", overflowY: "auto" }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  </div>
);

function parseSlideText(raw: string): SlideCue[] {
  const blocks = raw.trim()
    ? raw.includes("---")
      ? raw.split(/^\s*---\s*$/m)
      : raw.split(/\n+/)
    : [];
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const first = lines[0] ?? `Slide ${index + 1}`;
      const body = lines.slice(1).join(" ") || first;
      return {
        id: `slide-${Date.now().toString(36)}-${index + 1}`,
        number: index + 1,
        section: first,
        title: first,
        text: body,
        kind: "lyrics" as SlideKind,
      };
    });
}

const ShowSection: React.FC<{
  title: string;
  count: number;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}> = ({ title, count, addLabel, onAdd, children }) => (
  <div className="card" style={{ padding: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
        <div className="mono" style={{ fontSize: 11, color: "#6B7280" }}>
          {count} item{count === 1 ? "" : "s"}
        </div>
      </div>
      <button type="button" className="btn" onClick={onAdd} style={{ height: 34, padding: "0 11px", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
        <Plus size={14} /> {addLabel}
      </button>
    </div>
    {children}
  </div>
);

export const ShowBuilderView: React.FC<ShowBuilderViewProps> = ({
  state,
  intent,
  onIntentHandled,
  onApplyShowFile,
  onOpenSettings,
}) => {
  const [modal, setModal] = useState<ModalState>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!intent) return;
    if (intent === "broadcast") setModal({ kind: "broadcast" });
    if (intent === "dca") setModal({ kind: "dca" });
    if (intent === "camera") setModal({ kind: "camera" });
    if (intent === "slides") setModal({ kind: "slides" });
    onIntentHandled();
  }, [intent, onIntentHandled]);

  const slideCount = state.slides.slides?.length ?? 0;
  const allEmpty =
    state.cues.length === 0 &&
    state.dcas.length === 0 &&
    state.cameras.length === 0 &&
    slideCount === 0;

  const mutateShow = (mutator: (show: RingShowFile) => void) => {
    const show = buildShowFile(state);
    mutator(show);
    onApplyShowFile(show);
  };

  const saveCue = (cue: ServiceCue) => {
    mutateShow((show) => {
      const exists = show.cues.some((entry) => entry.id === cue.id);
      show.cues = exists
        ? show.cues.map((entry) => (entry.id === cue.id ? cue : entry))
        : [...show.cues, cue];
      show.cues = show.cues.map((entry, index) => ({ ...entry, index: index + 1 }));
    });
    setModal(null);
  };

  const deleteCue = (cueId: string) => {
    mutateShow((show) => {
      show.cues = show.cues
        .filter((entry) => entry.id !== cueId)
        .map((entry, index) => ({ ...entry, index: index + 1 }));
    });
  };

  const saveDca = (dca: DcaChannel) => {
    mutateShow((show) => {
      const exists = show.dcas.some((entry) => entry.id === dca.id);
      show.dcas = exists
        ? show.dcas.map((entry) => (entry.id === dca.id ? dca : entry))
        : [...show.dcas, dca].sort((a, b) => a.number - b.number);
    });
    setModal(null);
  };

  const deleteDca = (dcaId: string) => {
    mutateShow((show) => {
      show.dcas = show.dcas.filter((entry) => entry.id !== dcaId);
      show.cues = show.cues.map((cue) => ({
        ...cue,
        unmuteDcas: cue.unmuteDcas.filter((id) => id !== dcaId),
        muteDcas: cue.muteDcas.filter((id) => id !== dcaId),
      }));
    });
  };

  const saveCamera = (camera: CameraPreset) => {
    mutateShow((show) => {
      const exists = show.cameras.some((entry) => entry.id === camera.id);
      show.cameras = exists
        ? show.cameras.map((entry) => (entry.id === camera.id ? camera : entry))
        : [...show.cameras, camera];
    });
    setModal(null);
  };

  const deleteCamera = (cameraId: string) => {
    mutateShow((show) => {
      show.cameras = show.cameras.filter((entry) => entry.id !== cameraId);
      show.cues = show.cues.map((cue) =>
        cue.cameraPresetId === cameraId ? { ...cue, cameraPresetId: "" } : cue
      );
    });
  };

  const importSlides = (slides: SlideCue[], presentationName: string, playlistName: string) => {
    mutateShow((show) => {
      show.slides = {
        ...show.slides,
        app: "Slides",
        presentationName,
        playlistName,
        slides,
        currentSlide: slides.length ? 1 : 0,
        totalSlides: slides.length,
        currentText: slides[0]?.text ?? "",
        nextText: slides[1]?.text ?? "",
        cleared: false,
        transportLayer: "local",
      };
    });
    setModal(null);
  };

  const handleLoadFile = async (file: File) => {
    try {
      setFileError(null);
      const show = await readShowFile(file);
      onApplyShowFile(show);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Could not read that show file.");
    }
  };

  const promptButtons = [
    { label: "Add First Cue", icon: <ListPlus size={18} />, action: () => setModal({ kind: "broadcast" }) },
    { label: "Add Channel / DCA", icon: <SlidersHorizontal size={18} />, action: () => setModal({ kind: "dca" }) },
    { label: "Add Camera Preset", icon: <Camera size={18} />, action: () => setModal({ kind: "camera" }) },
    { label: "Import Worship Songs / Slides", icon: <Music4 size={18} />, action: () => setModal({ kind: "slides" }) },
    { label: "Configure Devices in Settings", icon: <Settings size={18} />, action: onOpenSettings },
  ];

  return (
    <div className="card" style={{ padding: 20, marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Show Content</h3>
          <p style={{ margin: "4px 0 0", color: "#9CA3AF", fontSize: 13 }}>
            Build the service from scratch. Everything here is saved in a portable
            <span className="mono"> *.ring.json</span> show file.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            onClick={() => downloadShowFile(buildShowFile(state))}
            style={{ height: 36, padding: "0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
          >
            <Download size={14} /> Save Show File
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
            style={{ height: 36, padding: "0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
          >
            <FolderOpen size={14} /> Load Show File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.ring.json,application/json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleLoadFile(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      {fileError && (
        <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.12)", border: "1px solid #EF4444", color: "#FCA5A5", fontSize: 12 }}>
          {fileError}
        </div>
      )}

      {allEmpty && (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            border: "1px dashed #374151",
            background: "#111720",
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Your show is a blank slate</div>
          <div style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 14 }}>
            Add your first cue, channel, camera, or slide deck. Hardware is configured separately in Settings.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {promptButtons.map((prompt) => (
              <button
                key={prompt.label}
                type="button"
                className="btn"
                onClick={prompt.action}
                style={{ minHeight: 56, padding: "10px 12px", display: "flex", alignItems: "center", gap: 9, justifyContent: "flex-start", fontSize: 13 }}
              >
                {prompt.icon}
                {prompt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <ShowSection
          title="Cues"
          count={state.cues.length}
          addLabel="Add Cue"
          onAdd={() => setModal({ kind: "broadcast" })}
        >
          {state.cues.length === 0 ? (
            <div style={{ fontSize: 12, color: "#6B7280" }}>No cues yet. Add your first cue above.</div>
          ) : (
            <div style={{ display: "grid", gap: 7 }}>
              {state.cues.map((cue) => (
                <div key={cue.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#1C222D", border: "1px solid #2A3241" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {cue.index}. {cue.title}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "#6B7280" }}>
                      {cue.actions.length} action(s) • Tier {cue.riskTier}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button type="button" className="btn" title="Edit cue" onClick={() => setModal({ kind: "broadcast", cue })} style={{ width: 30, height: 30, display: "grid", placeItems: "center", padding: 0 }}>
                      <Pencil size={13} />
                    </button>
                    <button type="button" className="btn" title="Delete cue" onClick={() => deleteCue(cue.id)} style={{ width: 30, height: 30, display: "grid", placeItems: "center", padding: 0, borderColor: "#7F1D1D" }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ShowSection>

        <ShowSection
          title="Audio Channels / DCAs"
          count={state.dcas.length}
          addLabel="Add Channel"
          onAdd={() => setModal({ kind: "dca" })}
        >
          {state.dcas.length === 0 ? (
            <div style={{ fontSize: 12, color: "#6B7280" }}>No channels yet. Add a channel or DCA to build your mix layout.</div>
          ) : (
            <div style={{ display: "grid", gap: 7 }}>
              {state.dcas.map((dca) => (
                <div key={dca.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#1C222D", border: "1px solid #2A3241" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>DCA {dca.number}: {dca.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: "#6B7280" }}>{dca.aoipTxChannel || "No source channel"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button type="button" className="btn" title="Edit channel" onClick={() => setModal({ kind: "dca", dca })} style={{ width: 30, height: 30, display: "grid", placeItems: "center", padding: 0 }}>
                      <Pencil size={13} />
                    </button>
                    <button type="button" className="btn" title="Delete channel" onClick={() => deleteDca(dca.id)} style={{ width: 30, height: 30, display: "grid", placeItems: "center", padding: 0, borderColor: "#7F1D1D" }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ShowSection>

        <ShowSection
          title="Camera Presets"
          count={state.cameras.length}
          addLabel="Add Preset"
          onAdd={() => setModal({ kind: "camera" })}
        >
          {state.cameras.length === 0 ? (
            <div style={{ fontSize: 12, color: "#6B7280" }}>No camera presets yet. Add a preset for each shot you need.</div>
          ) : (
            <div style={{ display: "grid", gap: 7 }}>
              {state.cameras.map((camera) => (
                <div key={camera.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#1C222D", border: "1px solid #2A3241" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{camera.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: "#6B7280" }}>{camera.cameraId} • Preset {camera.presetIndex} • {camera.protocol}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button type="button" className="btn" title="Edit preset" onClick={() => setModal({ kind: "camera", camera })} style={{ width: 30, height: 30, display: "grid", placeItems: "center", padding: 0 }}>
                      <Pencil size={13} />
                    </button>
                    <button type="button" className="btn" title="Delete preset" onClick={() => deleteCamera(camera.id)} style={{ width: 30, height: 30, display: "grid", placeItems: "center", padding: 0, borderColor: "#7F1D1D" }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ShowSection>

        <ShowSection
          title="Slide Deck"
          count={slideCount}
          addLabel="Import Slides"
          onAdd={() => setModal({ kind: "slides" })}
        >
          {slideCount === 0 ? (
            <div style={{ fontSize: 12, color: "#6B7280" }}>No slides yet. Paste lyrics or import a deck to get started.</div>
          ) : (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#1C222D", border: "1px solid #2A3241" }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{state.slides.presentationName || "Untitled Deck"}</div>
              <div className="mono" style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>
                {state.slides.playlistName || "No playlist"} • {slideCount} slide(s)
              </div>
              <button type="button" className="btn" onClick={() => setModal({ kind: "slides" })} style={{ marginTop: 8, height: 30, padding: "0 10px", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
                <Upload size={12} /> Replace Deck
              </button>
            </div>
          )}
        </ShowSection>
      </div>

      {modal?.kind === "broadcast" && (
        <CueEditor
          state={state}
          initial={modal.cue}
          onClose={() => setModal(null)}
          onSave={saveCue}
        />
      )}
      {modal?.kind === "dca" && (
        <DcaEditor
          initial={modal.dca}
          onClose={() => setModal(null)}
          onSave={saveDca}
        />
      )}
      {modal?.kind === "camera" && (
        <CameraEditor
          initial={modal.camera}
          onClose={() => setModal(null)}
          onSave={saveCamera}
        />
      )}
      {modal?.kind === "slides" && (
        <SlidesImporter
          state={state}
          onClose={() => setModal(null)}
          onSave={importSlides}
        />
      )}
    </div>
  );
};

const CueEditor: React.FC<{
  state: AppStateSnapshot;
  initial?: ServiceCue;
  onClose: () => void;
  onSave: (cue: ServiceCue) => void;
}> = ({ state, initial, onClose, onSave }) => {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [actions, setActions] = useState((initial?.actions ?? []).join("\n"));
  const [broadcastScene, setBroadcastScene] = useState(initial?.broadcastScene ?? "");
  const [verticalScene, setVerticalScene] = useState(initial?.verticalScene ?? "");
  const [cameraPresetId, setCameraPresetId] = useState(initial?.cameraPresetId ?? "");
  const [slideLabel, setSlideLabel] = useState(initial?.slideLabel ?? "");
  const [recordChapter, setRecordChapter] = useState(initial?.recordChapter ?? "");
  const [riskTier, setRiskTier] = useState(initial?.riskTier ?? 1);
  const [unmuteDcas, setUnmuteDcas] = useState<string[]>(initial?.unmuteDcas ?? []);
  const [muteDcas, setMuteDcas] = useState<string[]>(initial?.muteDcas ?? []);

  const toggleDca = (list: string[], setList: (value: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((value) => value !== id) : [...list, id]);
  };

  return (
    <Modal title={initial ? "Edit Cue" : "Add Cue"} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <Field label="Cue title">
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Welcome & Opening Prayer" />
        </Field>
        <Field label="Actions (one per line)">
          <textarea
            style={{ ...inputStyle, height: 90, padding: 9, resize: "vertical" }}
            value={actions}
            onChange={(e) => setActions(e.target.value)}
            placeholder={"Slides: Welcome\nAudio: Unmute Pastor\nCameras: Wide shot"}
          />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Program scene">
            <input style={inputStyle} value={broadcastScene} onChange={(e) => setBroadcastScene(e.target.value)} placeholder="Program scene name" />
          </Field>
          <Field label="Vertical / social scene">
            <input style={inputStyle} value={verticalScene} onChange={(e) => setVerticalScene(e.target.value)} placeholder="Vertical scene name" />
          </Field>
          <Field label="Camera preset">
            <select style={inputStyle} value={cameraPresetId} onChange={(e) => setCameraPresetId(e.target.value)}>
              <option value="">No camera change</option>
              {state.cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>{camera.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Slide label">
            <input style={inputStyle} value={slideLabel} onChange={(e) => setSlideLabel(e.target.value)} placeholder="Presentation or song name" />
          </Field>
          <Field label="Record chapter">
            <input style={inputStyle} value={recordChapter} onChange={(e) => setRecordChapter(e.target.value)} placeholder="e.g. Sermon" />
          </Field>
          <Field label="Risk tier">
            <select style={inputStyle} value={riskTier} onChange={(e) => setRiskTier(Number(e.target.value))}>
              <option value={1}>1 — Safe</option>
              <option value={2}>2 — High impact</option>
              <option value={3}>3 — On-air destructive</option>
            </select>
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Unmute channels on go</div>
            <div style={{ display: "grid", gap: 4 }}>
              {state.dcas.length === 0 && <div style={{ fontSize: 11, color: "#6B7280" }}>Add channels first.</div>}
              {state.dcas.map((dca) => (
                <label key={dca.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                  <input type="checkbox" checked={unmuteDcas.includes(dca.id)} onChange={() => toggleDca(unmuteDcas, setUnmuteDcas, dca.id)} />
                  DCA {dca.number}: {dca.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Mute channels on go</div>
            <div style={{ display: "grid", gap: 4 }}>
              {state.dcas.length === 0 && <div style={{ fontSize: 11, color: "#6B7280" }}>Add channels first.</div>}
              {state.dcas.map((dca) => (
                <label key={dca.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                  <input type="checkbox" checked={muteDcas.includes(dca.id)} onChange={() => toggleDca(muteDcas, setMuteDcas, dca.id)} />
                  DCA {dca.number}: {dca.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <button type="button" className="btn" onClick={onClose} style={{ height: 38, padding: "0 14px" }}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={!title.trim()}
            onClick={() =>
              onSave({
                id: initial?.id ?? makeId("broadcast"),
                index: initial?.index ?? state.cues.length + 1,
                title: title.trim(),
                actions: actions.split("\n").map((line) => line.trim()).filter(Boolean),
                broadcastScene,
                verticalScene,
                cameraPresetId,
                slideLabel,
                recordChapter,
                riskTier,
                unmuteDcas,
                muteDcas,
              })
            }
            style={primaryButton}
          >
            <FilePlus2 size={14} /> {initial ? "Save Cue" : "Add Cue"}
          </button>
        </div>
      </div>
    </Modal>
  );
};

const DcaEditor: React.FC<{
  initial?: DcaChannel;
  onClose: () => void;
  onSave: (dca: DcaChannel) => void;
}> = ({ initial, onClose, onSave }) => {
  const [number, setNumber] = useState(initial?.number ?? 1);
  const [name, setName] = useState(initial?.name ?? "");
  const [source, setSource] = useState(initial?.aoipTxChannel ?? "");
  const [minDb, setMinDb] = useState(initial?.minDb ?? -6);
  const [maxDb, setMaxDb] = useState(initial?.maxDb ?? 6);
  const [levelDb, setLevelDb] = useState(initial?.levelDb ?? 0);
  const [guardMute, setGuardMute] = useState(initial?.guardMute ?? false);
  const [muted, setMuted] = useState(initial?.muted ?? true);

  return (
    <Modal title={initial ? "Edit Channel / DCA" : "Add Channel / DCA"} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10 }}>
          <Field label="DCA number">
            <input style={inputStyle} type="number" min={1} max={16} value={number} onChange={(e) => setNumber(Number(e.target.value))} />
          </Field>
          <Field label="Name">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pastor, Band, Media" />
          </Field>
        </div>
        <Field label="Source channel / bus">
          <input style={inputStyle} value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Ch 09, Main LR, Matrix 1-2" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Safe min (dB)">
            <input style={inputStyle} type="number" value={minDb} onChange={(e) => setMinDb(Number(e.target.value))} />
          </Field>
          <Field label="Safe max (dB)">
            <input style={inputStyle} type="number" value={maxDb} onChange={(e) => setMaxDb(Number(e.target.value))} />
          </Field>
          <Field label="Start level (dB)">
            <input style={inputStyle} type="number" value={levelDb} onChange={(e) => setLevelDb(Number(e.target.value))} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 12 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={guardMute} onChange={(e) => setGuardMute(e.target.checked)} />
            Lock in Show Mode
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
            Start muted
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <button type="button" className="btn" onClick={onClose} style={{ height: 38, padding: "0 14px" }}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={!name.trim()}
            onClick={() =>
              onSave({
                id: initial?.id ?? makeId("dca"),
                number,
                name: name.trim(),
                muted,
                levelDb,
                minDb,
                maxDb,
                guardMute,
                signalDb: -90,
                signalPresent: false,
                aoipTxChannel: source,
              })
            }
            style={primaryButton}
          >
            <Plus size={14} /> {initial ? "Save Channel" : "Add Channel"}
          </button>
        </div>
      </div>
    </Modal>
  );
};

const CameraEditor: React.FC<{
  initial?: CameraPreset;
  onClose: () => void;
  onSave: (camera: CameraPreset) => void;
}> = ({ initial, onClose, onSave }) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [cameraId, setCameraId] = useState(initial?.cameraId ?? "");
  const [presetIndex, setPresetIndex] = useState(initial?.presetIndex ?? 1);
  const [protocol, setProtocol] = useState(initial?.protocol ?? "Network PTZ");

  return (
    <Modal title={initial ? "Edit Camera Preset" : "Add Camera Preset"} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <Field label="Preset name">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stage Wide, Pulpit Tight" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Camera ID">
            <input style={inputStyle} value={cameraId} onChange={(e) => setCameraId(e.target.value)} placeholder="e.g. cam1" />
          </Field>
          <Field label="Preset index">
            <input style={inputStyle} type="number" min={1} max={99} value={presetIndex} onChange={(e) => setPresetIndex(Number(e.target.value))} />
          </Field>
          <Field label="Control protocol">
            <select style={inputStyle} value={protocol} onChange={(e) => setProtocol(e.target.value)}>
              <option value="Network PTZ">Network PTZ</option>
              <option value="IP Control">IP Control</option>
              <option value="Manual">Manual</option>
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <button type="button" className="btn" onClick={onClose} style={{ height: 38, padding: "0 14px" }}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={!name.trim()}
            onClick={() =>
              onSave({
                id: initial?.id ?? makeId("cam"),
                cameraId: cameraId.trim() || "cam1",
                name: name.trim(),
                presetIndex,
                protocol,
                tally: initial?.tally ?? "idle",
              })
            }
            style={primaryButton}
          >
            <Plus size={14} /> {initial ? "Save Preset" : "Add Preset"}
          </button>
        </div>
      </div>
    </Modal>
  );
};

const SlidesImporter: React.FC<{
  state: AppStateSnapshot;
  onClose: () => void;
  onSave: (slides: SlideCue[], presentationName: string, playlistName: string) => void;
}> = ({ state, onClose, onSave }) => {
  const [presentationName, setPresentationName] = useState(state.slides.presentationName || "New Presentation");
  const [playlistName, setPlaylistName] = useState(state.slides.playlistName || "Sunday Set");
  const [raw, setRaw] = useState("");
  const parsed = parseSlideText(raw);

  return (
    <Modal title="Import Worship Songs / Slides" onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Presentation name">
            <input style={inputStyle} value={presentationName} onChange={(e) => setPresentationName(e.target.value)} />
          </Field>
          <Field label="Playlist / set name">
            <input style={inputStyle} value={playlistName} onChange={(e) => setPlaylistName(e.target.value)} />
          </Field>
        </div>
        <Field label="Slides">
          <textarea
            style={{ ...inputStyle, height: 180, padding: 9, resize: "vertical", fontFamily: "inherit" }}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"Verse 1\nWe lift our eyes to the morning light\n\n---\n\nChorus\nHoly, holy, You are worthy"}
          />
        </Field>
        <div style={{ fontSize: 11, color: "#6B7280" }}>
          Separate slides with <span className="mono">---</span>. The first line becomes the section/title;
          remaining lines become the slide text. One slide per line also works.
          {raw.trim() && <span style={{ color: "#34D399" }}> Detected {parsed.length} slide(s).</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" onClick={onClose} style={{ height: 38, padding: "0 14px" }}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={parsed.length === 0}
            onClick={() => onSave(parsed, presentationName.trim() || "New Presentation", playlistName.trim())}
            style={primaryButton}
          >
            <Upload size={14} /> Import {parsed.length} Slide(s)
          </button>
        </div>
      </div>
    </Modal>
  );
};
