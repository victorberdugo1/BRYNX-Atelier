import type { EffectParams, RenderMessage, ViewportOverlayStats, ExportFormat } from "@/types/effects";

/**
 * Contract expected from the compiled native/ Raylib+Emscripten module
 * (see native/main.c). Built with:
 *   -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap']
 *   -s EXPORTED_FUNCTIONS=['_js_set_effect_json','_js_get_stats_json','_main']
 */
interface EmscriptenModule {
  canvas: HTMLCanvasElement;
  onRuntimeInitialized?: () => void;
  ccall: (name: string, ret: string, args: string[], vals: unknown[]) => unknown;
}

declare global {
  interface Window {
    Module?: Partial<EmscriptenModule>;
    VideoExportJS?: {
      startEncoder: (w: number, h: number, fps: number, format?: ExportFormat) => boolean;
      captureFrame: () => Promise<void> | void;
      finishEncoder: (filename: string) => Promise<void>;
      cancelRecording: () => void;
    };
  }
}

type StatsListener = (stats: ViewportOverlayStats) => void;

const WASM_GLUE_PATH = "/wasm/index.js"; // output of native/Makefile, copied into /public/wasm
const VIDEO_EXPORT_PATHS = ["/video_export.js", "/wasm/video_export.js"]; // export helper loaded from public assets

class WasmBridge {
  private module: Partial<EmscriptenModule> | null = null;
  private ready = false;
  private mode: "wasm" | "mock" | "unloaded" = "unloaded";
  private statsListeners = new Set<StatsListener>();
  private pollHandle: number | null = null;
  private exportCaptureHandle: number | null = null;
  private exportActive = false;
  // The Emscripten glue script bootstraps global FS/heap state once per page;
  // loading it a second time (e.g. React StrictMode's mount/unmount/remount,
  // or a second ViewportCanvas instance) throws ErrnoError(20) inside
  // FS.staticInit. Cache the in-flight/resolved attach so it only ever runs
  // once per page load, no matter how many times attach() is called.
  private attachPromise: Promise<"wasm" | "mock"> | null = null;
  // video_export.js only needs a <canvas> in the DOM — it works the same in
  // wasm and mock mode — so it's loaded independently of doAttach()'s
  // wasm/mock branching, and memoized the same way for the same reason.
  private videoExportPromise: Promise<boolean> | null = null;

  get isReady() {
    return this.ready;
  }

  get activeMode() {
    return this.mode;
  }

  async attach(canvas: HTMLCanvasElement): Promise<"wasm" | "mock"> {
    if (this.attachPromise) return this.attachPromise;

    this.attachPromise = this.doAttach(canvas);
    return this.attachPromise;
  }

  private async doAttach(canvas: HTMLCanvasElement): Promise<"wasm" | "mock"> {
    // Fire-and-forget in parallel with the wasm/mock probe below — recording
    // doesn't need to block first paint, but it does need to be requested.
    this.loadVideoExport();

    const glueAvailable = await this.probeGlueScript();
    if (!glueAvailable) {
      this.mode = "mock";
      this.ready = true;
      return "mock";
    }

    return new Promise((resolve) => {
      window.Module = {
        canvas,
        onRuntimeInitialized: () => {
          this.module = window.Module ?? null;
          this.ready = true;
          this.mode = "wasm";
          this.startStatsPolling();
          resolve("wasm");
        },
      };
      const script = document.createElement("script");
      script.src = WASM_GLUE_PATH;
      script.async = true;
      script.onerror = () => {
        this.mode = "mock";
        this.ready = true;
        resolve("mock");
      };
      document.body.appendChild(script);
    });
  }

