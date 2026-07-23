#include "ascii_effect.h"
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

#define ASCII_MAX_RAMP 64

typedef struct {
    char ramp[ASCII_MAX_RAMP];
    int fontSize;
    float brightness;
    float contrast;
    float gamma;
    Color foreground;
    Color background;
    bool invert;
} AsciiParams;

static AsciiParams g_params = {
    .ramp = " .:-=+*#%@",
    .fontSize = 10,
    .brightness = 0.8f,
    .contrast = 1.2f,
    .gamma = 1.1f,
    .foreground = (Color){ 68, 212, 255, 255 },
    .background = (Color){ 11, 11, 14, 0 },
    .invert = false,
};

static Color HexToColor(const char *hex, Color fallback) {
    if (!hex || hex[0] != '#') return fallback;
    size_t len = strlen(hex);
    unsigned int r, g, b, a;
    if (len >= 9) {
        // #RRGGBBAA
        if (sscanf(hex + 1, "%02x%02x%02x%02x", &r, &g, &b, &a) != 4) return fallback;
        return (Color){ (unsigned char)r, (unsigned char)g, (unsigned char)b, (unsigned char)a };
    }
    if (len >= 7) {
        // #RRGGBB — fully opaque
        if (sscanf(hex + 1, "%02x%02x%02x", &r, &g, &b) != 3) return fallback;
        return (Color){ (unsigned char)r, (unsigned char)g, (unsigned char)b, 255 };
    }
    return fallback;
}

void AsciiEffect_SetParams(const JsonValue *paramsObj) {
    if (!paramsObj) return;

    const char *ramp = JsonAsString(JsonObjectGet(paramsObj, "characters"), g_params.ramp);
    strncpy(g_params.ramp, ramp, ASCII_MAX_RAMP - 1);
    g_params.ramp[ASCII_MAX_RAMP - 1] = '\0';

    g_params.fontSize   = (int)JsonAsNumber(JsonObjectGet(paramsObj, "fontSize"), g_params.fontSize);
    g_params.brightness = (float)JsonAsNumber(JsonObjectGet(paramsObj, "brightness"), g_params.brightness);
    g_params.contrast   = (float)JsonAsNumber(JsonObjectGet(paramsObj, "contrast"), g_params.contrast);
    g_params.gamma      = (float)JsonAsNumber(JsonObjectGet(paramsObj, "gamma"), g_params.gamma);
    g_params.invert     = JsonAsBool(JsonObjectGet(paramsObj, "invert"), g_params.invert);
    g_params.foreground = HexToColor(JsonAsString(JsonObjectGet(paramsObj, "foreground"), NULL), g_params.foreground);
    g_params.background = HexToColor(JsonAsString(JsonObjectGet(paramsObj, "background"), NULL), g_params.background);
}

void AsciiEffect_Update(float dt) {
    (void)dt; // ASCII is a pure post-process — no internal simulation state to advance
}

// Downsample target sized to the ASCII grid — reused across frames, only
// reallocated if the grid size changes (font size or resolution change).
// Reading back this tiny texture instead of the full scene avoids a
// full-resolution GPU->CPU sync stall every frame.
//
// The readback itself (LoadImageFromTexture -> rlReadTexturePixels) still
// triggers raylib's known WebGL1 warning from rlUnloadFramebuffer querying
// GL_DEPTH_ATTACHMENT on a colour-only FBO (harmless, but noisy) — that's
// inside vendored raylib, not something fixable here. Throttling how often
// we call it is the only lever available from this file, so the glyph grid
// is only recomputed every ASCII_READBACK_INTERVAL frames and redrawn from
// a cache the rest of the time (imperceptible for a slow-moving background).
#define ASCII_READBACK_INTERVAL 3

static RenderTexture2D g_gridTarget;
static int g_gridCols = 0, g_gridRows = 0;
static char *g_glyphCache = NULL;
static int g_frameCounter = 0;

void AsciiEffect_Draw(RenderTexture2D scene, int screenW, int screenH) {
    int fontSize = g_params.fontSize > 0 ? g_params.fontSize : 10;
    int cols = screenW / fontSize;
    int rows = screenH / fontSize;
    if (cols <= 0 || rows <= 0) return;

    if (cols != g_gridCols || rows != g_gridRows) {
        if (g_gridCols > 0) UnloadRenderTexture(g_gridTarget);
        g_gridTarget = LoadRenderTexture(cols, rows);
        free(g_glyphCache);
        g_glyphCache = (char *)malloc((size_t)(cols * rows));
        memset(g_glyphCache, ' ', (size_t)(cols * rows));
        g_gridCols = cols;
        g_gridRows = rows;
        g_frameCounter = 0; // force a readback this frame
    }

    // Clears to the configured background color/alpha. At alpha 0 (the
    // default) this is identical to the old hardcoded fully-transparent
    // clear — raylib's ClearBackground overwrites the framebuffer's alpha
    // channel too, it doesn't blend, so alpha 0 here means genuinely no
    // background either way.
    ClearBackground(g_params.background);

    if (g_frameCounter % ASCII_READBACK_INTERVAL == 0) {
        BeginTextureMode(g_gridTarget);
        DrawTexturePro(
            scene.texture,
            (Rectangle){ 0, 0, (float)scene.texture.width, -(float)scene.texture.height },
            (Rectangle){ 0, 0, (float)cols, (float)rows },
            (Vector2){ 0, 0 }, 0.0f, WHITE
        );
        EndTextureMode();

        Image img = LoadImageFromTexture(g_gridTarget.texture);

        int rampLen = (int)strlen(g_params.ramp);
        if (rampLen == 0) rampLen = 1;

        for (int y = 0; y < rows; y++) {
            // g_gridTarget is itself a RenderTexture, so reading it back
            // with LoadImageFromTexture inherits the same bottom-up GL
            // framebuffer layout that the earlier DrawTexturePro flip (the
            // negative-height src rect above) exists to compensate for —
            // that flip corrects the scene->grid copy, but this second
            // grid->CPU readback needs its own correction, or the luminance
            // sampled here ends up vertically mirrored relative to what
            // was actually drawn (invisible on the symmetric-ish procedural
            // wave scene, obvious on real video/image content).
            int srcY = rows - 1 - y;
            for (int x = 0; x < cols; x++) {
                Color px = GetImageColor(img, x, srcY);
                float lum = (px.r + px.g + px.b) / (3.0f * 255.0f);
                lum = powf(lum, 1.0f / fmaxf(0.01f, g_params.gamma));
                lum = (lum - 0.5f) * g_params.contrast + 0.5f + (g_params.brightness - 1.0f);
                if (lum < 0) lum = 0;
                if (lum > 1) lum = 1;
                if (g_params.invert) lum = 1.0f - lum;

                int idx = (int)(lum * (rampLen - 1));
                g_glyphCache[y * cols + x] = g_params.ramp[idx];
            }
        }

        UnloadImage(img);
    }
    g_frameCounter++;

    for (int y = 0; y < rows; y++) {
        for (int x = 0; x < cols; x++) {
            char glyph[2] = { g_glyphCache[y * cols + x], '\0' };
            DrawText(glyph, x * fontSize, y * fontSize, fontSize, g_params.foreground);
        }
    }
}

void AsciiEffect_Unload(void) {
    if (g_gridCols > 0) {
        UnloadRenderTexture(g_gridTarget);
        g_gridCols = 0;
        g_gridRows = 0;
    }
    free(g_glyphCache);
    g_glyphCache = NULL;
}
