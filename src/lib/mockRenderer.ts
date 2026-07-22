import type { EffectId, EffectParams, ViewportOverlayStats } from "@/types/effects";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
}

/**
 * Reference preview renderer. This is NOT the final visual output — the compiled
 * Raylib/WASM build (native/) owns rendering — but it mirrors the same param
 * contract so the UI is fully interactive during development, and it doubles as
 * a spec for what native/effects/*.c should reproduce.
 */
export class MockRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private effect: EffectId = "ascii";
  private params: EffectParams = {};
  private particles: Particle[] = [];
  private frame = 0;
  private raf = 0;
  private lastTime = performance.now();
  private fps = 0;
  private onStats?: (s: ViewportOverlayStats) => void;
  private t0 = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
  }

  setStatsListener(fn: (s: ViewportOverlayStats) => void) {
    this.onStats = fn;
  }

  setEffect(effect: EffectId, params: EffectParams) {
    this.effect = effect;
    this.params = params;
    if (effect === "particles") this.particles = [];
  }

  setParams(params: EffectParams) {
    this.params = params;
  }

  start() {
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    const gpuStart = performance.now();
    this.fps = 1 / Math.max(dt, 1 / 240);
    this.lastTime = now;
    this.frame++;

    const w = this.canvas.width;
    const h = this.canvas.height;

    switch (this.effect) {
      case "ascii":
        this.renderAscii(w, h);
        break;
      case "particles":
        this.renderParticles(w, h, dt);
        break;
      case "crt":
        this.renderCrt(w, h, now);
        break;
    }

    const gpuFrameTimeMs = performance.now() - gpuStart;
    this.onStats?.({
      fps: Math.round(this.fps),
      resolutionW: w,
      resolutionH: h,
      frame: this.frame,
      effect: this.effect,
      gpuFrameTimeMs: Math.round(gpuFrameTimeMs * 100) / 100,
    });
  }

  /**
   * Full-bleed placeholder scene: covers the entire canvas resolution edge-to-edge
   * with translucent animated wave bands, instead of a shape confined to the center.
   */
  private paintWaveScene(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
    bandColor: string,
  ) {
    const bands = 5;
    const steps = 32;
    ctx.save();
    ctx.fillStyle = bandColor;
    for (let i = 0; i < bands; i++) {
      const phase = t * 0.0002 + i * 1.3;
      const baseY = h * ((i + 0.5) / bands);
      const amp = h * (0.06 + i * 0.01);
      ctx.globalAlpha = 0.22 - i * 0.03;
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, baseY + Math.sin(phase) * amp);
      for (let s = 1; s <= steps; s++) {
        const x = (w * s) / steps;
        const y = baseY + Math.sin(x * 0.008 + phase) * amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private baseScene(w: number, h: number, t: number) {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#1b3a44");
    grad.addColorStop(1, "#0b0b0e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    this.paintWaveScene(ctx, w, h, t, "#44D4FF");
  }

  private renderAscii(w: number, h: number) {
    const ctx = this.ctx;
    const ramp = String(this.params.characters ?? " .:-=+*#%@");
    const fontSize = Number(this.params.fontSize ?? 10);
    const brightness = Number(this.params.brightness ?? 0.8);
    const contrast = Number(this.params.contrast ?? 1.2);
    const gamma = Number(this.params.gamma ?? 1.1);
    const fg = String(this.params.foreground ?? "#44D4FF");
    const bg = String(this.params.background ?? "#0B0B0E");
    const invert = Boolean(this.params.invert ?? false);

    // render scene at low res, then sample luminance per cell
    const cols = Math.max(1, Math.floor(w / fontSize));
    const rows = Math.max(1, Math.floor(h / fontSize));

    const off = document.createElement("canvas");
    off.width = cols;
    off.height = rows;
    const octx = off.getContext("2d")!;
    const t = performance.now();
    const grad = octx.createLinearGradient(0, 0, cols, rows);
    grad.addColorStop(0, "#3a3a3a");
    grad.addColorStop(1, "#000000");
    octx.fillStyle = grad;
    octx.fillRect(0, 0, cols, rows);
    this.paintWaveScene(octx, cols, rows, t, "#ffffff");

    const img = octx.getImageData(0, 0, cols, rows).data;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
    ctx.textBaseline = "top";

    for (let y = 0; y < rows; y++) {
      let line = "";
      for (let x = 0; x < cols; x++) {
        const idx = (y * cols + x) * 4;
        let lum = (img[idx] + img[idx + 1] + img[idx + 2]) / (3 * 255);
        lum = Math.pow(lum, 1 / Math.max(0.01, gamma));
        lum = (lum - 0.5) * contrast + 0.5 + (brightness - 1);
        lum = Math.min(1, Math.max(0, lum));
        if (invert) lum = 1 - lum;
        const charIdx = Math.floor(lum * (ramp.length - 1));
        line += ramp[charIdx] ?? " ";
      }
      ctx.fillText(line, 0, y * fontSize);
    }
  }

  private renderParticles(w: number, h: number, dt: number) {
    const ctx = this.ctx;
    const count = Number(this.params.count ?? 2000);
    const spawnRate = Number(this.params.spawnRate ?? 120);
    const gravity = Number(this.params.gravity ?? 9.8);
    const lifetime = Number(this.params.lifetime ?? 2.5);
    const size = Number(this.params.size ?? 4);
    const sizeFalloff = Number(this.params.sizeFalloff ?? 0.6);
    const color = String(this.params.color ?? "#44D4FF");
    const spread = (Number(this.params.spread ?? 45) * Math.PI) / 180;

    const toSpawn = Math.min(count - this.particles.length, Math.round(spawnRate * dt));
    for (let i = 0; i < toSpawn; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const speed = 60 + Math.random() * 120;
      this.particles.push({
        x: w / 2,
        y: h * 0.8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        lifetime: lifetime * (0.6 + Math.random() * 0.4),
      });
    }

    ctx.fillStyle = "#0b0b0e";
    ctx.fillRect(0, 0, w, h);

    this.particles = this.particles.filter((p) => p.age < p.lifetime);
    ctx.fillStyle = color;
    for (const p of this.particles) {
      p.age += dt;
      p.vy += gravity * dt * 20;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const lifeRatio = 1 - p.age / p.lifetime;
      const r = Math.max(0.2, size * (1 - sizeFalloff * (1 - lifeRatio)));
      ctx.globalAlpha = Math.max(0, lifeRatio);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.particles.length > count) this.particles.length = count;
  }

  private renderCrt(w: number, h: number, t: number) {
    const ctx = this.ctx;
    this.baseScene(w, h, t);

    const scanlineIntensity = Number(this.params.scanlineIntensity ?? 0.35);
    const scanlineCount = Number(this.params.scanlineCount ?? 480);
    const noise = Number(this.params.noise ?? 0.05);
    const vignette = Number(this.params.vignette ?? 0.3);
    const flicker = Number(this.params.flicker ?? 0.1);
    const aberration = Number(this.params.chromaticAberration ?? 0.4);

    // crude chromatic aberration via offset composite copies
    if (aberration > 0.01) {
      const snapshot = ctx.getImageData(0, 0, w, h);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.5;
      ctx.putImageData(snapshot, 0, 0);
      ctx.drawImage(this.canvas, -aberration, 0);
      ctx.drawImage(this.canvas, aberration, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }

    // scanlines
    const step = Math.max(1, h / scanlineCount);
    ctx.fillStyle = `rgba(0,0,0,${scanlineIntensity})`;
    for (let y = 0; y < h; y += step * 2) {
      ctx.fillRect(0, y, w, step);
    }

    // noise
    if (noise > 0.001) {
      const n = Math.floor(noise * 400);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < n; i++) {
        ctx.globalAlpha = Math.random() * noise;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    // vignette — darkens toward each edge independently (rectangular falloff)
    // instead of a centered radial halo, so the effect reads as covering the
    // full canvas resolution rather than a glowing circle in the middle.
    if (vignette > 0.001) {
      ctx.save();
      const edges: Array<[number, number, number, number]> = [
        [0, 0, w * 0.35, 0], // left
        [w, 0, w * 0.65, 0], // right
        [0, 0, 0, h * 0.35], // top
        [0, h, 0, h * 0.65], // bottom
      ];
      for (const [x0, y0, x1, y1] of edges) {
        const edgeGrad = ctx.createLinearGradient(x0, y0, x1, y1);
        edgeGrad.addColorStop(0, `rgba(0,0,0,${vignette})`);
        edgeGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = edgeGrad;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    }

    // flicker
    if (flicker > 0.001) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * flicker * 0.15})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
