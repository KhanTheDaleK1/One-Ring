import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Sliders,
  Volume2,
  VolumeX,
  Headphones,
  Zap,
  Activity,
  RotateCcw,
  Radio,
  Palette,
  Layers,
  Grid,
  Check,
  Terminal,
} from "lucide-react";

export interface X32FullConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendX32Command?: (address: string, value: number | string) => void;
}

type ConsoleBankId = "ch1_16" | "ch17_32" | "aux_fx" | "bus1_16" | "mtx1_6" | "dca1_8";
type DetailTabId = "eq_dyn" | "bus_sends" | "routing";
type RoutingDomainId = "AES50-A" | "AES50-B" | "Local 1-32" | "Card" | "P16 Ultranet";

type X32ColorKey = "OFF" | "RD" | "GN" | "YE" | "BL" | "MG" | "CY" | "WH";

interface X32ColorDef {
  key: X32ColorKey;
  code: number;
  label: string;
  bg: string;
  border: string;
  text: string;
}

const X32_COLORS: X32ColorDef[] = [
  { key: "OFF", code: 0, label: "Dark", bg: "#1E2533", border: "#334155", text: "#E2E8F0" },
  { key: "RD", code: 1, label: "Red", bg: "#991B1B", border: "#EF4444", text: "#FFFFFF" },
  { key: "GN", code: 2, label: "Green", bg: "#065F46", border: "#10B981", text: "#FFFFFF" },
  { key: "YE", code: 3, label: "Yellow", bg: "#854D0E", border: "#FACC15", text: "#FEF08A" },
  { key: "BL", code: 4, label: "Blue", bg: "#1E40AF", border: "#3B82F6", text: "#FFFFFF" },
  { key: "MG", code: 5, label: "Magenta", bg: "#86198F", border: "#E879F9", text: "#FFFFFF" },
  { key: "CY", code: 6, label: "Cyan", bg: "#155E75", border: "#06B6D4", text: "#ECFEFF" },
  { key: "WH", code: 7, label: "White", bg: "#CBD5E1", border: "#F8FAFC", text: "#0F172A" },
];

const COLOR_MAP: Record<X32ColorKey, X32ColorDef> = Object.fromEntries(
  X32_COLORS.map((c) => [c.key, c])
) as Record<X32ColorKey, X32ColorDef>;

const BANK_TABS: Array<{ id: ConsoleBankId; label: string }> = [
  { id: "ch1_16", label: "Ch 1-16" },
  { id: "ch17_32", label: "Ch 17-32" },
  { id: "aux_fx", label: "Aux 1-8 / FX" },
  { id: "bus1_16", label: "Bus 1-16" },
  { id: "mtx1_6", label: "Matrix 1-6" },
  { id: "dca1_8", label: "DCA 1-8" },
];

interface EqBandState {
  id: "low" | "lomid" | "himid" | "high";
  bandIndex: number;
  label: string;
  color: string;
  type: "LSHV" | "PEQ" | "HSHV";
  freq: number;
  gain: number;
  q: number;
}

interface GateState {
  on: boolean;
  threshold: number;
  range: number;
}

interface CompState {
  on: boolean;
  threshold: number;
  ratio: number;
  attack: number;
}

interface BusSendState {
  busNumber: number;
  label: string;
  on: boolean;
  levelDb: number;
  tap: "PRE" | "POST" | "SUB";
}

interface X32ChannelStripState {
  id: string;
  bank: ConsoleBankId;
  shortLabel: string;
  oscPrefix: string;
  headampIndex: number | null;
  name: string;
  color: X32ColorKey;
  phantom48v: boolean;
  preampGainDb: number;
  hpfOn: boolean;
  hpfFreqHz: number;
  solo: boolean;
  mute: boolean;
  faderDb: number;
  pan: number;
  meterLevel: number;
  eqOn: boolean;
  eqBands: [EqBandState, EqBandState, EqBandState, EqBandState];
  gate: GateState;
  comp: CompState;
  busSends: BusSendState[];
}

const BUS_LABELS = [
  "Wedge 1",
  "Wedge 2",
  "Wedge 3",
  "Wedge 4",
  "IEM Drum",
  "IEM Bass",
  "IEM Keys",
  "IEM Vox",
  "Bcast L",
  "Bcast R",
  "Lobby",
  "Cry Rm",
  "FX Verb",
  "FX Dly",
  "Sub Aux",
  "Rec Stem",
];

function createDefaultEq(isSpeech = false): [EqBandState, EqBandState, EqBandState, EqBandState] {
  return [
    {
      id: "low",
      bandIndex: 1,
      label: "Low",
      color: "#F97316",
      type: "LSHV",
      freq: 105,
      gain: isSpeech ? -2.5 : 0,
      q: 1.0,
    },
    {
      id: "lomid",
      bandIndex: 2,
      label: "Lo-Mid",
      color: "#FACC15",
      type: "PEQ",
      freq: 360,
      gain: isSpeech ? -3.0 : 0,
      q: 2.0,
    },
    {
      id: "himid",
      bandIndex: 3,
      label: "Hi-Mid",
      color: "#10B981",
      type: "PEQ",
      freq: 2800,
      gain: isSpeech ? 2.5 : 0,
      q: 1.6,
    },
    {
      id: "high",
      bandIndex: 4,
      label: "High",
      color: "#3B82F6",
      type: "HSHV",
      freq: 8500,
      gain: isSpeech ? 1.5 : 0,
      q: 0.9,
    },
  ];
}

function createBusSends(defaultActive = false): BusSendState[] {
  return BUS_LABELS.map((label, idx) => ({
    busNumber: idx + 1,
    label,
    on: defaultActive ? idx === 8 || idx === 9 : idx < 2 || idx === 8 || idx === 9,
    levelDb: idx === 8 || idx === 9 ? 0 : idx < 2 ? -6 : -30,
    tap: idx >= 12 ? "POST" : "PRE",
  }));
}

function buildInitialChannels(): X32ChannelStripState[] {
  const ch1Presets: Array<{ name: string; color: X32ColorKey; phantom: boolean; gain: number; hpf: boolean; hpfHz: number; fader: number; mute: boolean; speech?: boolean }> = [
    { name: "Pastor Lav", color: "YE", phantom: false, gain: 18, hpf: true, hpfHz: 110, fader: 0, mute: false, speech: true },
    { name: "Pulpit Mic", color: "YE", phantom: true, gain: 26, hpf: true, hpfHz: 120, fader: -2.5, mute: true, speech: true },
    { name: "Host HH 1", color: "CY", phantom: false, gain: 16, hpf: true, hpfHz: 100, fader: -3.0, mute: true, speech: true },
    { name: "Lead Vox 1", color: "BL", phantom: false, gain: 22, hpf: true, hpfHz: 105, fader: -1.0, mute: false },
    { name: "Lead Vox 2", color: "BL", phantom: false, gain: 21, hpf: true, hpfHz: 105, fader: -2.0, mute: false },
    { name: "BGV Alto", color: "CY", phantom: false, gain: 20, hpf: true, hpfHz: 120, fader: -5.5, mute: false },
    { name: "BGV Tenor", color: "CY", phantom: false, gain: 19, hpf: true, hpfHz: 120, fader: -6.0, mute: false },
    { name: "Acoustic", color: "GN", phantom: true, gain: 15, hpf: true, hpfHz: 95, fader: -4.0, mute: false },
    { name: "Keys L", color: "MG", phantom: false, gain: 8, hpf: true, hpfHz: 60, fader: -3.5, mute: false },
    { name: "Keys R", color: "MG", phantom: false, gain: 8, hpf: true, hpfHz: 60, fader: -3.5, mute: false },
    { name: "Elec Gtr", color: "GN", phantom: false, gain: 14, hpf: true, hpfHz: 90, fader: -7.0, mute: false },
    { name: "Bass DI", color: "GN", phantom: true, gain: 12, hpf: true, hpfHz: 38, fader: -3.0, mute: false },
    { name: "Kick In", color: "RD", phantom: false, gain: 24, hpf: true, hpfHz: 42, fader: -2.0, mute: false },
    { name: "Snare Top", color: "RD", phantom: false, gain: 26, hpf: true, hpfHz: 85, fader: -4.0, mute: false },
    { name: "OH L", color: "RD", phantom: true, gain: 28, hpf: true, hpfHz: 180, fader: -8.0, mute: false },
    { name: "OH R", color: "RD", phantom: true, gain: 28, hpf: true, hpfHz: 180, fader: -8.0, mute: false },
  ];

  const channels: X32ChannelStripState[] = [];

  ch1Presets.forEach((p, idx) => {
    const n = idx + 1;
    const pad = String(n).padStart(2, "0");
    channels.push({
      id: `ch-${pad}`,
      bank: "ch1_16",
      shortLabel: `Ch ${pad}`,
      oscPrefix: `/ch/${pad}`,
      headampIndex: idx,
      name: p.name,
      color: p.color,
      phantom48v: p.phantom,
      preampGainDb: p.gain,
      hpfOn: p.hpf,
      hpfFreqHz: p.hpfHz,
      solo: false,
      mute: p.mute,
      faderDb: p.fader,
      pan: n === 9 || n === 15 ? -60 : n === 10 || n === 16 ? 60 : 0,
      meterLevel: p.mute ? -90 : -14 - (idx % 5) * 4,
      eqOn: true,
      eqBands: createDefaultEq(Boolean(p.speech)),
      gate: { on: idx >= 12 || Boolean(p.speech), threshold: idx >= 12 ? -36 : -48, range: idx >= 12 ? 32 : 18 },
      comp: { on: true, threshold: p.speech ? -22 : -18, ratio: p.speech ? 3.5 : 3.0, attack: p.speech ? 12 : 18 },
      busSends: createBusSends(false),
    });
  });

  const ch17Names = [
    "Tom Hi", "Tom Flr", "Cajon", "Choir L", "Choir R", "Violin", "Cello", "Track L",
    "Track R", "Click", "Guide", "ProPres L", "ProPres R", "Zoom Rx", "Stage Spare", "Talkback",
  ];
  ch17Names.forEach((name, idx) => {
    const n = idx + 17;
    const pad = String(n).padStart(2, "0");
    channels.push({
      id: `ch-${pad}`,
      bank: "ch17_32",
      shortLabel: `Ch ${pad}`,
      oscPrefix: `/ch/${pad}`,
      headampIndex: n - 1,
      name,
      color: idx < 3 ? "RD" : idx < 7 ? "BL" : idx < 11 ? "CY" : "MG",
      phantom48v: idx === 3 || idx === 4 || idx === 5,
      preampGainDb: idx < 7 ? 20 : 4,
      hpfOn: idx < 7,
      hpfFreqHz: idx < 7 ? 100 : 45,
      solo: false,
      mute: idx === 9 || idx === 10 || idx === 14,
      faderDb: idx === 11 || idx === 12 ? -2.0 : -8.0,
      pan: name.endsWith(" L") ? -100 : name.endsWith(" R") ? 100 : 0,
      meterLevel: idx === 14 ? -90 : -22,
      eqOn: true,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -50, range: 20 },
      comp: { on: idx < 7, threshold: -20, ratio: 2.5, attack: 15 },
      busSends: createBusSends(false),
    });
  });

  const auxFxNames = [
    "Aux 1 Media", "Aux 2 Lobby", "Aux 3 iPad L", "Aux 4 iPad R",
    "Aux 5 Video L", "Aux 6 Video R", "USB L", "USB R",
    "FX1 Hall L", "FX1 Hall R", "FX2 Plate L", "FX2 Plate R",
    "FX3 Delay L", "FX3 Delay R", "FX4 Chorus L", "FX4 Chorus R",
  ];
  auxFxNames.forEach((name, idx) => {
    const isFx = idx >= 8;
    const num = isFx ? idx - 7 : idx + 1;
    const pad = String(num).padStart(2, "0");
    channels.push({
      id: isFx ? `fx-${pad}` : `aux-${pad}`,
      bank: "aux_fx",
      shortLabel: isFx ? `FX ${pad}` : `Aux ${num}`,
      oscPrefix: isFx ? `/fxrtn/${pad}` : `/auxin/${pad}`,
      headampIndex: null,
      name,
      color: isFx ? "MG" : "CY",
      phantom48v: false,
      preampGainDb: 0,
      hpfOn: isFx,
      hpfFreqHz: isFx ? 140 : 40,
      solo: false,
      mute: false,
      faderDb: isFx ? -10 : -4,
      pan: name.endsWith(" L") ? -100 : name.endsWith(" R") ? 100 : 0,
      meterLevel: -26,
      eqOn: true,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -55, range: 15 },
      comp: { on: false, threshold: -18, ratio: 2.0, attack: 20 },
      busSends: createBusSends(false),
    });
  });

  BUS_LABELS.forEach((label, idx) => {
    const n = idx + 1;
    const pad = String(n).padStart(2, "0");
    channels.push({
      id: `bus-${pad}`,
      bank: "bus1_16",
      shortLabel: `Bus ${pad}`,
      oscPrefix: `/bus/${pad}`,
      headampIndex: null,
      name: label,
      color: idx >= 8 && idx <= 9 ? "GN" : idx >= 12 && idx <= 13 ? "MG" : "BL",
      phantom48v: false,
      preampGainDb: 0,
      hpfOn: idx < 8,
      hpfFreqHz: 75,
      solo: false,
      mute: false,
      faderDb: 0,
      pan: idx === 8 ? -100 : idx === 9 ? 100 : 0,
      meterLevel: -16,
      eqOn: true,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -60, range: 12 },
      comp: { on: idx === 8 || idx === 9, threshold: -14, ratio: 2.5, attack: 15 },
      busSends: createBusSends(true),
    });
  });

  const mtxNames = ["Main PA L", "Main PA R", "Livestream L", "Livestream R", "Foyer Mono", "Overflow"];
  mtxNames.forEach((name, idx) => {
    const pad = String(idx + 1).padStart(2, "0");
    channels.push({
      id: `mtx-${pad}`,
      bank: "mtx1_6",
      shortLabel: `Mtx ${pad}`,
      oscPrefix: `/mtx/${pad}`,
      headampIndex: null,
      name,
      color: idx < 2 ? "WH" : idx < 4 ? "RD" : "CY",
      phantom48v: false,
      preampGainDb: 0,
      hpfOn: idx >= 4,
      hpfFreqHz: 80,
      solo: false,
      mute: false,
      faderDb: 0,
      pan: 0,
      meterLevel: -14,
      eqOn: true,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -60, range: 10 },
      comp: { on: true, threshold: -10, ratio: 4.0, attack: 5 },
      busSends: createBusSends(false),
    });
  });

  const dcaNames = [
    "Pastor & Host",
    "Worship Vox",
    "Band Drums",
    "Guitars & Bass",
    "Keys & Tracks",
    "Choir & Strings",
    "Media / Slides",
    "Room Ambience",
  ];
  dcaNames.forEach((name, idx) => {
    const n = idx + 1;
    channels.push({
      id: `dca-${n}`,
      bank: "dca1_8",
      shortLabel: `DCA ${n}`,
      oscPrefix: `/dca/${n}`,
      headampIndex: null,
      name,
      color: n === 1 ? "YE" : n <= 5 ? "BL" : n === 7 ? "MG" : "GN",
      phantom48v: false,
      preampGainDb: 0,
      hpfOn: false,
      hpfFreqHz: 80,
      solo: false,
      mute: n === 8,
      faderDb: 0,
      pan: 0,
      meterLevel: n === 8 ? -90 : -15,
      eqOn: false,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -50, range: 15 },
      comp: { on: false, threshold: -18, ratio: 2.0, attack: 15 },
      busSends: createBusSends(false),
    });
  });

  return channels;
}

