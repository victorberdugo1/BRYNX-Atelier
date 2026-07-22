// ============================================================================
// Procedural VFX Lab — Raylib/Emscripten renderer
//
// React owns every widget; this program owns only the canvas. It receives
// JSON effect/param messages from React (see src/lib/wasmBridge.ts) through
// js_set_effect_json(), and reports live stats back through
// js_get_stats_json(). No UI is ever drawn here.
// ============================================================================

#include "raylib.h"
#include "json_mini.h"
#include "video_export.h"
#include "effects/effect_common.h"
#include "effects/ascii_effect.h"
#include "effects/particles_effect.h"
#include "effects/crt_effect.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <emscripten/html5.h>
#endif

// ============================================================================
// STATE
// ============================================================================

static int g_screenW = 1280;
static int g_screenH = 720;
static EffectKind g_activeEffect = EFFECT_ASCII;
static RenderTexture2D g_sceneTarget;
static int g_frameCount = 0;
static double g_lastStatsTime = 0.0;
static float g_lastGpuFrameTimeMs = 0.0f;

// ============================================================================
// PROCEDURAL BASE SCENE
//
// ASCII and CRT post-process whatever is rendered here; Particles ignores it
// and draws directly to the backbuffer since it IS the whole image.
// ============================================================================

// Full-bleed placeholder scene: covers the entire g_screenW x g_screenH area
// edge-to-edge with translucent animated wave bands, mirroring the JS
// mockRenderer.ts paintWaveScene() fix — instead of a shape confined to the
// center (previously 3 concentric circles + a rotating rectangle).
static void DrawWaveBand(int screenW, int screenH, float t, int i, int bands, Color color) {
    const int steps = 32;
    float baseY = screenH * ((i + 0.5f) / bands);
    float amp = screenH * (0.06f + i * 0.01f);
    float phase = t * 0.4f + i * 1.3f;

    Vector2 points[2 * (33)]; // steps + 1, times 2
    int idx = 0;
    for (int s = 0; s <= steps; s++) {
        float x = (screenW * (float)s) / steps;
        float y = baseY + sinf(x * 0.008f + phase) * amp;
        points[idx++] = (Vector2){ x, y };
        points[idx++] = (Vector2){ x, (float)screenH };
    }
    DrawTriangleStrip(points, idx, color);
}

static void DrawBaseScene(void) {
    ClearBackground((Color){ 0, 0, 0, 0 });
    float t = (float)GetTime();

    // Full-canvas vertical gradient background (no centered radial glow).
    DrawRectangleGradientV(0, 0, g_screenW, g_screenH, (Color){ 27, 58, 68, 255 }, (Color){ 11, 11, 14, 255 });

    const int bands = 5;
    for (int i = 0; i < bands; i++) {
        unsigned char alpha = (unsigned char)((0.22f - i * 0.03f) * 255.0f);
        Color c = (Color){ 68, 212, 255, alpha };
        DrawWaveBand(g_screenW, g_screenH, t, i, bands, c);
    }
}

// ============================================================================
// JS BRIDGE — EXPORTED FUNCTIONS
// (Build with -s EXPORTED_FUNCTIONS=['_js_set_effect_json','_js_get_stats_json'])
// ============================================================================

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void js_set_effect_json(const char *json) {
    JsonValue *root = JsonParse(json);
    if (!root) return;

    const char *effectName = JsonAsString(JsonObjectGet(root, "effect"), NULL);
    if (effectName) g_activeEffect = EffectKindFromString(effectName);

    const JsonValue *params = JsonObjectGet(root, "params");
    switch (g_activeEffect) {
        case EFFECT_ASCII:     AsciiEffect_SetParams(params); break;
        case EFFECT_PARTICLES: ParticlesEffect_SetParams(params); break;
        case EFFECT_CRT:       CrtEffect_SetParams(params); break;
        default: break;
    }
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char *js_get_stats_json(void) {
    static char buf[256];
    double now = GetTime();
    double dt = now - g_lastStatsTime;
    g_lastStatsTime = now;
    int fps = GetFPS();

    snprintf(buf, sizeof(buf),
        "{\"fps\":%d,\"resolutionW\":%d,\"resolutionH\":%d,\"frame\":%d,\"effect\":\"%s\",\"gpuFrameTimeMs\":%.2f}",
        fps, g_screenW, g_screenH, g_frameCount, EffectKindToString(g_activeEffect), g_lastGpuFrameTimeMs);
    (void)dt;
    return buf;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void js_start_export(int width, int height, int fps) {
    (void)fps;
    VideoExportStart(width, height);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void js_stop_export(void) {
    VideoExportStop();
}

// ============================================================================
// MAIN LOOP
// ============================================================================

static void UpdateDrawFrame(void) {
    float dt = GetFrameTime();
    double gpuStart = GetTime();

    switch (g_activeEffect) {
        case EFFECT_ASCII:
            BeginTextureMode(g_sceneTarget);
            DrawBaseScene();
            EndTextureMode();

            BeginDrawing();
            AsciiEffect_Update(dt);
            AsciiEffect_Draw(g_sceneTarget, g_screenW, g_screenH);
            EndDrawing();
            break;

        case EFFECT_CRT:
            BeginTextureMode(g_sceneTarget);
            DrawBaseScene();
            EndTextureMode();

            BeginDrawing();
            ClearBackground(BLANK);
            CrtEffect_Update(dt);
            CrtEffect_Draw(g_sceneTarget, g_screenW, g_screenH);
            EndDrawing();
            break;

        case EFFECT_PARTICLES:
            BeginDrawing();
            ParticlesEffect_Update(dt);
            ParticlesEffect_Draw(g_sceneTarget, g_screenW, g_screenH);
            EndDrawing();
            break;

        default:
            break;
    }

    if (VideoExportIsRecording()) {
        VideoExportCaptureFrame();
    }

    g_frameCount++;
    g_lastGpuFrameTimeMs = (float)((GetTime() - gpuStart) * 1000.0);
}

int main(void) {
    // LOG_NONE was silencing raylib's own diagnostics, including the
    // "SHADER: Failed to compile fragment shader" warning LoadShader() emits
    // on failure — which is exactly the kind of failure that leaves
    // g_shaderLoaded false and CrtEffect_Draw() stuck on its no-op fallback.
    // LOG_WARNING keeps the console quiet in the normal case but still
    // surfaces load/compile failures.
    SetTraceLogLevel(LOG_WARNING);
    // Needed so CRT's barrel-clip pixels (alpha=0 in crt.fs) actually read as
    // transparent instead of opaque black — without this flag the canvas'
    // WebGL context has no alpha channel and every ClearBackground(BLANK) or
    // gl_FragColor alpha gets composited as opaque anyway.
    SetConfigFlags(FLAG_WINDOW_TRANSPARENT);
    InitWindow(g_screenW, g_screenH, "Procedural VFX Lab");
    SetTargetFPS(60);

    g_sceneTarget = LoadRenderTexture(g_screenW, g_screenH);
    CrtEffect_Init();
    VideoExportInit();

#ifdef __EMSCRIPTEN__
    emscripten_set_main_loop(UpdateDrawFrame, 0, 1);
#else
    while (!WindowShouldClose()) {
        UpdateDrawFrame();
    }
#endif

    VideoExportCleanup();
    CrtEffect_Unload();
    AsciiEffect_Unload();
    UnloadRenderTexture(g_sceneTarget);
    CloseWindow();
    return 0;
}
