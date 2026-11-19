export type ConsoleBankId =
  | "ch1_32"
  | "ch1_16"
  | "ch17_32"
  | "aux_fx"
  | "bus1_16"
  | "mtx1_6"
  | "dca1_8"
  | "p16_1_16"
  | "all"
  | "user1"
  | "user2";

export type X32TopScreenTab =
  | "mixer"
  | "channel"
  | "config"
  | "gate"
  | "dyn"
  | "eq"
  | "sends"
  | "main"
  | "fx1_4"
  | "fx5_8"
  | "routing";

export type DetailTabId = "eq_dyn" | "bus_sends" | "routing";
export type RoutingDomainId = "AES50-A" | "AES50-B" | "Local 1-32" | "Card" | "P16 Ultranet";
export type X32ColorKey = "OFF" | "RD" | "GN" | "YE" | "BL" | "MG" | "CY" | "WH";

export interface X32ColorDef {
  key: X32ColorKey;
  code: number;
  label: string;
  bg: string;
  border: string;
  text: string;
  notch: string;
}

export const X32_COLORS: X32ColorDef[] = [
  { key: "OFF", code: 0, label: "Off", bg: "#2B303A", border: "#475569", text: "#E2E8F0", notch: "#94A3B8" },
  { key: "RD", code: 1, label: "Red", bg: "#DC2626", border: "#F87171", text: "#FFFFFF", notch: "#EF4444" },
  { key: "GN", code: 2, label: "Green", bg: "#16A34A", border: "#4ADE80", text: "#052E16", notch: "#22C55E" },
  { key: "YE", code: 3, label: "Yellow", bg: "#CA8A04", border: "#FACC15", text: "#0F172A", notch: "#EAB308" },
  { key: "BL", code: 4, label: "Blue", bg: "#2563EB", border: "#60A5FA", text: "#FFFFFF", notch: "#3B82F6" },
  { key: "MG", code: 5, label: "Magenta", bg: "#C026D3", border: "#E879F9", text: "#FFFFFF", notch: "#D946EF" },
  { key: "CY", code: 6, label: "Cyan", bg: "#0891B2", border: "#22D3EE", text: "#042F2E", notch: "#06B6D4" },
  { key: "WH", code: 7, label: "White", bg: "#E2E8F0", border: "#FFFFFF", text: "#0F172A", notch: "#F8FAFC" },
];

export const COLOR_MAP: Record<X32ColorKey, X32ColorDef> = Object.fromEntries(
  X32_COLORS.map((c) => [c.key, c])
) as Record<X32ColorKey, X32ColorDef>;

export interface EqBandState {
  id: "low" | "lomid" | "himid" | "high";
  bandIndex: number;
  label: string;
  color: string;
  type: "LSHV" | "PEQ" | "HSHV";
  freq: number;
  gain: number;
  q: number;
}

export interface GateState {
  on: boolean;
  threshold: number;
  range: number;
}

export interface CompState {
  on: boolean;
  threshold: number;
  ratio: number;
  attack: number;
}

export interface BusSendState {
  busNumber: number;
  label: string;
  on: boolean;
  levelDb: number;
  tap: "PRE" | "POST" | "SUB";
}

export interface X32ChannelStripState {
  id: string;
  bank: "ch1_16" | "ch17_32" | "aux_fx" | "bus1_16" | "mtx1_6" | "dca1_8" | "p16_1_16";
  shortLabel: string;
  oscPrefix: string;
  headampIndex: number | null;
  name: string;
  color: X32ColorKey;
  phantom48v: boolean;
  polarityInvert: boolean;
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
  dcaAssignMask: number;
  lrAssign: boolean;
  monoAssign: boolean;
  insertOn: boolean;
}

