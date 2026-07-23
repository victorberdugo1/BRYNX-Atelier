#include "particles_effect.h"
#include <math.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#define PARTICLES_MAX 20000

typedef struct {
    Vector2 position;
    Vector2 velocity;
    float age;
    float lifetime;
    bool alive;
} Particle;

typedef struct {
    int count;
    float spawnRate;
    float gravity;
    float lifetime;
    float size;
    float sizeFalloff;
    Color color;
    float spreadDeg;
    float spawnX; // normalized 0..1, fraction of screenW
    float spawnY; // normalized 0..1, fraction of screenH
} ParticleParams;

static ParticleParams g_params = {
    .count = 2000,
    .spawnRate = 120.0f,
    .gravity = 9.8f,
    .lifetime = 2.5f,
    .size = 4.0f,
    .sizeFalloff = 0.6f,
    .color = (Color){ 68, 212, 255, 255 },
    .spreadDeg = 45.0f,
    .spawnX = 0.5f,
    .spawnY = 0.8f,
};

static Particle g_pool[PARTICLES_MAX];
static int g_aliveCount = 0;
static float g_spawnAccumulator = 0.0f;

static Color HexToColor(const char *hex, Color fallback) {
    if (!hex || hex[0] != '#' || strlen(hex) < 7) return fallback;
    unsigned int r, g, b;
    if (sscanf(hex + 1, "%02x%02x%02x", &r, &g, &b) != 3) return fallback;
    return (Color){ (unsigned char)r, (unsigned char)g, (unsigned char)b, 255 };
}

void ParticlesEffect_SetParams(const JsonValue *paramsObj) {
    if (!paramsObj) return;
    int newCount = (int)JsonAsNumber(JsonObjectGet(paramsObj, "count"), g_params.count);
    g_params.count       = newCount > PARTICLES_MAX ? PARTICLES_MAX : newCount;
    g_params.spawnRate   = (float)JsonAsNumber(JsonObjectGet(paramsObj, "spawnRate"), g_params.spawnRate);
    g_params.gravity     = (float)JsonAsNumber(JsonObjectGet(paramsObj, "gravity"), g_params.gravity);
    g_params.lifetime    = (float)JsonAsNumber(JsonObjectGet(paramsObj, "lifetime"), g_params.lifetime);
    g_params.size        = (float)JsonAsNumber(JsonObjectGet(paramsObj, "size"), g_params.size);
    g_params.sizeFalloff = (float)JsonAsNumber(JsonObjectGet(paramsObj, "sizeFalloff"), g_params.sizeFalloff);
    g_params.spreadDeg   = (float)JsonAsNumber(JsonObjectGet(paramsObj, "spread"), g_params.spreadDeg);
    g_params.color       = HexToColor(JsonAsString(JsonObjectGet(paramsObj, "color"), NULL), g_params.color);
    g_params.spawnX      = (float)JsonAsNumber(JsonObjectGet(paramsObj, "spawnX"), g_params.spawnX);
    g_params.spawnY      = (float)JsonAsNumber(JsonObjectGet(paramsObj, "spawnY"), g_params.spawnY);
}

static void SpawnParticle(int screenW, int screenH) {
    if (g_aliveCount >= g_params.count || g_aliveCount >= PARTICLES_MAX) return;

    float spreadRad = g_params.spreadDeg * DEG2RAD;
    float angle = -PI / 2.0f + ((float)rand() / RAND_MAX - 0.5f) * spreadRad;
    float speed = 60.0f + ((float)rand() / RAND_MAX) * 120.0f;

    Particle *p = &g_pool[g_aliveCount++];
    p->position = (Vector2){ g_params.spawnX * screenW, g_params.spawnY * screenH };
    p->velocity = (Vector2){ cosf(angle) * speed, sinf(angle) * speed };
    p->age = 0.0f;
    p->lifetime = g_params.lifetime * (0.6f + ((float)rand() / RAND_MAX) * 0.4f);
    p->alive = true;
}

void ParticlesEffect_Update(float dt) {
    // compaction pass — remove dead particles by swapping with the tail
    for (int i = 0; i < g_aliveCount; i++) {
        Particle *p = &g_pool[i];
        p->age += dt;
        if (p->age >= p->lifetime) {
            g_pool[i] = g_pool[g_aliveCount - 1];
            g_aliveCount--;
            i--;
            continue;
        }
        p->velocity.y += g_params.gravity * dt * 20.0f;
        p->position.x += p->velocity.x * dt;
        p->position.y += p->velocity.y * dt;
    }
}

void ParticlesEffect_Draw(RenderTexture2D scene, int screenW, int screenH) {
    g_spawnAccumulator += g_params.spawnRate * GetFrameTime();
    while (g_spawnAccumulator >= 1.0f && g_aliveCount < g_params.count) {
        SpawnParticle(screenW, screenH);
        g_spawnAccumulator -= 1.0f;
    }

    ClearBackground((Color){ 0, 0, 0, 0 });

    // Draw whatever's in the scene target (the video frame, or the procedural
    // placeholder from DrawBaseScene) behind the particles instead of
    // discarding it — dimmed slightly so particles still read clearly on top.
    // RenderTexture2D content is stored bottom-up in GL, hence the negative
    // height, matching the flip used in ascii_effect.c/crt_effect.c.
    DrawTextureRec(
        scene.texture,
        (Rectangle){ 0, 0, (float)scene.texture.width, -(float)scene.texture.height },
        (Vector2){ 0, 0 },
        WHITE
    );
    DrawRectangle(0, 0, screenW, screenH, (Color){ 11, 11, 14, 100 });

    for (int i = 0; i < g_aliveCount; i++) {
        Particle *p = &g_pool[i];
        float lifeRatio = 1.0f - (p->age / p->lifetime);
        float radius = g_params.size * (1.0f - g_params.sizeFalloff * (1.0f - lifeRatio));
        if (radius < 0.2f) radius = 0.2f;

        Color c = g_params.color;
        c.a = (unsigned char)(255 * fmaxf(0.0f, lifeRatio));
        DrawCircleV(p->position, radius, c);
    }
}
