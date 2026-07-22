#include "crt_effect.h"
#include <string.h>

typedef struct {
    float scanlineIntensity;
    float scanlineCount;
    float curvature;
    float vignette;
    float noise;
    float chromaticAberration;
    float flicker;
} CrtParams;

static CrtParams g_params = {
    .scanlineIntensity = 0.35f,
    .scanlineCount = 480.0f,
    .curvature = 0.15f,
    .vignette = 0.3f,
    .noise = 0.05f,
    .chromaticAberration = 0.4f,
    .flicker = 0.1f,
};

static Shader g_shader;
static bool g_shaderLoaded = false;
static float g_time = 0.0f;

// Uniform locations, cached after LoadShaderFromMemory.
static int g_locTime, g_locScanlineIntensity, g_locScanlineCount, g_locCurvature;
static int g_locVignette, g_locNoise, g_locAberration, g_locFlicker;

// Embedded verbatim from assets/shaders/crt.fs. Loaded from memory instead of
// LoadShader(NULL, "assets/shaders/crt.fs") on purpose: that path depends on
// the Emscripten --preload-file package (index.data) being fetched correctly
// at runtime. If a proxy/dev-server ever answers that request with the SPA's
// index.html instead of a real 404 (wrong route config, stale build, etc.),
// LoadShader happily hands raylib "<!doctype html>..." as GLSL source, and
// you get a baffling "'<' : syntax error" compile failure that looks like a
// shader bug but is actually a routing/serving bug. Embedding the source
// removes that whole failure class — no fetch, no preload, no possible 404.
// Keep assets/shaders/crt.fs in sync; it's kept as the readable reference
// copy (and what the Code Panel's "Shader" tab mirrors) but is no longer
// read at runtime.
static const char *CRT_FS_SOURCE =
    "#version 100\n"
    "precision mediump float;\n"
    "\n"
    "varying vec2 fragTexCoord;\n"
    "varying vec4 fragColor;\n"
    "\n"
    "uniform sampler2D texture0;\n"
    "uniform float uTime;\n"
    "uniform float uScanlineIntensity;\n"
    "uniform float uScanlineCount;\n"
    "uniform float uCurvature;\n"
    "uniform float uVignette;\n"
    "uniform float uNoise;\n"
    "uniform float uAberration;\n"
    "uniform float uFlicker;\n"
    "\n"
    "float rand(vec2 co) {\n"
    "    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);\n"
    "}\n"
    "\n"
    "vec2 barrel(vec2 uv, float amount) {\n"
    "    vec2 cc = uv - 0.5;\n"
    "    float dist = dot(cc, cc);\n"
    "    return uv + cc * dist * amount;\n"
    "}\n"
    "\n"
    "void main() {\n"
    "    vec2 uv = barrel(fragTexCoord, uCurvature);\n"
    "\n"
    "    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {\n"
    "        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);\n"
    "        return;\n"
    "    }\n"
    "\n"
    "    float ab = uAberration * 0.002;\n"
    "    float r = texture2D(texture0, uv + vec2(ab, 0.0)).r;\n"
    "    vec4 centerSample = texture2D(texture0, uv);\n"
    "    float g = centerSample.g;\n"
    "    float b = texture2D(texture0, uv - vec2(ab, 0.0)).b;\n"
    "    vec3 color = vec3(r, g, b);\n"
    "    float srcAlpha = centerSample.a;\n"
    "\n"
    "    float scan = sin(uv.y * uScanlineCount * 3.14159) * 0.5 + 0.5;\n"
    "    color *= mix(1.0, scan, uScanlineIntensity);\n"
    "\n"
    "    float n = (rand(uv * uTime) - 0.5) * uNoise;\n"
    "    color += n;\n"
    "\n"
    "    float d = distance(uv, vec2(0.5));\n"
    "    color *= mix(1.0, 1.0 - d, uVignette);\n"
    "\n"
    "    color += rand(vec2(uTime, 0.0)) * uFlicker * 0.1;\n"
    "\n"
    "    gl_FragColor = vec4(color, srcAlpha);\n"
    "}\n";

