#ifndef PARTICLES_EFFECT_H
#define PARTICLES_EFFECT_H

#include "raylib.h"
#include "../json_mini.h"

#ifdef __cplusplus
extern "C" {
#endif

void ParticlesEffect_SetParams(const JsonValue *paramsObj);
void ParticlesEffect_Update(float dt);
void ParticlesEffect_Draw(RenderTexture2D scene, int screenW, int screenH);

#ifdef __cplusplus
}
#endif

#endif // PARTICLES_EFFECT_H
