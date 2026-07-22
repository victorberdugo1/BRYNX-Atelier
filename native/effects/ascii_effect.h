#ifndef ASCII_EFFECT_H
#define ASCII_EFFECT_H

#include "raylib.h"
#include "../json_mini.h"

#ifdef __cplusplus
extern "C" {
#endif

void AsciiEffect_SetParams(const JsonValue *paramsObj);
void AsciiEffect_Update(float dt);
void AsciiEffect_Draw(RenderTexture2D scene, int screenW, int screenH);
void AsciiEffect_Unload(void);

#ifdef __cplusplus
}
#endif

#endif // ASCII_EFFECT_H
