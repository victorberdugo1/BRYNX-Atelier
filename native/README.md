# Native Renderer (Raylib + Emscripten)

This directory is the entire rendering layer. React never draws into the
canvas — it only sends JSON over the bridge in `src/lib/wasmBridge.ts`.

## Files

| File | Purpose |
|---|---|
| `main.c` | Window/render-texture setup, JS-exported functions, main loop, effect dispatch |
| `json_mini.h/.c` | Allocation-free JSON parser for decoding `{effect, params}` messages |
| `effects/effect_common.h` | Shared `EffectKind` enum + naming convention every effect module follows |
| `effects/ascii_effect.c/.h` | Image → ASCII character grid |
| `effects/particles_effect.c/.h` | Fixed-pool particle simulation (gravity, lifetime, size falloff) |
| `effects/crt_effect.c/.h` | Drives `assets/shaders/crt.fs` (scanlines, barrel distortion, noise, chromatic aberration) |
| `video_export.js/.h` | MediaRecorder + FFmpeg.wasm capture/encode pipeline (reused from the chess_viewer reference project) |
| `shell.html` | Emscripten HTML shell — canvas + loading overlay, no UI widgets |
| `Makefile` | emsdk + raylib(PLATFORM_WEB) + ffmpeg.wasm bootstrap and build |

## Message contract

React calls (via `Module.ccall`):

```c
void js_set_effect_json(const char *json);   // { "effect": "ascii", "params": { ... } }
const char *js_get_stats_json(void);         // { "fps", "resolutionW", "resolutionH", "frame", "effect", "gpuFrameTimeMs" }
```

Both are declared `EMSCRIPTEN_KEEPALIVE` in `main.c` and listed in the
Makefile's `EXPORTED_FUNCTIONS`.

## Build

First build (installs emsdk + raylib — takes a while, several GB of disk):

```bash
cd native
make raylib   # clones/builds emsdk + raylib for PLATFORM_WEB
make ffmpeg   # fetches precompiled ffmpeg.wasm
make          # compiles index.html/js/wasm via emcc
make run      # serves on http://localhost:8000 for a standalone check
```

## Wire it into the Vite app

```bash
make copy     # copies index.js/.wasm + video_export.js into ../public/wasm/
```

`wasmBridge.ts` probes `/wasm/index.js` on startup; if present, it loads the
real renderer. If absent, the app runs on the Canvas2D preview in
`src/lib/mockRenderer.ts`, which mirrors the same three effects and the same
parameter contract so the UI is fully interactive either way.

## Adding a fourth effect

1. Add its `EffectId` + `ParamSchema[]` in `src/types/effects.ts` (drives the
   Inspector, Code panel, and mock renderer automatically).
2. Add the enum value in `effects/effect_common.h`.
3. Add `effects/<name>_effect.c/.h` implementing `SetParams` / `Update` / `Draw`.
4. Dispatch it in `main.c`'s `js_set_effect_json` switch and `UpdateDrawFrame`.
5. Add its source file to `SRC` in the `Makefile`.