  private async probeGlueScript(): Promise<boolean> {
    try {
      const res = await fetch(WASM_GLUE_PATH, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Loads video_export.js once per page. Resolves true once window.VideoExportJS is set. */
  private loadVideoExport(): Promise<boolean> {
    if (this.videoExportPromise) return this.videoExportPromise;
    this.videoExportPromise = new Promise((resolve) => {
      if (window.VideoExportJS) {
        resolve(true);
        return;
      }

      const tryLoad = (index: number) => {
        if (index >= VIDEO_EXPORT_PATHS.length) {
          console.error("[wasmBridge] failed to load video export helper — recording is unavailable");
          resolve(false);
          return;
        }
        const script = document.createElement("script");
        script.src = VIDEO_EXPORT_PATHS[index];
        script.onload = () => resolve(!!window.VideoExportJS);
        script.onerror = () => tryLoad(index + 1);
        document.body.appendChild(script);
      };

      tryLoad(0);
    });
    return this.videoExportPromise;
  }

  sendEffect(message: RenderMessage) {
    if (this.mode !== "wasm" || !this.module) return;
    const json = JSON.stringify(message);
    // TEMP DEBUG — confirms exactly what's sent to the wasm module on every
    // param change (e.g. dragging a CRT slider in the inspector). Remove
    // this line once the CRT param issue is confirmed/resolved.
    console.log("[wasmBridge] sendEffect ->", json);
    this.module.ccall?.("js_set_effect_json", "void", ["string"], [json]);
  }

  updateParams(effect: RenderMessage["effect"], params: EffectParams) {
    this.sendEffect({ effect, params });
  }

  async startRecording(width: number, height: number, fps: number, format: ExportFormat): Promise<boolean> {
    const loaded = await this.loadVideoExport();
    if (!loaded || !window.VideoExportJS) {
      console.error("[wasmBridge] startRecording: VideoExportJS is not available");
      return false;
    }
    try {
      window.Module?.ccall?.("js_start_export", "void", ["number", "number", "number"], [width, height, fps]);
    } catch (error) {
      console.warn("[wasmBridge] js_start_export bridge unavailable, continuing with JS-only recording", error);
    }

    const started = window.VideoExportJS.startEncoder(width, height, fps, format);
    if (!started) {
      console.error("[wasmBridge] startRecording: VideoExportJS could not start the recorder");
      return false;
    }

    this.exportActive = true;
    this.startExportCaptureLoop();
    return true;
  }

  private startExportCaptureLoop() {
    if (this.exportCaptureHandle !== null || !this.exportActive) return;
    const tick = () => {
      if (!this.exportActive) {
        this.exportCaptureHandle = null;
        return;
      }
      void window.VideoExportJS?.captureFrame?.();
      this.exportCaptureHandle = requestAnimationFrame(tick);
    };
    this.exportCaptureHandle = requestAnimationFrame(tick);
  }

  private stopExportCaptureLoop() {
    this.exportActive = false;
    if (this.exportCaptureHandle !== null) {
      cancelAnimationFrame(this.exportCaptureHandle);
      this.exportCaptureHandle = null;
    }
  }

  async captureFrame() {
    const loaded = await this.loadVideoExport();
    if (!loaded || !window.VideoExportJS) {
      return;
    }
    await window.VideoExportJS.captureFrame?.();
  }

  async stopRecording(filename: string) {
    const loaded = await this.loadVideoExport();
    if (!loaded || !window.VideoExportJS) {
      console.error("[wasmBridge] stopRecording: VideoExportJS is not available");
      return;
    }
    this.stopExportCaptureLoop();
    try {
      window.Module?.ccall?.("js_stop_export", "void", [], []);
    } catch (error) {
      console.warn("[wasmBridge] js_stop_export bridge unavailable", error);
    }
    await window.VideoExportJS.finishEncoder(filename);
  }

  cancelRecording() {
    this.stopExportCaptureLoop();
    try {
      window.Module?.ccall?.("js_stop_export", "void", [], []);
    } catch (error) {
      console.warn("[wasmBridge] js_stop_export bridge unavailable during cancel", error);
    }
    window.VideoExportJS?.cancelRecording();
  }

  onStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    return () => this.statsListeners.delete(listener);
  }

  emitStats(stats: ViewportOverlayStats) {
    this.statsListeners.forEach((l) => l(stats));
  }

  private startStatsPolling() {
    if (this.pollHandle !== null) return;
    const poll = () => {
      if (this.module?.ccall) {
        try {
          const raw = this.module.ccall("js_get_stats_json", "string", [], []) as string;
          if (raw) this.emitStats(JSON.parse(raw));
        } catch {
          /* module not ready yet for this call */
        }
      }
      this.pollHandle = requestAnimationFrame(poll);
    };
    this.pollHandle = requestAnimationFrame(poll);
  }

  dispose() {
    if (this.pollHandle !== null) cancelAnimationFrame(this.pollHandle);
    if (this.exportCaptureHandle !== null) cancelAnimationFrame(this.exportCaptureHandle);
    this.pollHandle = null;
    this.exportCaptureHandle = null;
    this.exportActive = false;
    this.statsListeners.clear();
  }
}

export const wasmBridge = new WasmBridge();
