import React, { useState } from "react";
import { Sliders, Activity, Plus, Trash2, CheckCircle, X, Radio } from "lucide-react";

export interface MidiBinding {
  id: string;
  name: string;
  channel: number;
  messageType: "NoteOn" | "ControlChange" | "ProgramChange";
  controlOrNote: number;
  action: string;
}

interface MidiTriggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveBindings?: (bindings: MidiBinding[]) => void;
}

export const MidiTriggerModal: React.FC<MidiTriggerModalProps> = ({
  isOpen,
  onClose,
  onSaveBindings,
}) => {
  const [bindings, setBindings] = useState<MidiBinding[]>([
    {
      id: "bind-1",
      name: "Stream Deck / Pad 1 (Space)",
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
  ]);

  const [isListening, setIsListening] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartLearn = (bindingId: string) => {
    setIsListening(bindingId);
    // Simulate MIDI Learn event capture from USB hardware
    setTimeout(() => {
      setIsListening(null);
    }, 2500);
  };

  const handleAddBinding = () => {
    const newBind: MidiBinding = {
      id: `bind-${Date.now()}`,
      name: "New MIDI Trigger",
      channel: 1,
      messageType: "NoteOn",
      controlOrNote: 64,
      action: "cue_next",
    };
    setBindings([...bindings, newBind]);
  };

  const handleRemove = (id: string) => {
    setBindings(bindings.filter((b) => b.id !== id));
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
          width: "820px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid #374151",
          background: "#111827",
        }}
      >
        {/* Header */}
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
            onClick={onClose}
            className="btn"
            style={{ padding: "6px 8px", background: "transparent", border: "none" }}
          >
            <X size={20} color="#9CA3AF" />
          </button>
        </div>

        {/* Device Status Banner */}
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
            <span>Virtual MIDI Core Ingest Active • Listening on Port 1</span>
          </div>
          <button
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

        {/* Binding List */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {bindings.map((b) => (
            <div
              key={b.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderRadius: 8,
                backgroundColor: "#1F2937",
                border: "1px solid #374151",
              }}
            >
              <div style={{ flex: 1, marginRight: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#F9FAFB" }}>{b.name}</span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 4,
                      backgroundColor: "#111827",
                      color: "#38BDF8",
                    }}
                  >
                    Ch {b.channel} • {b.messageType} #{b.controlOrNote}
                  </span>
                </div>
                <div className="mono" style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>
                  Trigger Action: <span style={{ color: "#34D399" }}>{b.action}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => handleStartLearn(b.id)}
                  className="btn"
                  style={{
                    height: 34,
                    padding: "0 12px",
                    fontSize: 12,
                    backgroundColor: isListening === b.id ? "#854D0E" : "#1C2433",
                    borderColor: isListening === b.id ? "#CA8A04" : "#374151",
                    color: isListening === b.id ? "#FEF08A" : "#F3F4F6",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Activity size={14} />
                  {isListening === b.id ? "Press Pad/Fader..." : "MIDI Learn"}
                </button>
                <button
                  onClick={() => handleRemove(b.id)}
                  className="btn"
                  style={{
                    height: 34,
                    width: 34,
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
            </div>
          ))}
        </div>

        {/* Footer */}
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
          <button onClick={onClose} className="btn" style={{ height: 38, padding: "0 20px" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