export const BUS_LABELS = [
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

export function createDefaultEq(isSpeech = false): [EqBandState, EqBandState, EqBandState, EqBandState] {
  return [
    { id: "low", bandIndex: 1, label: "Low", color: "#F97316", type: "LSHV", freq: 105, gain: isSpeech ? -2.5 : 0, q: 1.0 },
    { id: "lomid", bandIndex: 2, label: "Lo-Mid", color: "#FACC15", type: "PEQ", freq: 360, gain: isSpeech ? -3.0 : 0, q: 2.0 },
    { id: "himid", bandIndex: 3, label: "Hi-Mid", color: "#10B981", type: "PEQ", freq: 2800, gain: isSpeech ? 2.5 : 0, q: 1.6 },
    { id: "high", bandIndex: 4, label: "High", color: "#3B82F6", type: "HSHV", freq: 8500, gain: isSpeech ? 1.5 : 0, q: 0.9 },
  ];
}

export function createBusSends(defaultActive = false): BusSendState[] {
  return BUS_LABELS.map((label, idx) => ({
    busNumber: idx + 1,
    label,
    on: defaultActive ? idx === 8 || idx === 9 : idx < 2 || idx === 8 || idx === 9,
    levelDb: idx === 8 || idx === 9 ? 0 : idx < 2 ? -6 : -30,
    tap: idx >= 12 ? "POST" : "PRE",
  }));
}

export function buildInitialChannels(): X32ChannelStripState[] {
  const ch1Presets: Array<{
    name: string;
    color: X32ColorKey;
    phantom: boolean;
    gain: number;
    hpf: boolean;
    hpfHz: number;
    fader: number;
    mute: boolean;
    speech?: boolean;
    dcaMask?: number;
  }> = [
    { name: "Kick In", color: "RD", phantom: false, gain: -5.8, hpf: true, hpfHz: 42, fader: 1.3, mute: false, dcaMask: 0b00010001 },
    { name: "Kick Out", color: "RD", phantom: false, gain: 0.0, hpf: true, hpfHz: 45, fader: 0.2, mute: false, dcaMask: 0b00010001 },
    { name: "Snare Top", color: "RD", phantom: false, gain: -1.5, hpf: true, hpfHz: 85, fader: 1.7, mute: false, dcaMask: 0b00010001 },
    { name: "Snare Btm", color: "RD", phantom: false, gain: -1.5, hpf: true, hpfHz: 110, fader: 1.7, mute: false, dcaMask: 0b00010001 },
    { name: "HiHats", color: "RD", phantom: true, gain: 9.3, hpf: true, hpfHz: 180, fader: 0.4, mute: false, dcaMask: 0b00010001 },
    { name: "Floor Tom", color: "RD", phantom: false, gain: 0.0, hpf: true, hpfHz: 60, fader: 1.0, mute: false, dcaMask: 0b00010001 },
    { name: "Rack Tom", color: "RD", phantom: false, gain: 0.0, hpf: true, hpfHz: 95, fader: 1.9, mute: false, dcaMask: 0b00010001 },
    { name: "Ride", color: "RD", phantom: true, gain: 0.0, hpf: true, hpfHz: 200, fader: 1.9, mute: false, dcaMask: 0b00010001 },
    { name: "OH L", color: "RD", phantom: true, gain: 0.0, hpf: true, hpfHz: 180, fader: 1.5, mute: false, dcaMask: 0b00010001 },
    { name: "OH R", color: "RD", phantom: true, gain: 0.0, hpf: true, hpfHz: 180, fader: 1.5, mute: false, dcaMask: 0b00010001 },
    { name: "Tambo", color: "RD", phantom: false, gain: 0.0, hpf: true, hpfHz: 150, fader: -1.4, mute: false, dcaMask: 0b00010001 },
    { name: "Bass Amp", color: "GN", phantom: false, gain: 2.5, hpf: true, hpfHz: 38, fader: 0.7, mute: false, dcaMask: 0b00010010 },
    { name: "Keys L", color: "MG", phantom: false, gain: -5.0, hpf: true, hpfHz: 60, fader: -4.7, mute: false, dcaMask: 0b00010100 },
    { name: "Keys R", color: "MG", phantom: false, gain: 1.0, hpf: true, hpfHz: 60, fader: -3.5, mute: false, dcaMask: 0b00010100 },
    { name: "Track L", color: "MG", phantom: false, gain: 0.0, hpf: false, hpfHz: 40, fader: -4.5, mute: false, dcaMask: 0b00010100 },
    { name: "Track R", color: "MG", phantom: false, gain: 0.0, hpf: false, hpfHz: 40, fader: -4.1, mute: false, dcaMask: 0b00010100 },
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
      polarityInvert: n === 4,
      preampGainDb: p.gain,
      hpfOn: p.hpf,
      hpfFreqHz: p.hpfHz,
      solo: false,
      mute: p.mute,
      faderDb: p.fader,
      pan: n === 9 || n === 13 || n === 15 ? -60 : n === 10 || n === 14 || n === 16 ? 60 : 0,
      meterLevel: -90,
      eqOn: true,
      eqBands: createDefaultEq(Boolean(p.speech)),
      gate: { on: idx < 10, threshold: idx < 10 ? -36 : -48, range: idx < 10 ? 32 : 18 },
      comp: { on: true, threshold: -18, ratio: 3.0, attack: 18 },
      busSends: createBusSends(false),
      dcaAssignMask: p.dcaMask ?? 0b00000001,
      lrAssign: true,
      monoAssign: false,
      insertOn: n === 3 || n === 10,
    });
  });

  const ch17Presets: Array<{ name: string; color: X32ColorKey; gain: number; fader: number; mute: boolean; speech?: boolean; dcaMask?: number }> = [
    { name: "Elec Gtr 1", color: "GN", gain: 0.0, fader: 0.0, mute: false, dcaMask: 0b00001000 },
    { name: "Elec Gtr 2", color: "GN", gain: 0.0, fader: 0.2, mute: false, dcaMask: 0b00001000 },
    { name: "Elec Gtr 3", color: "GN", gain: 0.0, fader: 1.3, mute: false, dcaMask: 0b00001000 },
    { name: "Elec Gtr 4", color: "GN", gain: 0.0, fader: 1.0, mute: false, dcaMask: 0b00001000 },
    { name: "Acoustic", color: "GN", gain: 0.0, fader: 0.4, mute: false, dcaMask: 0b00001000 },
    { name: "Lead Vox", color: "CY", gain: 2.3, fader: 0.7, mute: false, speech: true, dcaMask: 0b00100000 },
    { name: "BGV 1", color: "CY", gain: 0.0, fader: 0.3, mute: false, speech: true, dcaMask: 0b00100000 },
    { name: "BGV 2", color: "CY", gain: 0.0, fader: 0.4, mute: false, speech: true, dcaMask: 0b00100000 },
    { name: "BGV 3", color: "CY", gain: 0.0, fader: 0.3, mute: false, speech: true, dcaMask: 0b00100000 },
    { name: "BGV 4", color: "CY", gain: 0.0, fader: -0.2, mute: false, speech: true, dcaMask: 0b00100000 },
    { name: "Audience", color: "BL", gain: 0.0, fader: -9.0, mute: false, dcaMask: 0b01000000 },
    { name: "FOH L", color: "BL", gain: 2.0, fader: -9.7, mute: false, dcaMask: 0b01000000 },
    { name: "FOH R", color: "BL", gain: 0.0, fader: -11.2, mute: false, dcaMask: 0b01000000 },
    { name: "Pastor Lav", color: "YE", gain: 18.0, fader: 0.0, mute: false, speech: true, dcaMask: 0b10000000 },
    { name: "Pulpit", color: "OFF", gain: 0.0, fader: -90, mute: true, speech: true, dcaMask: 0b10000000 },
    { name: "Host HH", color: "OFF", gain: 0.0, fader: -90, mute: true, speech: true, dcaMask: 0b10000000 },
  ];

  ch17Presets.forEach((p, idx) => {
    const n = idx + 17;
    const pad = String(n).padStart(2, "0");
    channels.push({
      id: `ch-${pad}`,
      bank: "ch17_32",
      shortLabel: `Ch ${pad}`,
      oscPrefix: `/ch/${pad}`,
      headampIndex: n - 1,
      name: p.name,
      color: p.color,
      phantom48v: p.color === "BL" || n === 21,
      polarityInvert: false,
      preampGainDb: p.gain,
      hpfOn: idx < 14,
      hpfFreqHz: p.speech ? 115 : 85,
      solo: false,
      mute: p.mute,
      faderDb: p.fader,
      pan: p.name.endsWith(" L") ? -100 : p.name.endsWith(" R") ? 100 : 0,
      meterLevel: -90,
      eqOn: true,
      eqBands: createDefaultEq(Boolean(p.speech)),
      gate: { on: Boolean(p.speech), threshold: -46, range: 20 },
      comp: { on: idx < 14, threshold: -20, ratio: 2.8, attack: 14 },
      busSends: createBusSends(false),
      dcaAssignMask: p.dcaMask ?? 0,
      lrAssign: true,
      monoAssign: false,
      insertOn: n === 22,
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
      polarityInvert: false,
      preampGainDb: 0,
      hpfOn: isFx,
      hpfFreqHz: isFx ? 140 : 40,
      solo: false,
      mute: false,
      faderDb: isFx ? -10 : -4,
      pan: name.endsWith(" L") ? -100 : name.endsWith(" R") ? 100 : 0,
      meterLevel: -90,
      eqOn: true,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -55, range: 15 },
      comp: { on: false, threshold: -18, ratio: 2.0, attack: 20 },
      busSends: createBusSends(false),
      dcaAssignMask: 0,
      lrAssign: true,
      monoAssign: false,
      insertOn: false,
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
      polarityInvert: false,
      preampGainDb: 0,
      hpfOn: idx < 8,
      hpfFreqHz: 75,
      solo: false,
      mute: false,
      faderDb: 0,
      pan: idx === 8 ? -100 : idx === 9 ? 100 : 0,
      meterLevel: -90,
      eqOn: true,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -60, range: 12 },
      comp: { on: idx === 8 || idx === 9, threshold: -14, ratio: 2.5, attack: 15 },
      busSends: createBusSends(true),
      dcaAssignMask: 0,
      lrAssign: idx === 8 || idx === 9,
      monoAssign: false,
      insertOn: false,
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
      polarityInvert: false,
      preampGainDb: 0,
      hpfOn: idx >= 4,
      hpfFreqHz: 80,
      solo: false,
      mute: false,
      faderDb: 0,
      pan: 0,
      meterLevel: -90,
      eqOn: true,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -60, range: 10 },
      comp: { on: true, threshold: -10, ratio: 4.0, attack: 5 },
      busSends: createBusSends(false),
      dcaAssignMask: 0,
      lrAssign: false,
      monoAssign: false,
      insertOn: false,
    });
  });

  const dcaNames = [
    "Band Drums",
    "Bass & Low",
    "Keys & Trk",
    "Guitars",
    "Master Band",
    "Vocals",
    "Ambience",
    "Pastor/Host",
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
      color: n === 8 ? "YE" : n === 1 ? "RD" : n <= 4 ? "GN" : "CY",
      phantom48v: false,
      polarityInvert: false,
      preampGainDb: 0,
      hpfOn: false,
      hpfFreqHz: 80,
      solo: false,
      mute: n === 7,
      faderDb: 0,
      pan: 0,
      meterLevel: -90,
      eqOn: false,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -50, range: 15 },
      comp: { on: false, threshold: -18, ratio: 2.0, attack: 15 },
      busSends: createBusSends(false),
      dcaAssignMask: 0,
      lrAssign: true,
      monoAssign: false,
      insertOn: false,
    });
  });

  const p16Names = [
    "Kick", "Snare", "Bass", "Keys L",
    "Keys R", "Guitar", "Lead Vox", "BGV 1",
    "BGV 2", "Click", "Guide", "Tracks L",
    "Tracks R", "Choir", "Pastor", "Room",
  ];
  p16Names.forEach((name, idx) => {
    const n = idx + 1;
    const nn = String(n).padStart(2, "0");
    channels.push({
      id: `p16-${n}`,
      bank: "p16_1_16",
      shortLabel: `P16 ${n}`,
      oscPrefix: `/outputs/p16/${nn}`,
      headampIndex: null,
      name,
      color: n <= 6 ? "CY" : n <= 9 ? "MG" : n <= 11 ? "YE" : "BL",
      phantom48v: false,
      polarityInvert: false,
      preampGainDb: 0,
      hpfOn: false,
      hpfFreqHz: 80,
      solo: false,
      mute: false,
      faderDb: 0,
      pan: 0,
      meterLevel: -90,
      eqOn: false,
      eqBands: createDefaultEq(false),
      gate: { on: false, threshold: -50, range: 15 },
      comp: { on: false, threshold: -18, ratio: 2.0, attack: 15 },
      busSends: createBusSends(false),
      dcaAssignMask: 0,
      lrAssign: true,
      monoAssign: false,
      insertOn: false,
    });
  });

  return channels;
}

