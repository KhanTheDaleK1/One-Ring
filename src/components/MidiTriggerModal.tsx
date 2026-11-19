import React, { useEffect, useState } from "react";
import { Sliders, Activity, Plus, Trash2, X, Radio } from "lucide-react";

export interface MidiBinding {
  id: string;
  name: string;
  channel: number; // 1..=16 UI display (0..=15 on wire)
  messageType: "NoteOn" | "ControlChange" | "ProgramChange";
  controlOrNote: number;
  action: string;
}

interface MidiTriggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveBindings?: (bindings: MidiBinding[]) => void;
}

const MIDI_STORAGE_KEY = "onering_midi_bindings_v1";

const DEFAULT_BINDINGS: MidiBinding[] = [
  {
    id: "bind-1",
    name: "Stream Deck / Pad 1 (Next Cue)",
    channel: 1,
    messageType: "NoteOn",
    controlOrNote: 60,
    action: "cue_next",
  },
  {
    id: "bind-2",
    name: "Foot Pedal Mute Toggle",
    channel: 1,
    messageType: "ControlChange",
    controlOrNote: 64,
    action: "toggle_pastor_mute",
  },
  {
    id: "bind-3",
    name: "Motorized Fader 1 (Pastor DCA)",
    channel: 1,
    messageType: "ControlChange",
    controlOrNote: 1,
    action: "set_dca_1_level",
  },
  {
    id: "bind-4",
    name: "Pad 2 (Next Slide)",
    channel: 1,
    messageType: "NoteOn",
    controlOrNote: 62,
    action: "slide_next",
  },
];

const AVAILABLE_ACTIONS = [
  "cue_next",
  "cue_undo",
  "slide_next",
  "slide_prev",
  "slide_clear",
  "toggle_pastor_mute",
  "set_dca_1_level",
  "cam_preset_1",
  "cam_preset_2",
];

