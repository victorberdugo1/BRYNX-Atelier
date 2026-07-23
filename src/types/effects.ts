export type EffectId = "ascii" | "particles" | "crt";

export type ParamType = "float" | "int" | "bool" | "color" | "string" | "select";

export interface ParamSchema {
  key: string;
  label: string;
  type: ParamType;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  group?: string;
  /** Only meaningful for type: "color" — when true, the value is an 8-digit
   * #RRGGBBAA hex string (with an alpha slider in the UI) instead of the
   * plain 6-digit #RRGGBB. */
  alpha?: boolean;
}

export interface EffectDefinition {
  id: EffectId;
  name: string;
  description: string;
  params: ParamSchema[];
}

export type EffectParamValue = number | boolean | string;
export type EffectParams = Record<string, EffectParamValue>;

export interface RenderMessage {
  effect: EffectId;
  params: EffectParams;
}

export interface ViewportOverlayStats {
  fps: number;
  resolutionW: number;
  resolutionH: number;
  frame: number;
  effect: EffectId;
  gpuFrameTimeMs: number;
}

export type ExportFormat = "mp4" | "webm" | "png-sequence" | "mov-alpha";

export interface ExportJobState {
  running: boolean;
  format: ExportFormat;
  progress: number; // 0..1
  currentFrame: number;
  totalFrames: number;
  etaSeconds: number;
  error?: string;
}

export const ASCII_EFFECT: EffectDefinition = {
  id: "ascii",
  name: "ASCII Renderer",
  description: "Converts the rendered frame into a live ASCII character grid.",
  params: [
    { key: "characters", label: "Characters", type: "string", default: " .:-=+*#%@", group: "Ramp" },
    { key: "fontSize", label: "Font", type: "int", default: 10, min: 4, max: 32, step: 1, group: "Ramp" },
    { key: "brightness", label: "Brightness", type: "float", default: 0.8, min: 0, max: 2, step: 0.01, group: "Image" },
    { key: "contrast", label: "Contrast", type: "float", default: 1.2, min: 0, max: 3, step: 0.01, group: "Image" },
    { key: "gamma", label: "Gamma", type: "float", default: 1.1, min: 0.2, max: 3, step: 0.01, group: "Image" },
    { key: "foreground", label: "Foreground Color", type: "color", default: "#44D4FF", group: "Color" },
    { key: "background", label: "Background Color", type: "color", default: "#0B0B0E00", alpha: true, group: "Color" },
    { key: "invert", label: "Invert", type: "bool", default: false, group: "Color" },
  ],
};

export const PARTICLES_EFFECT: EffectDefinition = {
  id: "particles",
  name: "Particle System",
  description: "GPU-driven particle emitter with gravity, lifetime and size falloff.",
  params: [
    { key: "count", label: "Particle Count", type: "int", default: 2000, min: 10, max: 20000, step: 10, group: "Emission" },
    { key: "spawnRate", label: "Spawn Rate", type: "float", default: 120, min: 0, max: 2000, step: 1, group: "Emission" },
    { key: "gravity", label: "Gravity", type: "float", default: 9.8, min: -50, max: 50, step: 0.1, group: "Physics" },
    { key: "lifetime", label: "Lifetime", type: "float", default: 2.5, min: 0.1, max: 20, step: 0.1, group: "Physics" },
    { key: "size", label: "Size", type: "float", default: 4, min: 0.5, max: 40, step: 0.1, group: "Appearance" },
    { key: "sizeFalloff", label: "Size Falloff", type: "float", default: 0.6, min: 0, max: 1, step: 0.01, group: "Appearance" },
    { key: "color", label: "Color", type: "color", default: "#44D4FF", group: "Appearance" },
    { key: "spread", label: "Spread (deg)", type: "float", default: 45, min: 0, max: 360, step: 1, group: "Emission" },
  ],
};

export const CRT_EFFECT: EffectDefinition = {
  id: "crt",
  name: "CRT",
  description: "Scanlines, barrel distortion, noise and chromatic aberration shader stack.",
  params: [
    { key: "scanlineIntensity", label: "Scanlines", type: "float", default: 0.35, min: 0, max: 1, step: 0.01, group: "Scanlines" },
    { key: "scanlineCount", label: "Scanline Density", type: "int", default: 480, min: 60, max: 1080, step: 1, group: "Scanlines" },
    { key: "scanlineSpeed", label: "Scanline Scroll", type: "float", default: 0, min: -1, max: 1, step: 0.01, group: "Scanlines" },
    { key: "curvature", label: "Barrel Distortion", type: "float", default: 0.15, min: 0, max: 1, step: 0.01, group: "Geometry" },
    { key: "vignette", label: "Vignette", type: "float", default: 0.3, min: 0, max: 1, step: 0.01, group: "Geometry" },
    { key: "noise", label: "Noise", type: "float", default: 0.05, min: 0, max: 1, step: 0.01, group: "Signal" },
    { key: "chromaticAberration", label: "Chromatic Aberration", type: "float", default: 0.4, min: 0, max: 5, step: 0.05, group: "Signal" },
    { key: "flicker", label: "Flicker", type: "float", default: 0.1, min: 0, max: 1, step: 0.01, group: "Signal" },
  ],
};

export const EFFECT_DEFINITIONS: Record<EffectId, EffectDefinition> = {
  ascii: ASCII_EFFECT,
  particles: PARTICLES_EFFECT,
  crt: CRT_EFFECT,
};

export function defaultParamsFor(effect: EffectId): EffectParams {
  const out: EffectParams = {};
  for (const p of EFFECT_DEFINITIONS[effect].params) out[p.key] = p.default;
  return out;
}