export function formatDb(db: number): string {
  if (db <= -89.5) return "-∞ dB";
  const sign = db > 0 ? "+" : "";
  return `${sign}${db.toFixed(1)} dB`;
}

export function formatDbCompact(db: number): string {
  if (db <= -89.5) return "-∞";
  const sign = db > 0 ? "+" : "";
  return `${sign}${db.toFixed(1)}`;
}

export function faderDbToFraction(db: number): number {
  if (db <= -90) return 0;
  if (db >= 10) return 1;
  if (db >= 0) return 0.75 + (db / 10) * 0.25;
  if (db >= -10) return 0.5 + ((db + 10) / 10) * 0.25;
  if (db >= -30) return 0.25 + ((db + 30) / 20) * 0.25;
  return ((db + 90) / 60) * 0.25;
}

export function fractionToFaderDb(frac: number): number {
  const f = Math.max(0, Math.min(1, frac));
  let db: number;
  if (f >= 0.75) db = ((f - 0.75) / 0.25) * 10;
  else if (f >= 0.5) db = -10 + ((f - 0.5) / 0.25) * 10;
  else if (f >= 0.25) db = -30 + ((f - 0.25) / 0.25) * 20;
  else db = -90 + (f / 0.25) * 60;
  return Math.round(db * 10) / 10;
}