const ROUTING_CONFIG: Record<
  RoutingDomainId,
  {
    subtitle: string;
    oscBase: string;
    destinations: string[];
    sources: string[];
    initialMap: Record<number, number>;
  }
> = {
  "Local 1-32": {
    subtitle: "Console Input Blocks (Ch 1-32) <- Local XLR / Stageboxes",
    oscBase: "/config/routing/IN",
    destinations: ["Ch 1-8", "Ch 9-16", "Ch 17-24", "Ch 25-32"],
    sources: ["Local 1-8", "Local 9-16", "AES50-A 1-8", "AES50-A 9-16", "AES50-B 1-8", "Card 1-8"],
    initialMap: { 0: 0, 1: 1, 2: 2, 3: 5 },
  },
  "AES50-A": {
    subtitle: "Stagebox S32 / DL32 Trunk (Port A, 48ch @ 48kHz)",
    oscBase: "/config/routing/AES50A",
    destinations: ["A Out 1-8", "A Out 9-16", "A Out 17-24", "A Out 25-32", "A Out 33-40", "A Out 41-48"],
    sources: ["Out 1-8", "Out 9-16", "Local 1-8", "Local 9-16", "P16 1-8", "P16 9-16", "Card 1-8"],
    initialMap: { 0: 0, 1: 1, 2: 4, 3: 5, 4: 2, 5: 6 },
  },
  "AES50-B": {
    subtitle: "Broadcast / FOH Link Trunk (Port B, 48ch @ 48kHz)",
    oscBase: "/config/routing/AES50B",
    destinations: ["B Out 1-8", "B Out 9-16", "B Out 17-24", "B Out 25-32", "B Out 33-40", "B Out 41-48"],
    sources: ["Local 1-8", "Local 9-16", "AES50-A 1-8", "AES50-A 9-16", "Out 1-8", "Out 9-16"],
    initialMap: { 0: 2, 1: 3, 2: 0, 3: 1, 4: 4, 5: 5 },
  },
  Card: {
    subtitle: "X-Dante / X-USB 32x32 Expansion Card Output Routing",
    oscBase: "/config/routing/CARD",
    destinations: ["Card 1-8", "Card 9-16", "Card 17-24", "Card 25-32"],
    sources: ["Local 1-8", "Local 9-16", "AES50-A 1-8", "AES50-A 9-16", "Out 1-8", "Out 9-16", "P16 1-8"],
    initialMap: { 0: 0, 1: 1, 2: 2, 3: 4 },
  },
  "P16 Ultranet": {
    subtitle: "Ultranet P16-M Personal Monitor Bus Assignment (Ch 1-16)",
    oscBase: "/outputs/p16",
    destinations: [
      "P16 01-02",
      "P16 03-04",
      "P16 05-06",
      "P16 07-08",
      "P16 09-10",
      "P16 11-12",
      "P16 13-14",
      "P16 15-16",
    ],
    sources: ["DirOut Ch 1-2", "DirOut Ch 4-5", "DirOut Ch 8-9", "DirOut Ch 12-13", "Bus 1-2", "Bus 3-4", "Main L/R", "Talkback"],
    initialMap: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 },
  },
};

function formatDb(db: number): string {
  if (db <= -89.5) return "-∞ dB";
  const sign = db > 0 ? "+" : "";
  return `${sign}${db.toFixed(1)} dB`;
}

function faderDbToFraction(db: number): number {
  if (db <= -90) return 0;
  if (db >= 10) return 1;
  // Piecewise taper matching hardware mixer feel (-90..0 takes 75%, 0..+10 takes 25%)
  if (db >= 0) return 0.75 + (db / 10) * 0.25;
  if (db >= -10) return 0.5 + ((db + 10) / 10) * 0.25;
  if (db >= -30) return 0.25 + ((db + 30) / 20) * 0.25;
  return ((db + 90) / 60) * 0.25;
}

function fractionToFaderDb(frac: number): number {
  const f = Math.max(0, Math.min(1, frac));
  let db: number;
  if (f >= 0.75) db = ((f - 0.75) / 0.25) * 10;
  else if (f >= 0.5) db = -10 + ((f - 0.5) / 0.25) * 10;
  else if (f >= 0.25) db = -30 + ((f - 0.25) / 0.25) * 20;
  else db = -90 + (f / 0.25) * 60;
  return Math.round(db * 2) / 2;
}

// Logarithmic frequency mapping (20 Hz .. 20000 Hz)
function freqToNorm(freq: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.max(0, Math.min(1, (Math.log10(Math.max(20, Math.min(20000, freq))) - minLog) / (maxLog - minLog)));
}

function normToFreq(norm: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const val = Math.pow(10, minLog + Math.max(0, Math.min(1, norm)) * (maxLog - minLog));
  return Math.round(val);
}

function biquadDbAtFreq(band: EqBandState, freq: number): number {
  if (Math.abs(band.gain) < 0.05) return 0;
  const fs = 48000;
  const f0 = Math.max(20, Math.min(20000, band.freq));
  const w0 = (2 * Math.PI * f0) / fs;
  const w = (2 * Math.PI * freq) / fs;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const q = Math.max(0.3, Math.min(10, band.q));
  const A = Math.pow(10, band.gain / 40);
  const alpha = sinw0 / (2 * q);

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  if (band.type === "PEQ") {
    b0 = 1 + alpha * A;
    b1 = -2 * cosw0;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cosw0;
    a2 = 1 - alpha / A;
  } else if (band.type === "LSHV") {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 - (A - 1) * cosw0 + beta);
    b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
    b2 = A * (A + 1 - (A - 1) * cosw0 - beta);
    a0 = A + 1 + (A - 1) * cosw0 + beta;
    a1 = -2 * (A - 1 + (A + 1) * cosw0);
    a2 = A + 1 + (A - 1) * cosw0 - beta;
  } else {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cosw0 + beta);
    b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
    b2 = A * (A + 1 + (A - 1) * cosw0 - beta);
    a0 = A + 1 - (A - 1) * cosw0 + beta;
    a1 = 2 * (A - 1 - (A + 1) * cosw0);
    a2 = A + 1 - (A - 1) * cosw0 - beta;
  }

  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);

  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -(b1 * sin1 + b2 * sin2);
  const denRe = a0 + a1 * cos1 + a2 * cos2;
  const denIm = -(a1 * sin1 + a2 * sin2);

  const magSq = (numRe * numRe + numIm * numIm) / Math.max(1e-12, denRe * denRe + denIm * denIm);
  return 10 * Math.log10(Math.max(1e-8, magSq));
}

function hpfDbAtFreq(hpfFreq: number, freq: number): number {
  const r = freq / Math.max(20, hpfFreq);
  const r4 = r * r * r * r;
  return 10 * Math.log10(Math.max(1e-8, r4 / (1 + r4)));
}

interface VerticalFaderProps {
  valueDb: number;
  onChange: (db: number) => void;
  accentColor?: string;
  height?: number;
  muted?: boolean;
}

const VerticalFader: React.FC<VerticalFaderProps> = ({
  valueDb,
  onChange,
  accentColor = "#3B82F6",
  height = 152,
  muted = false,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);

  const updateFromClientY = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const frac = 1 - (clientY - rect.top) / Math.max(1, rect.height);
      onChange(fractionToFaderDb(frac));
    },
    [onChange]
  );

  const frac = faderDbToFraction(valueDb);
  const unityPct = faderDbToFraction(0) * 100;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        userSelect: "none",
      }}
    >
      <div
        style={{
          height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontSize: 8,
          color: "#64748B",
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          textAlign: "right",
          lineHeight: 1,
          padding: "2px 0",
        }}
      >
        <span>+10</span>
        <span style={{ color: "#CBD5E1", fontWeight: 700 }}>0</span>
        <span>-10</span>
        <span>-30</span>
        <span>-∞</span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={-90}
        aria-valuemax={10}
        aria-valuenow={valueDb}
        title="Drag fader (-90 to +10 dB). Double-click for 0.0 dB unity."
        onDoubleClick={() => onChange(0)}
        onWheel={(e) => {
          e.preventDefault();
          const step = e.deltaY < 0 ? 1 : -1;
          onChange(Math.max(-90, Math.min(10, Math.round((valueDb + step) * 2) / 2)));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromClientY(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1 || e.pointerType === "touch") {
            updateFromClientY(e.clientY);
          }
        }}
        style={{
          position: "relative",
          width: 28,
          height,
          background: "#080B10",
          border: "1px solid #283344",
          borderRadius: 6,
          cursor: "ns-resize",
          touchAction: "none",
        }}
      >
        {/* Center rail */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 8,
            bottom: 8,
            width: 3,
            transform: "translateX(-50%)",
            background: "#1E2533",
            borderRadius: 2,
          }}
        />
        {/* 0 dB unity tick */}
        <div
          style={{
            position: "absolute",
            left: 3,
            right: 3,
            bottom: `${unityPct}%`,
            height: 1,
            background: "#F59E0B88",
            pointerEvents: "none",
          }}
        />
        {/* Active level fill */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 8,
            width: 3,
            height: `calc(${frac * 100}% - 8px)`,
            minHeight: 0,
            transform: "translateX(-50%)",
            background: muted ? "#64748B" : accentColor,
            borderRadius: 2,
            pointerEvents: "none",
          }}
        />
        {/* Fader cap */}
        <div
          style={{
            position: "absolute",
            left: 3,
            right: 3,
            bottom: `calc(${frac * 86 + 7}% - 9px)`,
            height: 18,
            background: "linear-gradient(180deg, #475569 0%, #1E293B 48%, #0F172A 100%)",
            border: `1px solid ${muted ? "#64748B" : "#94A3B8"}`,
            borderRadius: 3,
            boxShadow: "0 2px 6px rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ width: 14, height: 2, background: muted ? "#94A3B8" : "#F8FAFC", borderRadius: 1 }} />
        </div>
      </div>
    </div>
  );
};

