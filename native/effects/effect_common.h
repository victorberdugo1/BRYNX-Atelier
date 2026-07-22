#ifndef EFFECT_COMMON_H
#define EFFECT_COMMON_H

#include <string.h>
#include "raylib.h"
#include "../json_mini.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    EFFECT_ASCII,
    EFFECT_PARTICLES,
    EFFECT_CRT,
    EFFECT_COUNT
} EffectKind;

static inline EffectKind EffectKindFromString(const char *name) {
    if (!name) return EFFECT_ASCII;
    if (strcmp(name, "particles") == 0) return EFFECT_PARTICLES;
    if (strcmp(name, "crt") == 0) return EFFECT_CRT;
    return EFFECT_ASCII;
}

static inline const char *EffectKindToString(EffectKind kind) {
    switch (kind) {
        case EFFECT_PARTICLES: return "particles";
        case EFFECT_CRT: return "crt";
        default: return "ascii";
    }
}

// Every effect module (ascii_effect.c, particles_effect.c, crt_effect.c)
// implements these three entry points with this exact signature so
// native/main.c can dispatch through a plain switch without needing a vtable:
//
//   void <Name>Effect_SetParams(const JsonValue *paramsObj);
//   void <Name>Effect_Update(float dt);
//   void <Name>Effect_Draw(RenderTexture2D scene, int screenW, int screenH);

#ifdef __cplusplus
}
#endif

#endif // EFFECT_COMMON_H