export function faderDbToNormalized(db: number): number {
  const clamped = Math.max(-90, Math.min(10, db));
  if (clamped <= -90) return 0;
  if (clamped <= -60) return ((clamped + 90) / 30) * 0.0625;
  if (clamped <= -30) return 0.0625 + ((clamped + 60) / 30) * 0.1875;
  if (clamped <= -10) return 0.25 + ((clamped + 30) / 20) * 0.25;
  return 0.5 + ((clamped + 10) / 20) * 0.5;
}

export function normalizedToFaderDb(val: number): number {
  const clamped = Math.max(0, Math.min(1, val));
  if (clamped <= 0) return -90;
  if (clamped <= 0.0625) return -90 + (clamped / 0.0625) * 30;
  if (clamped <= 0.25) return -60 + ((clamped - 0.0625) / 0.1875) * 30;
  if (clamped <= 0.5) return -30 + ((clamped - 0.25) / 0.25) * 20;
  return -10 + ((clamped - 0.5) / 0.5) * 20;
}

export function freqToNorm(freq: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.max(0, Math.min(1, (Math.log10(Math.max(20, Math.min(20000, freq))) - minLog) / (maxLog - minLog)));
}

export function normToFreq(norm: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.round(Math.pow(10, minLog + Math.max(0, Math.min(1, norm)) * (maxLog - minLog)));
}

export function biquadDbAtFreq(band: EqBandState, freq: number): number {
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

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

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

export function hpfDbAtFreq(hpfFreq: number, freq: number): number {
  const r = freq / Math.max(20, hpfFreq);
  const r4 = r * r * r * r;
  return 10 * Math.log10(Math.max(1e-8, r4 / (1 + r4)));
}