const FX_EFFECT_TYPES = [
  "Hall Reverb",
  "Plate Reverb",
  "Stereo Delay",
  "Dual 31-Band GEQ",
  "De-Esser",
  "Wave Designer",
  "Combinator",
] as const;

type FxEffectType = (typeof FX_EFFECT_TYPES)[number];

interface FxSlotState {
  slot: number;
  type: FxEffectType;
  bypassed: boolean;
  params: [number, number, number, number];
}

function buildInitialFxSlots(): FxSlotState[] {
  return Array.from({ length: 8 }, (_, idx) => ({
    slot: idx + 1,
    type: FX_EFFECT_TYPES[idx % FX_EFFECT_TYPES.length],
    bypassed: false,
    params: [0.5, 0.5, 0.5, 0.5],
  }));
}

function faderDbToNormalized(db: number): number {
  const clamped = Math.max(-90, Math.min(10, db));
  if (clamped <= -90) return 0;
  if (clamped <= -60) return ((clamped + 90) / 30) * 0.0625;
  if (clamped <= -30) return 0.0625 + ((clamped + 60) / 30) * 0.1875;
  if (clamped <= -10) return 0.25 + ((clamped + 30) / 20) * 0.25;
  return 0.5 + ((clamped + 10) / 20) * 0.5;
}

function normalizedToFaderDb(val: number): number {
  const clamped = Math.max(0, Math.min(1, val));
  if (clamped <= 0) return -90;
  if (clamped <= 0.0625) return -90 + (clamped / 0.0625) * 30;
  if (clamped <= 0.25) return -60 + ((clamped - 0.0625) / 0.1875) * 30;
  if (clamped <= 0.5) return -30 + ((clamped - 0.25) / 0.25) * 20;
  return -10 + ((clamped - 0.5) / 0.5) * 20;
}