export const MidiTriggerModal: React.FC<MidiTriggerModalProps> = ({
  isOpen,
  onClose,
  onSaveBindings,
}) => {
  const [bindings, setBindings] = useState<MidiBinding[]>(() => {
    try {
      const saved = localStorage.getItem(MIDI_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return DEFAULT_BINDINGS;
  });

  const [isListening, setIsListening] = useState<string | null>(null);
  const [midiStatus, setMidiStatus] = useState<string>("Checking Web MIDI devices...");

  useEffect(() => {
    if (!isOpen) return;
    let midiAccess: any = null;
    const nav = navigator as any;
    if (!nav || typeof nav.requestMIDIAccess !== "function") {
      setMidiStatus("Web MIDI API unavailable in this WebView — edit mappings manually below.");
      return;
    }

    const onMidiMessage = (event: any) => {
      const data: Uint8Array | undefined = event?.data;
      if (!data || data.length < 2) return;
      const status = data[0];
      const kind = status & 0xf0;
      const ch1Based = (status & 0x0f) + 1;
      const d1 = data[1] & 0x7f;
      const d2 = data.length > 2 ? data[2] & 0x7f : 0;

      let messageType: MidiBinding["messageType"] | null = null;
      if (kind === 0x90 && d2 > 0) messageType = "NoteOn";
      else if (kind === 0xb0) messageType = "ControlChange";
      else if (kind === 0xc0) messageType = "ProgramChange";
      if (!messageType) return;

      setIsListening((listeningId) => {
        if (!listeningId) return null;
        setBindings((prev) =>
          prev.map((b) =>
            b.id === listeningId
              ? { ...b, channel: ch1Based, messageType: messageType!, controlOrNote: d1 }
              : b
          )
        );
        setMidiStatus(`Learned Ch ${ch1Based} • ${messageType} #${d1}`);
        return null;
      });
    };

    nav
      .requestMIDIAccess()
      .then((access: any) => {
        midiAccess = access;
        const inputs = Array.from(access.inputs.values());
        setMidiStatus(
          inputs.length > 0
            ? `Web MIDI Active • ${inputs.length} input port(s) connected`
            : "Web MIDI Ready • No USB MIDI devices detected"
        );
        for (const input of inputs as any[]) {
          input.addEventListener("midimessage", onMidiMessage);
        }
      })
      .catch(() => {
        setMidiStatus("MIDI permission denied or unavailable — edit mappings manually.");
      });

    return () => {
      if (midiAccess) {
        for (const input of Array.from(midiAccess.inputs.values()) as any[]) {
          input.removeEventListener("midimessage", onMidiMessage);
        }
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddBinding = () => {
    const newBind: MidiBinding = {
      id: `bind-${Date.now()}`,
      name: "New MIDI Trigger",
      channel: 1,
      messageType: "NoteOn",
      controlOrNote: 64,
      action: "cue_next",
    };
    setBindings((prev) => [...prev, newBind]);
  };

  const handlePatch = (id: string, patchObj: Partial<MidiBinding>) => {
    setBindings((prev) => prev.map((b) => (b.id === id ? { ...b, ...patchObj } : b)));
  };

  const handleRemove = (id: string) => {
    setBindings((prev) => prev.filter((b) => b.id !== id));
  };

  const handleDone = () => {
    try {
      localStorage.setItem(MIDI_STORAGE_KEY, JSON.stringify(bindings));
    } catch {}
    onSaveBindings?.(bindings);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="card"
        style={{
          width: "860px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid #374151",
          background: "#111827",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid #1F2937",
            backgroundColor: "#182234",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Sliders size={22} color="#38BDF8" />
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#F9FAFB" }}>
                MIDI Hardware & Control Surface Mapping
              </h2>
              <span className="mono" style={{ fontSize: 12, color: "#9CA3AF" }}>
                USB MIDI Controllers, Stream Deck Companion, Behringer X-Touch, Foot Pedals
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn"
            style={{ padding: "6px 8px", background: "transparent", border: "none" }}
          >
            <X size={20} color="#9CA3AF" />
          </button>
        </div>

        <div
          style={{
            padding: "12px 20px",
            backgroundColor: "#131C2E",
            borderBottom: "1px solid #1F2937",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#D1D5DB" }}>
            <Radio size={16} color="#34D399" />
            <span>{midiStatus}</span>
          </div>
          <button
            type="button"
            onClick={handleAddBinding}
            className="btn"
            style={{
              padding: "6px 14px",
              height: 34,
              backgroundColor: "#0284C7",
              borderColor: "#0369A1",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Plus size={14} /> Add Mapping
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {bindings.map((b) => (
            <div
              key={b.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 64px 128px 68px 1.1fr auto auto",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 8,
                backgroundColor: "#1F2937",
                border: "1px solid #374151",
              }}
            >
              <input
                type="text"
                value={b.name}
                onChange={(e) => handlePatch(b.id, { name: e.target.value })}
                style={{
                  height: 32,
                  background: "#111827",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  padding: "0 8px",
                  color: "#F9FAFB",
                  fontSize: 12,
                }}
              />
              <input
                type="number"
                min={1}
                max={16}
                title="MIDI Channel (1-16)"
                value={b.channel}
                onChange={(e) => handlePatch(b.id, { channel: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })}
                className="mono"
                style={{
                  height: 32,
                  background: "#111827",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  padding: "0 6px",
                  color: "#38BDF8",
                  fontSize: 12,
                }}
              />
              <select
                value={b.messageType}
                onChange={(e) => handlePatch(b.id, { messageType: e.target.value as MidiBinding["messageType"] })}
                className="mono"
                style={{
                  height: 32,
                  background: "#111827",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  padding: "0 6px",
                  color: "#E5E7EB",
                  fontSize: 11,
                }}
              >
                <option value="NoteOn">NoteOn</option>
                <option value="ControlChange">ControlChange</option>
                <option value="ProgramChange">ProgramChange</option>
              </select>
              <input
                type="number"
                min={0}
                max={127}
                title="Note or CC Number (0-127)"
                value={b.controlOrNote}
                onChange={(e) => handlePatch(b.id, { controlOrNote: Math.max(0, Math.min(127, Number(e.target.value) || 0)) })}
                className="mono"
                style={{
                  height: 32,
                  background: "#111827",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  padding: "0 6px",
                  color: "#38BDF8",
                  fontSize: 12,
                }}
              />
              <select
                value={b.action}
                onChange={(e) => handlePatch(b.id, { action: e.target.value })}
                className="mono"
                style={{
                  height: 32,
                  background: "#111827",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  padding: "0 6px",
                  color: "#34D399",
                  fontSize: 11,
                }}
              >
                {AVAILABLE_ACTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setIsListening((cur) => (cur === b.id ? null : b.id))}
                className="btn"
                style={{
                  height: 32,
                  padding: "0 10px",
                  fontSize: 11,
                  backgroundColor: isListening === b.id ? "#854D0E" : "#1C2433",
                  borderColor: isListening === b.id ? "#CA8A04" : "#374151",
                  color: isListening === b.id ? "#FEF08A" : "#F3F4F6",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Activity size={13} />
                {isListening === b.id ? "Listening..." : "Learn"}
              </button>
              <button
                type="button"
                onClick={() => handleRemove(b.id)}
                className="btn"
                style={{
                  height: 32,
                  width: 32,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#27171A",
                  borderColor: "#7F1D1D",
                  color: "#FCA5A5",
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid #1F2937",
            backgroundColor: "#182234",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button type="button" onClick={handleDone} className="btn" style={{ height: 38, padding: "0 20px", backgroundColor: "#0284C7", borderColor: "#0369A1" }}>
            Save & Done
          </button>
        </div>
      </div>
    </div>
  );
};