void CrtEffect_Init(void) {
    g_shader = LoadShaderFromMemory(NULL, CRT_FS_SOURCE);
    g_shaderLoaded = (g_shader.id != 0);
    TraceLog(g_shaderLoaded ? LOG_INFO : LOG_WARNING,
        "[CrtEffect] embedded crt.fs %s (shader id=%d) — %s",
        g_shaderLoaded ? "compiled" : "FAILED to compile",
        g_shader.id,
        g_shaderLoaded ? "sliders will drive the shader" : "falling back to raw scene, sliders will have no visible effect");

    g_locTime               = GetShaderLocation(g_shader, "uTime");
    g_locScanlineIntensity  = GetShaderLocation(g_shader, "uScanlineIntensity");
    g_locScanlineCount      = GetShaderLocation(g_shader, "uScanlineCount");
    g_locCurvature          = GetShaderLocation(g_shader, "uCurvature");
    g_locVignette           = GetShaderLocation(g_shader, "uVignette");
    g_locNoise              = GetShaderLocation(g_shader, "uNoise");
    g_locAberration         = GetShaderLocation(g_shader, "uAberration");
    g_locFlicker            = GetShaderLocation(g_shader, "uFlicker");
}

void CrtEffect_SetParams(const JsonValue *paramsObj) {
    if (!paramsObj) return;
    g_params.scanlineIntensity  = (float)JsonAsNumber(JsonObjectGet(paramsObj, "scanlineIntensity"), g_params.scanlineIntensity);
    g_params.scanlineCount      = (float)JsonAsNumber(JsonObjectGet(paramsObj, "scanlineCount"), g_params.scanlineCount);
    g_params.curvature          = (float)JsonAsNumber(JsonObjectGet(paramsObj, "curvature"), g_params.curvature);
    g_params.vignette           = (float)JsonAsNumber(JsonObjectGet(paramsObj, "vignette"), g_params.vignette);
    g_params.noise              = (float)JsonAsNumber(JsonObjectGet(paramsObj, "noise"), g_params.noise);
    g_params.chromaticAberration = (float)JsonAsNumber(JsonObjectGet(paramsObj, "chromaticAberration"), g_params.chromaticAberration);
    g_params.flicker            = (float)JsonAsNumber(JsonObjectGet(paramsObj, "flicker"), g_params.flicker);
}

void CrtEffect_Update(float dt) {
    g_time += dt;
}

void CrtEffect_Draw(RenderTexture2D scene, int screenW, int screenH) {
    if (!g_shaderLoaded) {
        // Fallback so the app still renders something if crt.fs failed to load
        // (e.g. asset not copied into the build) instead of a black screen.
        DrawTextureRec(
            scene.texture,
            (Rectangle){ 0, 0, (float)scene.texture.width, -(float)scene.texture.height },
            (Vector2){ 0, 0 },
            WHITE
        );
        return;
    }

    SetShaderValue(g_shader, g_locTime, &g_time, SHADER_UNIFORM_FLOAT);
    SetShaderValue(g_shader, g_locScanlineIntensity, &g_params.scanlineIntensity, SHADER_UNIFORM_FLOAT);
    SetShaderValue(g_shader, g_locScanlineCount, &g_params.scanlineCount, SHADER_UNIFORM_FLOAT);
    SetShaderValue(g_shader, g_locCurvature, &g_params.curvature, SHADER_UNIFORM_FLOAT);
    SetShaderValue(g_shader, g_locVignette, &g_params.vignette, SHADER_UNIFORM_FLOAT);
    SetShaderValue(g_shader, g_locNoise, &g_params.noise, SHADER_UNIFORM_FLOAT);
    SetShaderValue(g_shader, g_locAberration, &g_params.chromaticAberration, SHADER_UNIFORM_FLOAT);
    SetShaderValue(g_shader, g_locFlicker, &g_params.flicker, SHADER_UNIFORM_FLOAT);

    BeginShaderMode(g_shader);
    DrawTextureRec(
        scene.texture,
        (Rectangle){ 0, 0, (float)scene.texture.width, -(float)scene.texture.height },
        (Vector2){ 0, 0 },
        (Color){ 255, 255, 255, 255 }
    );
    EndShaderMode();
    (void)screenW;
    (void)screenH;
}

void CrtEffect_Unload(void) {
    if (g_shaderLoaded) UnloadShader(g_shader);
    g_shaderLoaded = false;
}