export const X32FullConsoleModal: React.FC<X32FullConsoleModalProps> = ({
  isOpen,
  onClose,
  onSendX32Command,
}) => {
  const [channels, setChannels] = useState<X32ChannelStripState[]>(() => buildInitialChannels());
  const [activeBank, setActiveBank] = useState<ConsoleBankId>("ch1_16");
  const [selectedId, setSelectedId] = useState<string>("ch-01");
  const [detailTab, setDetailTab] = useState<DetailTabId>("eq_dyn");
  const [routingDomain, setRoutingDomain] = useState<RoutingDomainId>("AES50-A");
  const [routingSelections, setRoutingSelections] = useState<Record<RoutingDomainId, Record<number, number>>>(() => ({
    "Local 1-32": { ...ROUTING_CONFIG["Local 1-32"].initialMap },
    "AES50-A": { ...ROUTING_CONFIG["AES50-A"].initialMap },
    "AES50-B": { ...ROUTING_CONFIG["AES50-B"].initialMap },
    Card: { ...ROUTING_CONFIG.Card.initialMap },
    "P16 Ultranet": { ...ROUTING_CONFIG["P16 Ultranet"].initialMap },
  }));
  const [colorPickerForId, setColorPickerForId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameVal, setEditingNameVal] = useState<string>("");
  const [lastOsc, setLastOsc] = useState<string>("Connected to X32 OSC :10023 (Ready)");
  const [draggingBandIdx, setDraggingBandIdx] = useState<number | null>(null);
  const [sendsOnFader, setSendsOnFader] = useState<boolean>(false);
  const [sofTarget, setSofTarget] = useState<string>("bus-01");
  const [sendLevels, setSendLevels] = useState<Record<string, Record<string, number>>>({});
  const [muteGroups, setMuteGroups] = useState<boolean[]>([false, false, false, false, false, false]);
  const [rtaEnabled, setRtaEnabled] = useState<boolean>(true);
  const [rtaBars, setRtaBars] = useState<number[]>(() => Array.from({ length: 100 }, (_, i) => 0.15 + 0.25 * Math.sin(i * 0.18)));
  const [channelLinks, setChannelLinks] = useState<Record<string, boolean>>({});
  const [channelDelays, setChannelDelays] = useState<Record<string, number>>({});

  const [showFxRack, setShowFxRack] = useState<boolean>(false);
  const [fxSlots, setFxSlots] = useState<FxSlotState[]>(() => buildInitialFxSlots());
  const [cueIndex, setCueIndex] = useState<number>(1);
  const [snippetIndex, setSnippetIndex] = useState<number>(1);
  const [dcaSpillFilter, setDcaSpillFilter] = useState<'all' | 1 | 2 | 3 | 4>('all');
  const [automixGroups, setAutomixGroups] = useState<Record<string, 'Off' | 'X' | 'Y'>>({});
  const [xliveState, setXliveState] = useState<'STOP' | 'PLAY' | 'REC'>('STOP');
  const [talkbackA, setTalkbackA] = useState<boolean>(false);
  const [talkbackB, setTalkbackB] = useState<boolean>(false);
  const [oscMode, setOscMode] = useState<'off' | '1kHz' | 'pink'>('off');
  const [clockSource, setClockSource] = useState<'48kHz Internal' | 'AES50' | 'Card'>('48kHz Internal');
  const scnFileInputRef = useRef<HTMLInputElement | null>(null);
  const eqSvgRef = useRef<SVGSVGElement | null>(null);

  const emitOsc = useCallback(
    (address: string, value: number | string) => {
      setLastOsc(`${address}  ${typeof value === "string" ? `"${value}"` : value}`);
      onSendX32Command?.(address, value);
    },
    [onSendX32Command]
  );

  const handleImportScn = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const nameUpdates: Record<string, string> = {};
        const faderUpdates: Record<string, number> = {};
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          const nameMatch = line.match(/^\/ch\/(\d{2})\/config\/name\s+"?([^"\r\n]+)"?$/);
          if (nameMatch) {
            nameUpdates[`ch-${nameMatch[1]}`] = nameMatch[2].trim();
            continue;
          }
          const faderMatch = line.match(/^\/ch\/(\d{2})\/mix\/fader\s+([+-]?\d*\.?\d+)$/);
          if (faderMatch) {
            const rawVal = parseFloat(faderMatch[2]);
            if (!Number.isNaN(rawVal)) {
              const db = rawVal >= 0 && rawVal <= 1 ? normalizedToFaderDb(rawVal) : Math.max(-90, Math.min(10, rawVal));
              faderUpdates[`ch-${faderMatch[1]}`] = Math.round(db * 10) / 10;
            }
          }
        }
        const updateCount = Object.keys(nameUpdates).length + Object.keys(faderUpdates).length;
        if (updateCount > 0) {
          setChannels((prev) =>
            prev.map((ch) => {
              const nextName = nameUpdates[ch.id];
              const nextFader = faderUpdates[ch.id];
              if (nextName === undefined && nextFader === undefined) return ch;
              return {
                ...ch,
                name: nextName !== undefined ? nextName : ch.name,
                faderDb: nextFader !== undefined ? nextFader : ch.faderDb,
              };
            })
          );
          setLastOsc(`Imported .scn (${updateCount} channel parameters)`);
        } else {
          setLastOsc("Imported .scn (no /ch/NN parameters found)");
        }
      } finally {
        e.target.value = "";
      }
    },
    []
  );

  const handleExportScn = useCallback(() => {
    const ch1to32 = channels.filter((ch) => ch.oscPrefix.startsWith("/ch/"));
    const lines: string[] = ['#2.1# "OneRing_X32_Scene" "" %000000000 1'];
    for (const ch of ch1to32) {
      const safeName = ch.name.replace(/"/g, "'");
      lines.push(`${ch.oscPrefix}/config/name "${safeName}"`);
      lines.push(`${ch.oscPrefix}/mix/fader ${faderDbToNormalized(ch.faderDb).toFixed(4)}`);
    }
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "x32-scene.scn";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setLastOsc(`Exported .scn (${ch1to32.length} channels)`);
  }, [channels]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setColorPickerForId(null);
        setEditingNameId(null);
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !rtaEnabled) return;
    let phase = 0;
    const timer = window.setInterval(() => {
      phase += 0.25;
      setRtaBars((prev) =>
        prev.map((v, i) => {
          const target =
            0.12 +
            0.28 * Math.exp(-Math.pow((i - 28) / 18, 2)) +
            0.22 * Math.exp(-Math.pow((i - 62) / 14, 2)) +
            0.14 * Math.abs(Math.sin(phase + i * 0.23)) +
            0.08 * Math.random();
          return Math.max(0.04, Math.min(0.92, v * 0.55 + target * 0.45));
        })
      );
    }, 110);
    return () => window.clearInterval(timer);
  }, [isOpen, rtaEnabled]);

  const bankChannels = useMemo(() => {
    const base = channels.filter((c) => c.bank === activeBank);
    if (dcaSpillFilter === 'all') return base;
    return base.filter((_, idx) => (idx % 4) + 1 === dcaSpillFilter);
  }, [channels, activeBank, dcaSpillFilter]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedId) || bankChannels[0] || channels[0],
    [channels, selectedId, bankChannels]
  );

  const patchChannel = useCallback((id: string, updater: (prev: X32ChannelStripState) => X32ChannelStripState) => {
    setChannels((prev) => prev.map((ch) => (ch.id === id ? updater(ch) : ch)));
  }, []);

  const soloCount = useMemo(() => channels.filter((c) => c.solo).length, [channels]);

  const clearAllSolos = () => {
    setChannels((prev) => prev.map((ch) => ({ ...ch, solo: false })));
    emitOsc("/-action/clearsolo", 1);
  };

  // EQ SVG coordinate math
  const svgW = 640;
  const svgH = 216;
  const padL = 36;
  const padR = 14;
  const padT = 14;
  const padB = 24;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const dbToY = (db: number) => {
    const clamped = Math.max(-18, Math.min(18, db));
    return padT + ((18 - clamped) / 36) * plotH;
  };
  const yToDb = (y: number) => {
    const frac = (y - padT) / plotH;
    return Math.max(-15, Math.min(15, Math.round((18 - frac * 36) * 2) / 2));
  };

  const eqCurveData = useMemo(() => {
    if (!selectedChannel) return { totalPath: "", bandPaths: [] as string[], hpfPath: "" };
    const samples = 150;
    const totalPts: string[] = [];
    const bandPts: string[][] = [[], [], [], []];
    const hpfPts: string[] = [];

    for (let i = 0; i <= samples; i++) {
      const norm = i / samples;
      const freq = normToFreq(norm);
      const x = padL + norm * plotW;

      let totalDb = 0;
      selectedChannel.eqBands.forEach((band, bIdx) => {
        const db = selectedChannel.eqOn ? biquadDbAtFreq(band, freq) : 0;
        totalDb += db;
        bandPts[bIdx].push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${dbToY(db).toFixed(1)}`);
      });

      const hpfDb = selectedChannel.hpfOn ? hpfDbAtFreq(selectedChannel.hpfFreqHz, freq) : 0;
      if (selectedChannel.hpfOn) {
        totalDb += hpfDb;
        hpfPts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${dbToY(hpfDb).toFixed(1)}`);
      }
      totalPts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${dbToY(totalDb).toFixed(1)}`);
    }

    return {
      totalPath: totalPts.join(" "),
      bandPaths: bandPts.map((pts) => pts.join(" ")),
      hpfPath: hpfPts.join(" "),
    };
  }, [selectedChannel, plotW, plotH]);

  const handleEqSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingBandIdx === null || !selectedChannel || !eqSvgRef.current) return;
    const rect = eqSvgRef.current.getBoundingClientRect();
    const scaleX = svgW / Math.max(1, rect.width);
    const scaleY = svgH / Math.max(1, rect.height);
    const svgX = (e.clientX - rect.left) * scaleX;
    const svgY = (e.clientY - rect.top) * scaleY;
    const normX = Math.max(0, Math.min(1, (svgX - padL) / plotW));
    const nextFreq = normToFreq(normX);
    const nextGain = yToDb(svgY);

    patchChannel(selectedChannel.id, (prev) => {
      const nextBands = [...prev.eqBands] as [EqBandState, EqBandState, EqBandState, EqBandState];
      nextBands[draggingBandIdx] = { ...nextBands[draggingBandIdx], freq: nextFreq, gain: nextGain };
      return { ...prev, eqBands: nextBands };
    });
    const bandNum = draggingBandIdx + 1;
    emitOsc(`${selectedChannel.oscPrefix}/eq/${bandNum}/f`, nextFreq);
    emitOsc(`${selectedChannel.oscPrefix}/eq/${bandNum}/g`, nextGain);
  };

  if (!isOpen) return null;

  const selectedColor = COLOR_MAP[selectedChannel.color];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(8, 11, 16, 0.88)",
        backdropFilter: "blur(6px)",
        zIndex: 10020,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "97vw",
          maxWidth: 1520,
          height: "93vh",
          background: "#0B0F17",
          border: "1px solid #283344",
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "#F3F4F6",
          boxShadow: "0 24px 70px rgba(0,0,0,0.78)",
        }}
      >
        {/* Top Console Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            background: "#12161F",
            borderBottom: "1px solid #1E2533",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #60A5FA",
              }}
            >
              <Sliders size={18} color="#FFFFFF" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 15, letterSpacing: "0.01em" }}>
                  Behringer X32-Edit / M32-Edit Full Console
                </strong>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 6,
                    background: "rgba(16, 185, 129, 0.14)",
                    border: "1px solid #10B981",
                    color: "#34D399",
                  }}
                >
                  OSC UDP :10023
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#94A3B8",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                }}
              >
                <Terminal size={11} color="#60A5FA" />
                <span>{lastOsc}</span>
              </div>
            </div>
          </div>

          {/* Bank Selector Tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {BANK_TABS.map((b) => {
              const active = activeBank === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setActiveBank(b.id);
                    const firstInBank = channels.find((c) => c.bank === b.id);
                    if (firstInBank) setSelectedId(firstInBank.id);
                  }}
                  style={{
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 7,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    background: active ? "#2563EB" : "#161B24",
                    border: `1px solid ${active ? "#60A5FA" : "#283344"}`,
                    color: active ? "#FFFFFF" : "#94A3B8",
                  }}
                >
                  {b.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* FX Racks 1-8 Toggle */}
            <button
              type="button"
              onClick={() => setShowFxRack((prev) => !prev)}
              style={{
                height: 32,
                padding: "0 10px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                background: showFxRack ? "#7C3AED" : "#161B24",
                border: `1px solid ${showFxRack ? "#A78BFA" : "#283344"}`,
                color: showFxRack ? "#FFFFFF" : "#94A3B8",
              }}
              title="Toggle 8-Slot FX Rack view"
            >
              FX Racks 1–8
            </button>

            {/* Import / Export .scn */}
            <input
              ref={scnFileInputRef}
              type="file"
              accept=".scn,.txt"
              onChange={handleImportScn}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => scnFileInputRef.current?.click()}
              style={{
                height: 32,
                padding: "0 10px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                background: "#161B24",
                border: "1px solid #283344",
                color: "#CBD5E1",
              }}
              title="Import Behringer .scn scene file"
            >
              Import .scn
            </button>
            <button
              type="button"
              onClick={handleExportScn}
              style={{
                height: 32,
                padding: "0 10px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                background: "#161B24",
                border: "1px solid #283344",
                color: "#CBD5E1",
              }}
              title="Export current 32 channels as Behringer .scn"
            >
              Export .scn
            </button>

            {/* Sends on Fader Toggle & Bus/Mtx Selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                onClick={() => setSendsOnFader((prev) => !prev)}
                style={{
                  height: 32,
                  padding: "0 10px",
                  borderRadius: 7,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: sendsOnFader ? "#0284C7" : "#161B24",
                  border: `1px solid ${sendsOnFader ? "#38BDF8" : "#283344"}`,
                  color: sendsOnFader ? "#FFFFFF" : "#94A3B8",
                }}
                title="Toggle Sends on Fader mode"
              >
                Sends on Fader
              </button>
              <select
                aria-label="Sends on Fader Target"
                value={sofTarget}
                onChange={(e) => setSofTarget(e.target.value)}
                style={{
                  height: 32,
                  padding: "0 8px",
                  borderRadius: 7,
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#161B24",
                  border: `1px solid ${sendsOnFader ? "#38BDF8" : "#283344"}`,
                  color: "#E2E8F0",
                  cursor: "pointer",
                }}
              >
                {Array.from({ length: 16 }, (_, idx) => {
                  const num = String(idx + 1).padStart(2, "0");
                  return (
                    <option key={`bus-${num}`} value={`bus-${num}`}>
                      Bus {idx + 1}
                    </option>
                  );
                })}
                {Array.from({ length: 6 }, (_, idx) => {
                  const num = String(idx + 1).padStart(2, "0");
                  return (
                    <option key={`mtx-${num}`} value={`mtx-${num}`}>
                      Mtx {idx + 1}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Mute Groups (MG 1-6) */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "2px 4px",
                borderRadius: 7,
                background: "#0B0E15",
                border: "1px solid #1E2533",
              }}
            >
              {muteGroups.map((active, idx) => (
                <button
                  key={`mg-${idx + 1}`}
                  type="button"
                  onClick={() => {
                    const next = !active;
                    setMuteGroups((prev) => prev.map((m, i) => (i === idx ? next : m)));
                    emitOsc(`/config/mute/${idx + 1}`, next ? 1 : 0);
                  }}
                  style={{
                    height: 26,
                    padding: "0 7px",
                    borderRadius: 5,
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: "pointer",
                    background: active ? "#991B1B" : "#161B24",
                    border: `1px solid ${active ? "#EF4444" : "#283344"}`,
                    color: active ? "#FCA5A5" : "#94A3B8",
                  }}
                  title={`Toggle Mute Group ${idx + 1}`}
                >
                  MG {idx + 1}
                </button>
              ))}
            </div>

            {/* A4: Cue / Snippet Recall */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#0B0F17', border: '1px solid #1E2533', borderRadius: 7, padding: '2px 6px' }}>
              <button
                type="button"
                onClick={() => {
                  const next = Math.max(0, cueIndex - 1);
                  setCueIndex(next);
                  emitOsc('/-action/goscene', next);
                }}
                style={{ height: 26, padding: '0 7px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#161B24', border: '1px solid #283344', color: '#CBD5E1' }}
              >
                Prev Cue
              </button>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', minWidth: 34, textAlign: 'center' }}>#{cueIndex}</span>
              <button
                type="button"
                onClick={() => {
                  const next = cueIndex + 1;
                  setCueIndex(next);
                  emitOsc('/-action/goscene', next);
                }}
                style={{ height: 26, padding: '0 7px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#161B24', border: '1px solid #283344', color: '#CBD5E1' }}
              >
                Next Cue
              </button>
              <button
                type="button"
                onClick={() => {
                  emitOsc('/-action/gosnippet', snippetIndex);
                  setSnippetIndex((s) => (s >= 16 ? 1 : s + 1));
                }}
                style={{ height: 26, padding: '0 8px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#1E293B', border: '1px solid #38BDF8', color: '#7DD3FC' }}
              >
                Recall Snippet #{snippetIndex}
              </button>
            </div>

            {/* A5: X-LIVE Recorder + Talkback / Oscillator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#0B0F17', border: '1px solid #1E2533', borderRadius: 7, padding: '2px 6px' }}>
              {(['REC', 'PLAY', 'STOP'] as const).map((mode) => {
                const active = xliveState === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setXliveState(mode);
                      emitOsc('/-stat/urec/state', mode === 'REC' ? 2 : mode === 'PLAY' ? 1 : 0);
                    }}
                    style={{
                      height: 26,
                      padding: '0 7px',
                      borderRadius: 5,
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                      background: active ? (mode === 'REC' ? '#991B1B' : mode === 'PLAY' ? '#065F46' : '#334155') : '#161B24',
                      border: `1px solid ${active ? (mode === 'REC' ? '#EF4444' : mode === 'PLAY' ? '#10B981' : '#64748B') : '#283344'}`,
                      color: active ? '#FFFFFF' : '#94A3B8',
                    }}
                  >
                    {mode}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  const next = !talkbackA;
                  setTalkbackA(next);
                  emitOsc('/config/talk/A/on', next ? 1 : 0);
                }}
                style={{
                  height: 26,
                  padding: '0 7px',
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: talkbackA ? '#1D4ED8' : '#161B24',
                  border: `1px solid ${talkbackA ? '#60A5FA' : '#283344'}`,
                  color: talkbackA ? '#FFFFFF' : '#94A3B8',
                }}
              >
                TB A
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !talkbackB;
                  setTalkbackB(next);
                  emitOsc('/config/talk/B/on', next ? 1 : 0);
                }}
                style={{
                  height: 26,
                  padding: '0 7px',
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: talkbackB ? '#1D4ED8' : '#161B24',
                  border: `1px solid ${talkbackB ? '#60A5FA' : '#283344'}`,
                  color: talkbackB ? '#FFFFFF' : '#94A3B8',
                }}
              >
                TB B
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = oscMode === 'off' ? '1kHz' : oscMode === '1kHz' ? 'pink' : 'off';
                  setOscMode(next);
                  emitOsc('/config/osc/on', next === 'off' ? 0 : 1);
                }}
                style={{
                  height: 26,
                  padding: '0 7px',
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: oscMode !== 'off' ? '#7C2D12' : '#161B24',
                  border: `1px solid ${oscMode !== 'off' ? '#F97316' : '#283344'}`,
                  color: oscMode !== 'off' ? '#FED7AA' : '#94A3B8',
                }}
              >
                Osc: {oscMode === 'off' ? 'Off' : oscMode === '1kHz' ? '1kHz' : 'Pink'}
              </button>
            </div>

            <button
              type="button"
              onClick={clearAllSolos}
              disabled={soloCount === 0}
              style={{
                height: 32,
                padding: "0 10px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 700,
                cursor: soloCount > 0 ? "pointer" : "not-allowed",
                background: soloCount > 0 ? "#D97706" : "#161B24",
                border: `1px solid ${soloCount > 0 ? "#FBBF24" : "#283344"}`,
                color: soloCount > 0 ? "#FFFFFF" : "#64748B",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Headphones size={13} />
              Clear Solo ({soloCount})
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close X32 Console"
              style={{
                width: 34,
                height: 32,
                borderRadius: 7,
                background: "#161B24",
                border: "1px solid #283344",
                color: "#CBD5E1",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Main Console Workspace: FX Rack View OR Channel Bank + Detail */}
        {showFxRack ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: 16,
              background: "#080B10",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 12,
              alignContent: "start",
            }}
          >
            {fxSlots.map((fx) => (
              <div
                key={`fx-slot-${fx.slot}`}
                style={{
                  background: "#10151F",
                  border: `1px solid ${fx.bypassed ? "#334155" : "#3B82F6"}`,
                  borderRadius: 10,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  opacity: fx.bypassed ? 0.65 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: "#E2E8F0",
                      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    }}
                  >
                    FX {fx.slot}
                  </span>
                  <select
                    aria-label={`FX ${fx.slot} Effect Type`}
                    value={fx.type}
                    onChange={(e) => {
                      const nextType = e.target.value as FxEffectType;
                      setFxSlots((prev) =>
                        prev.map((s) => (s.slot === fx.slot ? { ...s, type: nextType } : s))
                      );
                      emitOsc(`/fx/${fx.slot}/type`, nextType);
                    }}
                    style={{
                      flex: 1,
                      height: 28,
                      padding: "0 8px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#161B24",
                      border: "1px solid #283344",
                      color: "#E2E8F0",
                      cursor: "pointer",
                    }}
                  >
                    {FX_EFFECT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const nextBypass = !fx.bypassed;
                      setFxSlots((prev) =>
                        prev.map((s) => (s.slot === fx.slot ? { ...s, bypassed: nextBypass } : s))
                      );
                      emitOsc(`/fx/${fx.slot}/bypass`, nextBypass ? 1 : 0);
                    }}
                    style={{
                      height: 28,
                      padding: "0 10px",
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: "pointer",
                      background: fx.bypassed ? "#991B1B" : "#065F46",
                      border: `1px solid ${fx.bypassed ? "#EF4444" : "#10B981"}`,
                      color: "#FFFFFF",
                    }}
                  >
                    {fx.bypassed ? "BYPASSED" : "ACTIVE"}
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {fx.params.map((val, pIdx) => {
                    const parNum = String(pIdx + 1).padStart(2, "0");
                    return (
                      <div key={`fx-${fx.slot}-par-${parNum}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            width: 48,
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#94A3B8",
                            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                          }}
                        >
                          Par {parNum}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={val}
                          onChange={(e) => {
                            const nextVal = parseFloat(e.target.value);
                            setFxSlots((prev) =>
                              prev.map((s) => {
                                if (s.slot !== fx.slot) return s;
                                const nextParams: [number, number, number, number] = [...s.params] as [
                                  number,
                                  number,
                                  number,
                                  number,
                                ];
                                nextParams[pIdx] = nextVal;
                                return { ...s, params: nextParams };
                              })
                            );
                            emitOsc(`/fx/${fx.slot}/par/${parNum}`, nextVal);
                          }}
                          style={{ flex: 1, accentColor: "#8B5CF6", cursor: "pointer" }}
                        />
                        <span
                          style={{
                            width: 34,
                            textAlign: "right",
                            fontSize: 10,
                            color: "#CBD5E1",
                            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                          }}
                        >
                          {val.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* A5: DCA Spill Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#0B0F17', borderBottom: '1px solid #1E2533' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>DCA Spill:</span>
            {(['all', 1, 2, 3, 4] as const).map((pill) => {
              const active = dcaSpillFilter === pill;
              return (
                <button
                  key={String(pill)}
                  type="button"
                  onClick={() => setDcaSpillFilter(pill)}
                  style={{
                    height: 22,
                    padding: '0 9px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: active ? '#1E3A8A' : '#161B24',
                    border: `1px solid ${active ? '#3B82F6' : '#283344'}`,
                    color: active ? '#DBEAFE' : '#94A3B8',
                  }}
                >
                  {pill === 'all' ? 'All' : `DCA ${pill}`}
                </button>
              );
            })}
          </div>
          {/* Bank Channel Strips */}
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "10px 12px",
              background: "#080B10",
              borderBottom: "1px solid #1E2533",
              overflowX: "auto",
              flexShrink: 0,
            }}
          >
            {bankChannels.map((ch) => {
              const isSelected = ch.id === selectedChannel.id;
              const colDef = COLOR_MAP[ch.color];
              const meterPct = ch.mute ? 0 : Math.max(4, Math.min(100, ((ch.meterLevel + 60) / 60) * 100));

              return (
                <div
                  key={ch.id}
                  onClick={() => setSelectedId(ch.id)}
                  style={{
                    minWidth: 86,
                    flex: "1 0 86px",
                    maxWidth: 120,
                    background: isSelected ? "#151D2B" : "#10151F",
                    border: `1px solid ${isSelected ? "#3B82F6" : "#1E2533"}`,
                    borderRadius: 8,
                    padding: "7px 6px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    position: "relative",
                    boxShadow: isSelected ? "0 0 0 1px rgba(59, 130, 246, 0.4)" : "none",
                    cursor: "pointer",
                  }}
                >
                  {/* Top Strip ID & Select */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: isSelected ? "#60A5FA" : "#94A3B8",
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                      }}
                    >
                      {ch.shortLabel}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(ch.id);
                      }}
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: isSelected ? "#2563EB" : "#1E2533",
                        border: `1px solid ${isSelected ? "#60A5FA" : "#334155"}`,
                        color: isSelected ? "#FFFFFF" : "#64748B",
                        cursor: "pointer",
                      }}
                    >
                      SEL
                    </button>
                  </div>

                  {/* Preamp Gain & +48V Phantom */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: "#0A0E15",
                      border: "1px solid #1E2533",
                      borderRadius: 5,
                      padding: "4px 5px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3 }}>
                      <button
                        type="button"
                        title="Toggle +48V Phantom Power"
                        onClick={() => {
                          const next = !ch.phantom48v;
                          patchChannel(ch.id, (prev) => ({ ...prev, phantom48v: next }));
                          const addr =
                            ch.headampIndex !== null
                              ? `/headamp/${String(ch.headampIndex).padStart(3, "0")}/phantom`
                              : `${ch.oscPrefix}/preamp/phantom`;
                          emitOsc(addr, next ? 1 : 0);
                        }}
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: "2px 4px",
                          borderRadius: 4,
                          cursor: "pointer",
                          background: ch.phantom48v ? "#991B1B" : "#161B24",
                          border: `1px solid ${ch.phantom48v ? "#EF4444" : "#283344"}`,
                          color: ch.phantom48v ? "#FCA5A5" : "#64748B",
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                        }}
                      >
                        <Zap size={8} />
                        48V
                      </button>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: "#CBD5E1",
                          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        }}
                      >
                        {ch.preampGainDb >= 0 ? `+${ch.preampGainDb}` : ch.preampGainDb}dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-12}
                      max={60}
                      step={1}
                      aria-label={`${ch.shortLabel} Preamp Gain`}
                      value={ch.preampGainDb}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        patchChannel(ch.id, (prev) => ({ ...prev, preampGainDb: val }));
                        const addr =
                          ch.headampIndex !== null
                            ? `/headamp/${String(ch.headampIndex).padStart(3, "0")}/gain`
                            : `${ch.oscPrefix}/preamp/trim`;
                        emitOsc(addr, val);
                      }}
                      style={{ width: "100%", height: 12, accentColor: "#F59E0B", cursor: "pointer" }}
                    />
                  </div>

                  {/* HPF Toggle & Frequency */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: "#0A0E15",
                      border: "1px solid #1E2533",
                      borderRadius: 5,
                      padding: "4px 5px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !ch.hpfOn;
                          patchChannel(ch.id, (prev) => ({ ...prev, hpfOn: next }));
                          emitOsc(`${ch.oscPrefix}/preamp/hpon`, next ? 1 : 0);
                        }}
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: "2px 5px",
                          borderRadius: 4,
                          cursor: "pointer",
                          background: ch.hpfOn ? "#065F46" : "#161B24",
                          border: `1px solid ${ch.hpfOn ? "#10B981" : "#283344"}`,
                          color: ch.hpfOn ? "#34D399" : "#64748B",
                        }}
                      >
                        HPF
                      </button>
                      <span
                        style={{
                          fontSize: 9.5,
                          color: ch.hpfOn ? "#34D399" : "#64748B",
                          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        }}
                      >
                        {ch.hpfFreqHz}Hz
                      </span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={400}
                      step={5}
                      aria-label={`${ch.shortLabel} HPF Frequency`}
                      value={ch.hpfFreqHz}
                      onChange={(e) => {
                        const hz = Number(e.target.value);
                        patchChannel(ch.id, (prev) => ({ ...prev, hpfFreqHz: hz, hpfOn: true }));
                        emitOsc(`${ch.oscPrefix}/preamp/hpf`, hz);
                      }}
                      style={{ width: "100%", height: 12, accentColor: "#10B981", cursor: "pointer" }}
                    />
                  </div>

                  {/* Solo & Mute */}
                  <div onClick={(e) => e.stopPropagation()} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !ch.solo;
                        patchChannel(ch.id, (prev) => ({ ...prev, solo: next }));
                        emitOsc(`${ch.oscPrefix}/mix/solo`, next ? 1 : 0);
                      }}
                      style={{
                        height: 24,
                        borderRadius: 5,
                        fontSize: 10,
                        fontWeight: 800,
                        cursor: "pointer",
                        background: ch.solo ? "#D97706" : "#161B24",
                        border: `1px solid ${ch.solo ? "#FBBF24" : "#283344"}`,
                        color: ch.solo ? "#FFFFFF" : "#94A3B8",
                      }}
                    >
                      SOLO
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !ch.mute;
                        patchChannel(ch.id, (prev) => ({ ...prev, mute: next }));
                        // X32 mix/on is 1 for unmuted, 0 for muted
                        emitOsc(`${ch.oscPrefix}/mix/on`, next ? 0 : 1);
                      }}
                      style={{
                        height: 24,
                        borderRadius: 5,
                        fontSize: 10,
                        fontWeight: 800,
                        cursor: "pointer",
                        background: ch.mute ? "#991B1B" : "#065F46",
                        border: `1px solid ${ch.mute ? "#EF4444" : "#10B981"}`,
                        color: ch.mute ? "#FECACA" : "#D1FAE5",
                      }}
                    >
                      {ch.mute ? "MUTE" : "ON"}
                    </button>
                  </div>

                  {/* Fader + Meter */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "4px 2px",
                      background: "#0B0E15",
                      border: "1px solid #1E2533",
                      borderRadius: 6,
                    }}
                  >
                    <VerticalFader
                      valueDb={sendsOnFader ? (sendLevels[ch.id]?.[sofTarget] ?? -70) : ch.faderDb}
                      muted={ch.mute}
                      accentColor={sendsOnFader ? "#38BDF8" : colDef.border}
                      height={128}
                      onChange={(db) => {
                        if (sendsOnFader) {
                          setSendLevels((prev) => ({
                            ...prev,
                            [ch.id]: {
                              ...(prev[ch.id] ?? {}),
                              [sofTarget]: db,
                            },
                          }));
                          const targetCode = sofTarget.startsWith("mtx-")
                            ? `mtx/${sofTarget.slice(4)}`
                            : sofTarget.slice(4);
                          emitOsc(`${ch.oscPrefix}/mix/${targetCode}/level`, db);
                        } else {
                          patchChannel(ch.id, (prev) => ({ ...prev, faderDb: db }));
                          emitOsc(`${ch.oscPrefix}/mix/fader`, db);
                        }
                      }}
                    />
                    {/* Signal Meter */}
                    <div
                      title={`Pre/Post Signal: ${ch.mute ? "-∞" : ch.meterLevel} dBFS`}
                      style={{
                        width: 6,
                        height: 124,
                        background: "#06080C",
                        borderRadius: 3,
                        border: "1px solid #1E2533",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-end",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: `${meterPct}%`,
                          background: "linear-gradient(180deg, #EF4444 0%, #FACC15 28%, #10B981 65%, #059669 100%)",
                          transition: "height 0.15s ease",
                        }}
                      />
                    </div>
                  </div>

                  {/* Fader numeric readout */}
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      color: sendsOnFader ? "#38BDF8" : ch.mute ? "#F87171" : "#E2E8F0",
                      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    }}
                  >
                    {formatDb(sendsOnFader ? (sendLevels[ch.id]?.[sofTarget] ?? -70) : ch.faderDb)}
                  </div>

                  {/* Scribble Strip Name & Color Picker */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ position: "relative" }}
                  >
                    <div
                      style={{
                        background: colDef.bg,
                        border: `1px solid ${colDef.border}`,
                        borderRadius: 5,
                        padding: "4px 5px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 3,
                      }}
                    >
                      {editingNameId === ch.id ? (
                        <input
                          type="text"
                          autoFocus
                          maxLength={12}
                          value={editingNameVal}
                          onChange={(e) => setEditingNameVal(e.target.value)}
                          onBlur={() => {
                            const trimmed = editingNameVal.trim();
                            if (trimmed) {
                              patchChannel(ch.id, (prev) => ({ ...prev, name: trimmed }));
                              emitOsc(`${ch.oscPrefix}/config/name`, trimmed);
                            }
                            setEditingNameId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const trimmed = editingNameVal.trim();
                              if (trimmed) {
                                patchChannel(ch.id, (prev) => ({ ...prev, name: trimmed }));
                                emitOsc(`${ch.oscPrefix}/config/name`, trimmed);
                              }
                              setEditingNameId(null);
                            } else if (e.key === "Escape") {
                              setEditingNameId(null);
                            }
                          }}
                          style={{
                            width: "100%",
                            background: "#0B0D10",
                            color: "#FFFFFF",
                            border: "1px solid #60A5FA",
                            borderRadius: 3,
                            fontSize: 10,
                            padding: "1px 3px",
                          }}
                        />
                      ) : (
                        <>
                          <span
                            title="Double-click to rename scribble strip"
                            onDoubleClick={() => {
                              setEditingNameId(ch.id);
                              setEditingNameVal(ch.name);
                            }}
                            style={{
                              fontSize: 10.5,
                              fontWeight: 800,
                              color: colDef.text,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              flex: 1,
                            }}
                          >
                            {ch.name}
                          </span>
                          <button
                            type="button"
                            title="Pick Scribble Strip Color"
                            onClick={() =>
                              setColorPickerForId((prev) => (prev === ch.id ? null : ch.id))
                            }
                            style={{
                              background: "rgba(0,0,0,0.28)",
                              border: "none",
                              borderRadius: 3,
                              padding: 2,
                              color: colDef.text,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <Palette size={10} />
                          </button>
                        </>
                      )}
                    </div>

                    {colorPickerForId === ch.id && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 6px)",
                          left: 0,
                          zIndex: 30,
                          background: "#121721",
                          border: "1px solid #3B82F6",
                          borderRadius: 8,
                          padding: 6,
                          display: "grid",
                          gridTemplateColumns: "repeat(4, 18px)",
                          gap: 4,
                          boxShadow: "0 10px 24px rgba(0,0,0,0.7)",
                        }}
                      >
                        {X32_COLORS.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            title={c.label}
                            onClick={() => {
                              patchChannel(ch.id, (prev) => ({ ...prev, color: c.key }));
                              emitOsc(`${ch.oscPrefix}/config/color`, c.code);
                              setColorPickerForId(null);
                            }}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 4,
                              background: c.bg,
                              border: `2px solid ${ch.color === c.key ? "#FFFFFF" : c.border}`,
                              cursor: "pointer",
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected Channel Detail Strip */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              background: "#0D1117",
              overflowY: "auto",
            }}
          >
            {/* Detail Header Strip */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 16px",
                background: "#12161F",
                borderBottom: "1px solid #1E2533",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: selectedColor.bg,
                    border: `1px solid ${selectedColor.border}`,
                    color: selectedColor.text,
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {selectedChannel.shortLabel}: {selectedChannel.name}
                </span>

                <input
                  type="text"
                  maxLength={12}
                  value={selectedChannel.name}
                  aria-label="Selected channel scribble name"
                  onChange={(e) => {
                    const val = e.target.value;
                    patchChannel(selectedChannel.id, (prev) => ({ ...prev, name: val }));
                    emitOsc(`${selectedChannel.oscPrefix}/config/name`, val);
                  }}
                  style={{
                    width: 128,
                    height: 28,
                    padding: "0 8px",
                    background: "#080B10",
                    border: "1px solid #283344",
                    borderRadius: 6,
                    color: "#FFFFFF",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />

                {/* Inline color strip picker */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {X32_COLORS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      title={`Scribble Color: ${c.label}`}
                      onClick={() => {
                        patchChannel(selectedChannel.id, (prev) => ({ ...prev, color: c.key }));
                        emitOsc(`${selectedChannel.oscPrefix}/config/color`, c.code);
                      }}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        background: c.bg,
                        border: `2px solid ${selectedChannel.color === c.key ? "#FFFFFF" : c.border}`,
                        cursor: "pointer",
                      }}
                    />
                  ))}
                </div>

                {/* Quick Channel Strip Summary Controls */}
                {/* A5: Automix (Off, X, Y) & A6: Channel Preset Library */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: '#0B0F17', border: '1px solid #1E2533', borderRadius: 6, padding: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#64748B', padding: '0 4px' }}>Automix</span>
                    {(['Off', 'X', 'Y'] as const).map((grp) => {
                      const current = automixGroups[selectedChannel.id] ?? 'Off';
                      const active = current === grp;
                      return (
                        <button
                          key={grp}
                          type="button"
                          onClick={() => {
                            setAutomixGroups((prev) => ({ ...prev, [selectedChannel.id]: grp }));
                            emitOsc(`${selectedChannel.oscPrefix}/automix/group`, grp === 'Off' ? 0 : grp === 'X' ? 1 : 2);
                          }}
                          style={{
                            height: 22,
                            padding: '0 7px',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            background: active ? '#0F766E' : 'transparent',
                            border: 'none',
                            color: active ? '#CCFBF1' : '#94A3B8',
                          }}
                        >
                          {grp}
                        </button>
                      );
                    })}
                  </div>
                  <select
                    aria-label="Channel Preset Library"
                    defaultValue=""
                    onChange={(e) => {
                      const preset = e.target.value;
                      if (!preset) return;
                      const presets: Record<string, { hpfOn: boolean; hpfFreqHz: number; eqOn: boolean; gains: [number, number, number, number]; compOn: boolean; thresholdDb: number; ratio: number }> = {
                        'Lead Vocal': { hpfOn: true, hpfFreqHz: 110, eqOn: true, gains: [-2, 1.5, 3, 2], compOn: true, thresholdDb: -18, ratio: 3.5 },
                        'Acoustic Guitar': { hpfOn: true, hpfFreqHz: 90, eqOn: true, gains: [-1.5, -2, 2, 3], compOn: true, thresholdDb: -16, ratio: 3 },
                        'Pastor Lav': { hpfOn: true, hpfFreqHz: 140, eqOn: true, gains: [-3, -2.5, 3.5, 1.5], compOn: true, thresholdDb: -20, ratio: 4 },
                        'Kick Drum': { hpfOn: true, hpfFreqHz: 35, eqOn: true, gains: [4, -4, 3, 1], compOn: true, thresholdDb: -14, ratio: 4.5 },
                        'Reset Flat': { hpfOn: false, hpfFreqHz: 80, eqOn: false, gains: [0, 0, 0, 0], compOn: false, thresholdDb: -12, ratio: 2 },
                      };
                      const p = presets[preset];
                      if (!p) return;
                      patchChannel(selectedChannel.id, (prev) => ({
                        ...prev,
                        hpfOn: p.hpfOn,
                        hpfFreqHz: p.hpfFreqHz,
                        eqOn: p.eqOn,
                        eqBands: [
                          { ...prev.eqBands[0], gain: p.gains[0] },
                          { ...prev.eqBands[1], gain: p.gains[1] },
                          { ...prev.eqBands[2], gain: p.gains[2] },
                          { ...prev.eqBands[3], gain: p.gains[3] },
                        ],
                        comp: { ...prev.comp, on: p.compOn, thresholdDb: p.thresholdDb, ratio: p.ratio },
                      }));
                      emitOsc(`${selectedChannel.oscPrefix}/preamp/hpf`, p.hpfOn ? 1 : 0);
                      emitOsc(`${selectedChannel.oscPrefix}/eq/on`, p.eqOn ? 1 : 0);
                      emitOsc(`${selectedChannel.oscPrefix}/dyn/on`, p.compOn ? 1 : 0);
                      e.target.value = '';
                    }}
                    style={{
                      height: 28,
                      padding: '0 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      background: '#161B24',
                      border: '1px solid #283344',
                      color: '#CBD5E1',
                    }}
                  >
                    <option value="">Preset Library…</option>
                    <option value="Lead Vocal">Lead Vocal</option>
                    <option value="Acoustic Guitar">Acoustic Guitar</option>
                    <option value="Pastor Lav">Pastor Lav</option>
                    <option value="Kick Drum">Kick Drum</option>
                    <option value="Reset Flat">Reset Flat</option>
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectedChannel.phantom48v;
                      patchChannel(selectedChannel.id, (prev) => ({ ...prev, phantom48v: next }));
                      const addr =
                        selectedChannel.headampIndex !== null
                          ? `/headamp/${String(selectedChannel.headampIndex).padStart(3, "0")}/phantom`
                          : `${selectedChannel.oscPrefix}/preamp/phantom`;
                      emitOsc(addr, next ? 1 : 0);
                    }}
                    style={{
                      height: 28,
                      padding: "0 9px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: selectedChannel.phantom48v ? "#991B1B" : "#161B24",
                      border: `1px solid ${selectedChannel.phantom48v ? "#EF4444" : "#283344"}`,
                      color: selectedChannel.phantom48v ? "#FCA5A5" : "#94A3B8",
                    }}
                  >
                    +48V
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !channelLinks[selectedChannel.id];
                      setChannelLinks((prev) => ({ ...prev, [selectedChannel.id]: next }));
                      emitOsc(`${selectedChannel.oscPrefix}/config/link`, next ? 1 : 0);
                    }}
                    style={{
                      height: 28,
                      padding: "0 9px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: channelLinks[selectedChannel.id] ? "#0369A1" : "#161B24",
                      border: `1px solid ${channelLinks[selectedChannel.id] ? "#38BDF8" : "#283344"}`,
                      color: channelLinks[selectedChannel.id] ? "#E0F2FE" : "#94A3B8",
                    }}
                    title="Toggle Channel Link"
                  >
                    {channelLinks[selectedChannel.id] ? "LINKED" : "LINK"}
                  </button>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      height: 28,
                      padding: "0 8px",
                      borderRadius: 6,
                      background: "#161B24",
                      border: "1px solid #283344",
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8" }}>DLY</span>
                    <input
                      type="range"
                      aria-label="Channel Delay ms"
                      min={0}
                      max={500}
                      step={1}
                      value={channelDelays[selectedChannel.id] ?? 0}
                      onChange={(e) => {
                        const ms = Number(e.target.value);
                        setChannelDelays((prev) => ({ ...prev, [selectedChannel.id]: ms }));
                        emitOsc(`${selectedChannel.oscPrefix}/preamp/delay`, ms);
                      }}
                      style={{ width: 68, accentColor: "#38BDF8", cursor: "pointer" }}
                    />
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: (channelDelays[selectedChannel.id] ?? 0) > 0 ? "#38BDF8" : "#64748B",
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        minWidth: 36,
                        textAlign: "right",
                      }}
                    >
                      {channelDelays[selectedChannel.id] ?? 0}ms
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectedChannel.solo;
                      patchChannel(selectedChannel.id, (prev) => ({ ...prev, solo: next }));
                      emitOsc(`${selectedChannel.oscPrefix}/mix/solo`, next ? 1 : 0);
                    }}
                    style={{
                      height: 28,
                      padding: "0 9px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: selectedChannel.solo ? "#D97706" : "#161B24",
                      border: `1px solid ${selectedChannel.solo ? "#FBBF24" : "#283344"}`,
                      color: selectedChannel.solo ? "#FFFFFF" : "#94A3B8",
                    }}
                  >
                    SOLO
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectedChannel.mute;
                      patchChannel(selectedChannel.id, (prev) => ({ ...prev, mute: next }));
                      emitOsc(`${selectedChannel.oscPrefix}/mix/on`, next ? 0 : 1);
                    }}
                    style={{
                      height: 28,
                      padding: "0 9px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: selectedChannel.mute ? "#991B1B" : "#065F46",
                      border: `1px solid ${selectedChannel.mute ? "#EF4444" : "#10B981"}`,
                      color: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {selectedChannel.mute ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    {selectedChannel.mute ? "MUTED" : "LIVE"}
                  </button>
                </div>
              </div>

              {/* Detail Sub-Tabs */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {(
                  [
                    { id: "eq_dyn", label: "4-Band EQ • Gate • Compressor", icon: Activity },
                    { id: "bus_sends", label: "Bus Sends 1-16", icon: Layers },
                    { id: "routing", label: "Routing Matrix", icon: Grid },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  const active = detailTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDetailTab(t.id)}
                      style={{
                        height: 30,
                        padding: "0 12px",
                        borderRadius: 6,
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        background: active ? "#1E3A8A" : "#161B24",
                        border: `1px solid ${active ? "#3B82F6" : "#283344"}`,
                        color: active ? "#FFFFFF" : "#94A3B8",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Icon size={13} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Detail Tab 1: 4-Band Parametric EQ Curve + Noise Gate + Compressor */}
            {detailTab === "eq_dyn" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.45fr 0.75fr 0.8fr",
                  gap: 12,
                  padding: 14,
                  flex: 1,
                  minHeight: 0,
                }}
              >
                {/* 4-Band Parametric EQ Section */}
                <div
                  style={{
                    background: "#10151F",
                    border: "1px solid #1E2533",
                    borderRadius: 10,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#E2E8F0", textTransform: "uppercase" }}>
                        4-Band Parametric EQ Curve
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !selectedChannel.eqOn;
                          patchChannel(selectedChannel.id, (prev) => ({ ...prev, eqOn: next }));
                          emitOsc(`${selectedChannel.oscPrefix}/eq/on`, next ? 1 : 0);
                        }}
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: 5,
                          cursor: "pointer",
                          background: selectedChannel.eqOn ? "#065F46" : "#1E2533",
                          border: `1px solid ${selectedChannel.eqOn ? "#10B981" : "#334155"}`,
                          color: selectedChannel.eqOn ? "#34D399" : "#94A3B8",
                        }}
                      >
                        {selectedChannel.eqOn ? "EQ ACTIVE" : "BYPASSED"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRtaEnabled((prev) => !prev)}
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: 5,
                          cursor: "pointer",
                          background: rtaEnabled ? "#1E3A8A" : "#1E2533",
                          border: `1px solid ${rtaEnabled ? "#3B82F6" : "#334155"}`,
                          color: rtaEnabled ? "#93C5FD" : "#94A3B8",
                        }}
                      >
                        100-Band RTA
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        patchChannel(selectedChannel.id, (prev) => ({
                          ...prev,
                          eqBands: createDefaultEq(false),
                        }));
                        emitOsc(`${selectedChannel.oscPrefix}/eq/reset`, 1);
                      }}
                      style={{
                        fontSize: 10.5,
                        padding: "3px 8px",
                        borderRadius: 5,
                        background: "#161B24",
                        border: "1px solid #283344",
                        color: "#94A3B8",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <RotateCcw size={11} />
                      Flatten EQ
                    </button>
                  </div>

                  {/* Interactive SVG EQ Curve */}
                  <div
                    style={{
                      background: "#070A10",
                      border: "1px solid #1E2533",
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    <svg
                      ref={eqSvgRef}
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      onPointerMove={handleEqSvgPointerMove}
                      onPointerUp={() => setDraggingBandIdx(null)}
                      onPointerCancel={() => setDraggingBandIdx(null)}
                      style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
                    >
                      {/* 100-Band RTA FFT Spectrum Overlay */}
                      {rtaEnabled && (
                        <g opacity={0.28}>
                          {rtaBars.map((val, idx) => {
                            const plotW = svgW - padL - padR;
                            const plotH = svgH - padT - padB;
                            const barW = plotW / 100;
                            const h = Math.max(2, val * plotH);
                            return (
                              <rect
                                key={idx}
                                x={padL + idx * barW + 0.5}
                                y={svgH - padB - h}
                                width={Math.max(1, barW - 1.2)}
                                height={h}
                                rx={1}
                                fill="#38BDF8"
                              />
                            );
                          })}
                        </g>
                      )}

                      {/* dB Horizontal Grid */}
                      {[-15, -10, -5, 0, 5, 10, 15].map((db) => {
                        const y = dbToY(db);
                        return (
                          <g key={db}>
                            <line
                              x1={padL}
                              y1={y}
                              x2={svgW - padR}
                              y2={y}
                              stroke={db === 0 ? "#475569" : "#1E2533"}
                              strokeWidth={db === 0 ? 1.2 : 0.8}
                              strokeDasharray={db === 0 ? undefined : "3 3"}
                            />
                            <text
                              x={padL - 5}
                              y={y + 3}
                              fill={db === 0 ? "#CBD5E1" : "#64748B"}
                              fontSize="9"
                              textAnchor="end"
                              fontFamily="monospace"
                            >
                              {db > 0 ? `+${db}` : db}
                            </text>
                          </g>
                        );
                      })}

                      {/* Log Frequency Grid */}
                      {[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((hz) => {
                        const x = padL + freqToNorm(hz) * plotW;
                        const lbl = hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
                        return (
                          <g key={hz}>
                            <line x1={x} y1={padT} x2={x} y2={svgH - padB} stroke="#1E2533" strokeWidth={0.8} />
                            <text
                              x={x}
                              y={svgH - 7}
                              fill="#64748B"
                              fontSize="9"
                              textAnchor="middle"
                              fontFamily="monospace"
                            >
                              {lbl}
                            </text>
                          </g>
                        );
                      })}

                      {/* HPF Curve */}
                      {selectedChannel.hpfOn && eqCurveData.hpfPath && (
                        <path
                          d={eqCurveData.hpfPath}
                          fill="none"
                          stroke="#10B981"
                          strokeWidth={1.2}
                          strokeDasharray="4 3"
                          opacity={0.75}
                        />
                      )}

                      {/* Individual Band Curves */}
                      {selectedChannel.eqBands.map((band, bIdx) => (
                        <path
                          key={band.id}
                          d={eqCurveData.bandPaths[bIdx]}
                          fill="none"
                          stroke={band.color}
                          strokeWidth={1.3}
                          opacity={selectedChannel.eqOn ? 0.55 : 0.2}
                        />
                      ))}

                      {/* Combined Master EQ Curve */}
                      <path
                        d={eqCurveData.totalPath}
                        fill="none"
                        stroke={selectedChannel.eqOn ? "#F8FAFC" : "#64748B"}
                        strokeWidth={2.4}
                      />

                      {/* Draggable Band Control Points */}
                      {selectedChannel.eqBands.map((band, bIdx) => {
                        const cx = padL + freqToNorm(band.freq) * plotW;
                        const cy = dbToY(band.gain);
                        return (
                          <g
                            key={band.id}
                            style={{ cursor: "grab" }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              eqSvgRef.current?.setPointerCapture(e.pointerId);
                              setDraggingBandIdx(bIdx);
                            }}
                          >
                            <circle
                              cx={cx}
                              cy={cy}
                              r={10}
                              fill={band.color}
                              fillOpacity={0.22}
                              stroke={band.color}
                              strokeWidth={2}
                            />
                            <text
                              x={cx}
                              y={cy + 3.5}
                              fill="#FFFFFF"
                              fontSize="9.5"
                              fontWeight="bold"
                              textAnchor="middle"
                              style={{ pointerEvents: "none" }}
                            >
                              {band.bandIndex}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* 4-Band Freq / Gain / Q Sliders */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    {selectedChannel.eqBands.map((band, bIdx) => (
                      <div
                        key={band.id}
                        style={{
                          background: "#0B0E15",
                          border: `1px solid ${band.color}44`,
                          borderTop: `3px solid ${band.color}`,
                          borderRadius: 7,
                          padding: 8,
                          display: "flex",
                          flexDirection: "column",
                          gap: 5,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: band.color }}>
                            {band.bandIndex}. {band.label}
                          </span>
                          <span style={{ fontSize: 9.5, color: "#94A3B8", fontFamily: "monospace" }}>
                            {band.type}
                          </span>
                        </div>

                        <label style={{ fontSize: 10, color: "#94A3B8", display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>Freq</span>
                            <strong style={{ color: "#E2E8F0", fontFamily: "monospace" }}>
                              {band.freq >= 1000 ? `${(band.freq / 1000).toFixed(2)}k` : `${band.freq}Hz`}
                            </strong>
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={1000}
                            value={Math.round(freqToNorm(band.freq) * 1000)}
                            onChange={(e) => {
                              const freq = normToFreq(Number(e.target.value) / 1000);
                              patchChannel(selectedChannel.id, (prev) => {
                                const next = [...prev.eqBands] as [EqBandState, EqBandState, EqBandState, EqBandState];
                                next[bIdx] = { ...next[bIdx], freq };
                                return { ...prev, eqBands: next };
                              });
                              emitOsc(`${selectedChannel.oscPrefix}/eq/${band.bandIndex}/f`, freq);
                            }}
                            style={{ width: "100%", accentColor: band.color }}
                          />
                        </label>

                        <label style={{ fontSize: 10, color: "#94A3B8", display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>Gain</span>
                            <strong style={{ color: "#E2E8F0", fontFamily: "monospace" }}>
                              {band.gain > 0 ? `+${band.gain.toFixed(1)}` : band.gain.toFixed(1)} dB
                            </strong>
                          </span>
                          <input
                            type="range"
                            min={-15}
                            max={15}
                            step={0.5}
                            value={band.gain}
                            onChange={(e) => {
                              const gain = Number(e.target.value);
                              patchChannel(selectedChannel.id, (prev) => {
                                const next = [...prev.eqBands] as [EqBandState, EqBandState, EqBandState, EqBandState];
                                next[bIdx] = { ...next[bIdx], gain };
                                return { ...prev, eqBands: next };
                              });
                              emitOsc(`${selectedChannel.oscPrefix}/eq/${band.bandIndex}/g`, gain);
                            }}
                            style={{ width: "100%", accentColor: band.color }}
                          />
                        </label>

                        <label style={{ fontSize: 10, color: "#94A3B8", display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>Q</span>
                            <strong style={{ color: "#E2E8F0", fontFamily: "monospace" }}>
                              {band.q.toFixed(1)}
                            </strong>
                          </span>
                          <input
                            type="range"
                            min={0.3}
                            max={10}
                            step={0.1}
                            value={band.q}
                            onChange={(e) => {
                              const q = Number(e.target.value);
                              patchChannel(selectedChannel.id, (prev) => {
                                const next = [...prev.eqBands] as [EqBandState, EqBandState, EqBandState, EqBandState];
                                next[bIdx] = { ...next[bIdx], q };
                                return { ...prev, eqBands: next };
                              });
                              emitOsc(`${selectedChannel.oscPrefix}/eq/${band.bandIndex}/q`, q);
                            }}
                            style={{ width: "100%", accentColor: band.color }}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Noise Gate Panel */}
                <div
                  style={{
                    background: "#10151F",
                    border: "1px solid #1E2533",
                    borderRadius: 10,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#E2E8F0", textTransform: "uppercase" }}>
                      Noise Gate
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !selectedChannel.gate.on;
                        patchChannel(selectedChannel.id, (prev) => ({
                          ...prev,
                          gate: { ...prev.gate, on: next },
                        }));
                        emitOsc(`${selectedChannel.oscPrefix}/gate/on`, next ? 1 : 0);
                      }}
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "3px 8px",
                        borderRadius: 5,
                        cursor: "pointer",
                        background: selectedChannel.gate.on ? "#065F46" : "#1E2533",
                        border: `1px solid ${selectedChannel.gate.on ? "#10B981" : "#334155"}`,
                        color: selectedChannel.gate.on ? "#34D399" : "#94A3B8",
                      }}
                    >
                      {selectedChannel.gate.on ? "GATE ON" : "BYPASS"}
                    </button>
                  </div>

                  {/* Gate Transfer SVG */}
                  <div style={{ background: "#070A10", border: "1px solid #1E2533", borderRadius: 8, padding: 6 }}>
                    <svg viewBox="0 0 180 130" style={{ width: "100%", height: "auto", display: "block" }}>
                      <line x1={20} y1={110} x2={165} y2={15} stroke="#1E2533" strokeDasharray="3 3" />
                      <line x1={20} y1={110} x2={165} y2={110} stroke="#334155" />
                      <line x1={20} y1={15} x2={20} y2={110} stroke="#334155" />
                      {(() => {
                        const thrFrac = (selectedChannel.gate.threshold + 80) / 80;
                        const thrX = 20 + thrFrac * 145;
                        const thrY = 110 - thrFrac * 95;
                        const dropY = Math.min(110, thrY + (selectedChannel.gate.range / 60) * 55);
                        return (
                          <polyline
                            points={`20,${dropY.toFixed(1)} ${thrX.toFixed(1)},${dropY.toFixed(1)} ${thrX.toFixed(1)},${thrY.toFixed(1)} 165,15`}
                            fill="none"
                            stroke={selectedChannel.gate.on ? "#10B981" : "#64748B"}
                            strokeWidth={2.2}
                          />
                        );
                      })()}
                      <text x={24} y={24} fill="#64748B" fontSize="9" fontFamily="monospace">
                        THR {selectedChannel.gate.threshold} dB
                      </text>
                      <text x={24} y={36} fill="#64748B" fontSize="9" fontFamily="monospace">
                        RNG {selectedChannel.gate.range} dB
                      </text>
                    </svg>
                  </div>

                  <label style={{ fontSize: 11, color: "#94A3B8", display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Threshold</span>
                      <strong style={{ color: "#34D399", fontFamily: "monospace" }}>
                        {selectedChannel.gate.threshold} dB
                      </strong>
                    </span>
                    <input
                      type="range"
                      min={-80}
                      max={0}
                      step={1}
                      value={selectedChannel.gate.threshold}
                      onChange={(e) => {
                        const thr = Number(e.target.value);
                        patchChannel(selectedChannel.id, (prev) => ({
                          ...prev,
                          gate: { ...prev.gate, threshold: thr },
                        }));
                        emitOsc(`${selectedChannel.oscPrefix}/gate/thr`, thr);
                      }}
                      style={{ width: "100%", accentColor: "#10B981" }}
                    />
                  </label>

                  <label style={{ fontSize: 11, color: "#94A3B8", display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Range</span>
                      <strong style={{ color: "#34D399", fontFamily: "monospace" }}>
                        {selectedChannel.gate.range} dB
                      </strong>
                    </span>
                    <input
                      type="range"
                      min={3}
                      max={60}
                      step={1}
                      value={selectedChannel.gate.range}
                      onChange={(e) => {
                        const range = Number(e.target.value);
                        patchChannel(selectedChannel.id, (prev) => ({
                          ...prev,
                          gate: { ...prev.gate, range },
                        }));
                        emitOsc(`${selectedChannel.oscPrefix}/gate/range`, range);
                      }}
                      style={{ width: "100%", accentColor: "#10B981" }}
                    />
                  </label>
                </div>

                {/* Compressor / Dynamics Panel */}
                <div
                  style={{
                    background: "#10151F",
                    border: "1px solid #1E2533",
                    borderRadius: 10,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#E2E8F0", textTransform: "uppercase" }}>
                      Compressor / Dynamics
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !selectedChannel.comp.on;
                        patchChannel(selectedChannel.id, (prev) => ({
                          ...prev,
                          comp: { ...prev.comp, on: next },
                        }));
                        emitOsc(`${selectedChannel.oscPrefix}/dyn/on`, next ? 1 : 0);
                      }}
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "3px 8px",
                        borderRadius: 5,
                        cursor: "pointer",
                        background: selectedChannel.comp.on ? "#1E40AF" : "#1E2533",
                        border: `1px solid ${selectedChannel.comp.on ? "#3B82F6" : "#334155"}`,
                        color: selectedChannel.comp.on ? "#FFFFFF" : "#94A3B8",
                      }}
                    >
                      {selectedChannel.comp.on ? "COMP ON" : "BYPASS"}
                    </button>
                  </div>

                  {/* Comp Transfer Curve SVG */}
                  <div style={{ background: "#070A10", border: "1px solid #1E2533", borderRadius: 8, padding: 6 }}>
                    <svg viewBox="0 0 180 130" style={{ width: "100%", height: "auto", display: "block" }}>
                      <line x1={20} y1={110} x2={165} y2={15} stroke="#1E2533" strokeDasharray="3 3" />
                      <line x1={20} y1={110} x2={165} y2={110} stroke="#334155" />
                      <line x1={20} y1={15} x2={20} y2={110} stroke="#334155" />
                      {(() => {
                        const thrFrac = (selectedChannel.comp.threshold + 60) / 60;
                        const kneeX = 20 + thrFrac * 145;
                        const kneeY = 110 - thrFrac * 95;
                        const outAbove = (60 - (selectedChannel.comp.threshold + 60)) / selectedChannel.comp.ratio;
                        const endY = Math.max(15, kneeY - (outAbove / 60) * 95);
                        return (
                          <polyline
                            points={`20,110 ${kneeX.toFixed(1)},${kneeY.toFixed(1)} 165,${endY.toFixed(1)}`}
                            fill="none"
                            stroke={selectedChannel.comp.on ? "#60A5FA" : "#64748B"}
                            strokeWidth={2.2}
                          />
                        );
                      })()}
                      <text x={24} y={24} fill="#64748B" fontSize="9" fontFamily="monospace">
                        THR {selectedChannel.comp.threshold} dB
                      </text>
                      <text x={24} y={36} fill="#64748B" fontSize="9" fontFamily="monospace">
                        {selectedChannel.comp.ratio.toFixed(1)}:1 • {selectedChannel.comp.attack} ms
                      </text>
                    </svg>
                  </div>

                  <label style={{ fontSize: 11, color: "#94A3B8", display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Threshold</span>
                      <strong style={{ color: "#60A5FA", fontFamily: "monospace" }}>
                        {selectedChannel.comp.threshold} dB
                      </strong>
                    </span>
                    <input
                      type="range"
                      min={-60}
                      max={0}
                      step={1}
                      value={selectedChannel.comp.threshold}
                      onChange={(e) => {
                        const thr = Number(e.target.value);
                        patchChannel(selectedChannel.id, (prev) => ({
                          ...prev,
                          comp: { ...prev.comp, threshold: thr },
                        }));
                        emitOsc(`${selectedChannel.oscPrefix}/dyn/thr`, thr);
                      }}
                      style={{ width: "100%", accentColor: "#3B82F6" }}
                    />
                  </label>

                  <label style={{ fontSize: 11, color: "#94A3B8", display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Ratio</span>
                      <strong style={{ color: "#60A5FA", fontFamily: "monospace" }}>
                        {selectedChannel.comp.ratio.toFixed(1)}:1
                      </strong>
                    </span>
                    <input
                      type="range"
                      min={1.1}
                      max={20}
                      step={0.1}
                      value={selectedChannel.comp.ratio}
                      onChange={(e) => {
                        const ratio = Number(e.target.value);
                        patchChannel(selectedChannel.id, (prev) => ({
                          ...prev,
                          comp: { ...prev.comp, ratio },
                        }));
                        emitOsc(`${selectedChannel.oscPrefix}/dyn/ratio`, ratio);
                      }}
                      style={{ width: "100%", accentColor: "#3B82F6" }}
                    />
                  </label>

                  <label style={{ fontSize: 11, color: "#94A3B8", display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Attack</span>
                      <strong style={{ color: "#60A5FA", fontFamily: "monospace" }}>
                        {selectedChannel.comp.attack} ms
                      </strong>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={120}
                      step={1}
                      value={selectedChannel.comp.attack}
                      onChange={(e) => {
                        const attack = Number(e.target.value);
                        patchChannel(selectedChannel.id, (prev) => ({
                          ...prev,
                          comp: { ...prev.comp, attack },
                        }));
                        emitOsc(`${selectedChannel.oscPrefix}/dyn/attack`, attack);
                      }}
                      style={{ width: "100%", accentColor: "#3B82F6" }}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Detail Tab 2: Bus Sends 1-16 */}
            {detailTab === "bus_sends" && (
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#E2E8F0", textTransform: "uppercase" }}>
                    MixBus Sends 1-16 — {selectedChannel.shortLabel} ({selectedChannel.name})
                  </span>
                  <span style={{ fontSize: 11, color: "#94A3B8" }}>
                    Adjust monitor, broadcast stem, lobby & FX send levels
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {selectedChannel.busSends.map((send) => {
                    const padBus = String(send.busNumber).padStart(2, "0");
                    return (
                      <div
                        key={send.busNumber}
                        style={{
                          background: "#10151F",
                          border: `1px solid ${send.on ? "#3B82F688" : "#1E2533"}`,
                          borderRadius: 8,
                          padding: 10,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#FFFFFF" }}>
                            Bus {padBus} • {send.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const nextOn = !send.on;
                              patchChannel(selectedChannel.id, (prev) => ({
                                ...prev,
                                busSends: prev.busSends.map((b) =>
                                  b.busNumber === send.busNumber ? { ...b, on: nextOn } : b
                                ),
                              }));
                              emitOsc(`${selectedChannel.oscPrefix}/mix/${padBus}/on`, nextOn ? 1 : 0);
                            }}
                            style={{
                              fontSize: 9.5,
                              fontWeight: 800,
                              padding: "2px 7px",
                              borderRadius: 4,
                              cursor: "pointer",
                              background: send.on ? "#065F46" : "#161B24",
                              border: `1px solid ${send.on ? "#10B981" : "#283344"}`,
                              color: send.on ? "#34D399" : "#64748B",
                            }}
                          >
                            {send.on ? "ON" : "OFF"}
                          </button>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => {
                              const order: Array<"PRE" | "POST" | "SUB"> = ["PRE", "POST", "SUB"];
                              const nextTap = order[(order.indexOf(send.tap) + 1) % order.length];
                              patchChannel(selectedChannel.id, (prev) => ({
                                ...prev,
                                busSends: prev.busSends.map((b) =>
                                  b.busNumber === send.busNumber ? { ...b, tap: nextTap } : b
                                ),
                              }));
                              emitOsc(`${selectedChannel.oscPrefix}/mix/${padBus}/type`, nextTap);
                            }}
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "#161B24",
                              border: "1px solid #283344",
                              color: send.tap === "POST" ? "#FBBF24" : "#60A5FA",
                              cursor: "pointer",
                            }}
                          >
                            {send.tap}
                          </button>
                          <span style={{ fontSize: 11, fontFamily: "monospace", color: "#CBD5E1" }}>
                            {formatDb(send.levelDb)}
                          </span>
                        </div>

                        <input
                          type="range"
                          min={-90}
                          max={10}
                          step={0.5}
                          value={send.levelDb}
                          onChange={(e) => {
                            const lvl = Number(e.target.value);
                            patchChannel(selectedChannel.id, (prev) => ({
                              ...prev,
                              busSends: prev.busSends.map((b) =>
                                b.busNumber === send.busNumber ? { ...b, levelDb: lvl, on: true } : b
                              ),
                            }));
                            emitOsc(`${selectedChannel.oscPrefix}/mix/${padBus}/level`, lvl);
                          }}
                          style={{ width: "100%", accentColor: send.on ? "#3B82F6" : "#64748B" }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Detail Tab 3: Routing Matrix View */}
            {detailTab === "routing" && (
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#E2E8F0", textTransform: "uppercase" }}>
                      X32 / M32 Routing Matrix — {routingDomain}
                    </div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>
                      {ROUTING_CONFIG[routingDomain].subtitle}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["AES50-A", "AES50-B", "Local 1-32", "Card", "P16 Ultranet"] as RoutingDomainId[]).map((dom) => {
                      const active = routingDomain === dom;
                      return (
                        <button
                          key={dom}
                          type="button"
                          onClick={() => setRoutingDomain(dom)}
                          style={{
                            height: 28,
                            padding: "0 10px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            background: active ? "#7C3AED" : "#161B24",
                            border: `1px solid ${active ? "#A855F7" : "#283344"}`,
                            color: active ? "#FFFFFF" : "#94A3B8",
                          }}
                        >
                          <Radio size={11} style={{ marginRight: 5, verticalAlign: "-1px" }} />
                          {dom}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Routing Grid */}
                <div
                  style={{
                    background: "#0A0E15",
                    border: "1px solid #1E2533",
                    borderRadius: 8,
                    overflowX: "auto",
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ background: "#12161F", borderBottom: "1px solid #1E2533" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "#94A3B8", fontWeight: 700 }}>
                          Destination ↓ / Source →
                        </th>
                        {ROUTING_CONFIG[routingDomain].sources.map((src) => (
                          <th
                            key={src}
                            style={{
                              padding: "8px 10px",
                              color: "#CBD5E1",
                              fontWeight: 700,
                              textAlign: "center",
                              borderLeft: "1px solid #1E2533",
                            }}
                          >
                            {src}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ROUTING_CONFIG[routingDomain].destinations.map((dest, rowIdx) => {
                        const activeCol = routingSelections[routingDomain][rowIdx] ?? 0;
                        return (
                          <tr key={dest} style={{ borderBottom: "1px solid #161B24" }}>
                            <td
                              style={{
                                padding: "8px 12px",
                                fontWeight: 700,
                                color: "#E2E8F0",
                                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                background: "#0F141D",
                              }}
                            >
                              {dest}
                            </td>
                            {ROUTING_CONFIG[routingDomain].sources.map((src, colIdx) => {
                              const patched = activeCol === colIdx;
                              return (
                                <td
                                  key={src}
                                  style={{
                                    textAlign: "center",
                                    padding: 6,
                                    borderLeft: "1px solid #1E2533",
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRoutingSelections((prev) => ({
                                        ...prev,
                                        [routingDomain]: {
                                          ...prev[routingDomain],
                                          [rowIdx]: colIdx,
                                        },
                                      }));
                                      emitOsc(
                                        `${ROUTING_CONFIG[routingDomain].oscBase}/${dest.replace(/\s+/g, "_")}`,
                                        src
                                      );
                                    }}
                                    style={{
                                      width: 28,
                                      height: 24,
                                      borderRadius: 5,
                                      cursor: "pointer",
                                      background: patched ? "#065F46" : "#161B24",
                                      border: `1px solid ${patched ? "#10B981" : "#283344"}`,
                                      color: patched ? "#34D399" : "#475569",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                  >
                                    {patched ? <Check size={14} /> : "·"}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
        )}
        {/* A6: AES50-A/B & Clock Status Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 14px',
            background: '#080B10',
            borderTop: '1px solid #1E2533',
            fontSize: 11,
            color: '#94A3B8',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span><strong style={{ color: '#34D399' }}>AES50-A:</strong> Connected (48ch @ 48kHz)</span>
            <span><strong style={{ color: '#34D399' }}>AES50-B:</strong> Link Ready</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#64748B', fontWeight: 700 }}>Clock:</span>
            {(['48kHz Internal', 'AES50', 'Card'] as const).map((src) => {
              const active = clockSource === src;
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() => {
                    setClockSource(src);
                    emitOsc('/config/sync', src === '48kHz Internal' ? 0 : src === 'AES50' ? 1 : 2);
                  }}
                  style={{
                    height: 22,
                    padding: '0 8px',
                    borderRadius: 5,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: active ? '#065F46' : '#161B24',
                    border: `1px solid ${active ? '#10B981' : '#283344'}`,
                    color: active ? '#D1FAE5' : '#94A3B8',
                  }}
                >
                  {src}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default X32FullConsoleModal;
