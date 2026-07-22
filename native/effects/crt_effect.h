#ifndef CRT_EFFECT_H
#define CRT_EFFECT_H

#include "raylib.h"
#include "../json_mini.h"

#ifdef __cplusplus
extern "C" {
#endif

// Call once after the OpenGL context exists (post InitWindow) to compile the
// embedded CRT fragment shader (see CRT_FS_SOURCE in crt_effect.c).
void CrtEffect_Init(void);
void CrtEffect_SetParams(const JsonValue *paramsObj);
void CrtEffect_Update(float dt);
void CrtEffect_Draw(RenderTexture2D scene, int screenW, int screenH);
void CrtEffect_Unload(void);

#ifdef __cplusplus
}
#endif

#endif // CRT_EFFECT_H
