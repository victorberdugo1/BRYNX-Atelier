# BRYNX-Atelier

A creative atelier for building real-time visual effects. Craft particles, shaders, and animated effects, then export them as Raylib source code or transparent videos ready for any engine.

A browser-based creative atelier — Figma/VSCode/DaVinci Resolve-style docking editor, with Raylib compiled to WebAssembly doing all rendering inside a single canvas.

## Architecture

Two completely separated layers:

1. **React (`src/`)** owns every widget: top bar, effect library, inspector,
   timeline, code panel, export dialog. It never draws pixels.
2. **Raylib/WASM (`native/`)** owns rendering, camera, simulation and GPU
   drawing inside one `<canvas>`. It never draws a button.

They talk over a flat JSON message:

```json
{ "effect": "ascii", "params": { "contrast": 1.2, "brightness": 0.8, "gamma": 1.1 } }
```

sent by `src/lib/wasmBridge.ts` → `Module.ccall('js_set_effect_json', ...)` →
decoded in `native/main.c` by the arena-based parser in `native/json_mini.c`.

## Quickstart (frontend only)

```bash
npm install
npm run dev
```

The app runs immediately without the WASM renderer: `wasmBridge.ts` detects
that `/wasm/index.js` doesn't exist yet and falls back to
`src/lib/mockRenderer.ts`, a Canvas2D implementation of the same three
effects (ASCII, Particles, CRT) driven by the exact same parameter schema.
This is a reference/preview implementation, not the final visual output.

To get the real Raylib/WASM renderer, you need to either:

- build and run the whole stack with Docker (see below), or
- extract just the pre‑compiled WASM assets from the Docker image with
  `make wasm-assets` (requires Docker) and then run `npm run dev` locally.

## Building the real renderer with Docker

The project comes with a `Makefile` that orchestrates everything via `docker compose`.

**Prerequisites:** Docker and Docker Compose installed.

```bash
# Start all services (frontend + nginx) in detached mode
make up

# Rebuild the frontend image (includes Vite + WASM compilation) and restart
make wasm

# Full rebuild from scratch (no cache)
make wasm-full
```

After starting, the app is served by nginx on `http://localhost` (or the port configured in `docker-compose.yml`).

If you prefer to develop locally but still want the real WASM renderer (without running the full Docker stack), use:

```bash
# Extract compiled WASM files (index.js, index.wasm, index.data) and ffmpeg-core
# into public/wasm/ and public/ffmpeg/ so that `npm run dev` can load them.
make wasm-assets
npm run dev
```

For more commands (logs, shell access, cleanup), run `make help`.

## Project layout

```
src/
  types/effects.ts        Effect + param schema definitions (single source of truth)
  store/useAppStore.ts    Zustand store — active effect, params, viewport, timeline, export
  lib/wasmBridge.ts       JSON bridge to the compiled Module (or mock fallback)
  lib/mockRenderer.ts     Canvas2D preview renderer (dev-time stand-in for native/)
  codegen/                Generates the Code/Shader/JSON/README panel content
  components/
    layout/               TopBar, LeftSidebar, CenterViewport, RightInspector,
                           BottomTimeline, CodePanel, ExportPanel, AppShell
    canvas/ViewportCanvas.tsx
    effects/              EffectThumbnail, ParamField
    ui/                   shadcn-style primitives (button, slider, tabs, ...)
native/
  main.c                  Window setup, JS-exported functions, effect dispatch
  json_mini.c/.h          Allocation-free JSON parser
  effects/                ascii_effect, particles_effect, crt_effect
  assets/shaders/crt.fs   CRT fragment shader
  video_export.js/.h      MediaRecorder + FFmpeg.wasm export pipeline
  Makefile                emsdk + raylib(PLATFORM_WEB) + ffmpeg.wasm build
```

## MVP effects

- **ASCII Renderer** — image → character grid, ramp/font/brightness/contrast/gamma/color/invert
- **Particle System** — count, spawn rate, gravity, lifetime, size + falloff, color, spread
- **CRT** — scanlines, barrel distortion, noise, chromatic aberration, vignette, flicker

## Theme

Dark, VSCode/Figma/Blender-inspired. Accent `#44D4FF`. Tokens live in
`tailwind.config.ts` and `src/index.css`.