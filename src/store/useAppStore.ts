import { create } from "zustand";
import {
  defaultParamsFor,
  type EffectId,
  type EffectParams,
  type ExportFormat,
  type ExportJobState,
  type ViewportOverlayStats,
} from "@/types/effects";

export type ZoomMode = "fit" | "50" | "100" | "200";
export type MobileTab = "preview" | "parameters" | "code" | "export";
export type CodeTab = "code" | "shader" | "json" | "readme";

interface TimelineState {
  playing: boolean;
  currentFrame: number;
  durationSeconds: number;
  fps: number;
}

interface AppState {
  activeEffect: EffectId;
  paramsByEffect: Record<EffectId, EffectParams>;

  zoom: ZoomMode;
  pan: { x: number; y: number };
  stats: ViewportOverlayStats;

  timeline: TimelineState;

  codeTab: CodeTab;
  mobileTab: MobileTab;

  exportJob: ExportJobState;

  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;

  setActiveEffect: (effect: EffectId) => void;
  setParam: (effect: EffectId, key: string, value: EffectParams[string]) => void;
  resetParams: (effect: EffectId) => void;

  setZoom: (z: ZoomMode) => void;
  setPan: (p: { x: number; y: number }) => void;
  setStats: (s: ViewportOverlayStats) => void;

  togglePlay: () => void;
  setPlaying: (v: boolean) => void;
  setCurrentFrame: (f: number) => void;
  restartTimeline: () => void;

  setCodeTab: (t: CodeTab) => void;
  setMobileTab: (t: MobileTab) => void;

  startExport: (format: ExportFormat, totalFrames: number) => void;
  updateExportProgress: (currentFrame: number, etaSeconds: number) => void;
  finishExport: () => void;
  cancelExport: () => void;

  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  toggleBottomPanel: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeEffect: "ascii",
  paramsByEffect: {
    ascii: defaultParamsFor("ascii"),
    particles: defaultParamsFor("particles"),
    crt: defaultParamsFor("crt"),
  },

  zoom: "fit",
  pan: { x: 0, y: 0 },
  stats: { fps: 0, resolutionW: 0, resolutionH: 0, frame: 0, effect: "ascii", gpuFrameTimeMs: 0 },

  timeline: { playing: true, currentFrame: 0, durationSeconds: 10, fps: 60 },

  codeTab: "code",
  mobileTab: "preview",

  exportJob: { running: false, format: "mp4", progress: 0, currentFrame: 0, totalFrames: 0, etaSeconds: 0 },

  leftSidebarOpen: true,
  rightPanelOpen: true,
  bottomPanelOpen: true,

  setActiveEffect: (effect) => set({ activeEffect: effect }),

  setParam: (effect, key, value) =>
    set((s) => ({
      paramsByEffect: {
        ...s.paramsByEffect,
        [effect]: { ...s.paramsByEffect[effect], [key]: value },
      },
    })),

  resetParams: (effect) =>
    set((s) => ({
      paramsByEffect: { ...s.paramsByEffect, [effect]: defaultParamsFor(effect) },
    })),

  setZoom: (z) => set({ zoom: z }),
  setPan: (p) => set({ pan: p }),
  setStats: (stats) => set({ stats }),

  togglePlay: () => set((s) => ({ timeline: { ...s.timeline, playing: !s.timeline.playing } })),
  setPlaying: (v) => set((s) => ({ timeline: { ...s.timeline, playing: v } })),
  setCurrentFrame: (f) => set((s) => ({ timeline: { ...s.timeline, currentFrame: f } })),
  restartTimeline: () => set((s) => ({ timeline: { ...s.timeline, currentFrame: 0 } })),

  setCodeTab: (t) => set({ codeTab: t }),
  setMobileTab: (t) => set({ mobileTab: t }),

  startExport: (format, totalFrames) =>
    set({ exportJob: { running: true, format, progress: 0, currentFrame: 0, totalFrames, etaSeconds: 0 } }),
  updateExportProgress: (currentFrame, etaSeconds) =>
    set((s) => ({
      exportJob: {
        ...s.exportJob,
        currentFrame,
        etaSeconds,
        progress: s.exportJob.totalFrames > 0 ? currentFrame / s.exportJob.totalFrames : 0,
      },
    })),
  finishExport: () => set((s) => ({ exportJob: { ...s.exportJob, running: false, progress: 1 } })),
  cancelExport: () =>
    set((s) => ({ exportJob: { ...s.exportJob, running: false, error: "Cancelled by user" } })),

  toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
}));

export function useActiveParams() {
  const activeEffect = useAppStore((s) => s.activeEffect);
  return useAppStore((s) => s.paramsByEffect[activeEffect]);
}
