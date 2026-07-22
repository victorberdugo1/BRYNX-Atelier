import type { EffectId, EffectParams } from "@/types/effects";

function fmtNum(v: unknown) {
  return typeof v === "number" ? (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(3)) : v;
}

function hexToRgbComment(hex: string) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

export function generateRaylibCode(effect: EffectId, params: EffectParams): string {
  switch (effect) {
    case "ascii":
      return `// Generated from Inspector state — native/effects/ascii_effect.c
AsciiParams params = {
    .ramp        = "${params.characters}",
    .fontSize    = ${fmtNum(params.fontSize)},
    .brightness  = ${fmtNum(params.brightness)}f,
    .contrast    = ${fmtNum(params.contrast)}f,
    .gamma       = ${fmtNum(params.gamma)}f,
    .foreground  = (Color){ ${hexToRgbComment(String(params.foreground))}, 255 },
    .background  = (Color){ ${hexToRgbComment(String(params.background))}, 255 },
    .invert      = ${params.invert ? "true" : "false"},
};

AsciiEffect_SetParams(&g_asciiEffect, &params);
AsciiEffect_Draw(&g_asciiEffect, sceneTexture);`;

    case "particles":
      return `// Generated from Inspector state — native/effects/particles_effect.c
ParticleParams params = {
    .count       = ${fmtNum(params.count)},
    .spawnRate   = ${fmtNum(params.spawnRate)}f,
    .gravity     = ${fmtNum(params.gravity)}f,
    .lifetime    = ${fmtNum(params.lifetime)}f,
    .size        = ${fmtNum(params.size)}f,
    .sizeFalloff = ${fmtNum(params.sizeFalloff)}f,
    .color       = (Color){ ${hexToRgbComment(String(params.color))}, 255 },
    .spreadDeg   = ${fmtNum(params.spread)}f,
};

ParticleEffect_SetParams(&g_particleEffect, &params);
ParticleEffect_Update(&g_particleEffect, GetFrameTime());
ParticleEffect_Draw(&g_particleEffect);`;

    case "crt":
      return `// Generated from Inspector state — native/effects/crt_effect.c
CrtParams params = {
    .scanlineIntensity   = ${fmtNum(params.scanlineIntensity)}f,
    .scanlineCount       = ${fmtNum(params.scanlineCount)},
    .curvature           = ${fmtNum(params.curvature)}f,
    .vignette            = ${fmtNum(params.vignette)}f,
    .noise               = ${fmtNum(params.noise)}f,
    .chromaticAberration = ${fmtNum(params.chromaticAberration)}f,
    .flicker             = ${fmtNum(params.flicker)}f,
};

CrtEffect_SetParams(&g_crtEffect, &params);
CrtEffect_Draw(&g_crtEffect, sceneTexture);`;
  }
}

export function generateShaderSnippet(effect: EffectId): string {
  if (effect !== "crt") {
    return `// ${effect} runs on the CPU/immediate-mode raylib API — no fragment shader needed.\n// See native/effects/${effect}_effect.c`;
  }
  return `// native/effects/crt.fs — fragment shader (GLSL 100, WebGL1/ES compatible)
#version 100
precision mediump float;
varying vec2 fragTexCoord;
uniform sampler2D texture0;
uniform float uTime;
uniform float uScanlineIntensity;
uniform float uScanlineCount;
uniform float uCurvature;
uniform float uVignette;
uniform float uNoise;
uniform float uAberration;
uniform float uFlicker;

float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 barrel(vec2 uv, float amount) {
    vec2 cc = uv - 0.5;
    float dist = dot(cc, cc);
    return uv + cc * dist * amount;
}

void main() {
    vec2 uv = barrel(fragTexCoord, uCurvature);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }

    float ab = uAberration * 0.002;
    float r = texture2D(texture0, uv + vec2(ab, 0.0)).r;
    float g = texture2D(texture0, uv).g;
    float b = texture2D(texture0, uv - vec2(ab, 0.0)).b;
    vec3 color = vec3(r, g, b);

    float scan = sin(uv.y * uScanlineCount * 3.14159) * 0.5 + 0.5;
    color *= mix(1.0, scan, uScanlineIntensity);

    float n = (rand(uv * uTime) - 0.5) * uNoise;
    color += n;

    float d = distance(uv, vec2(0.5));
    color *= mix(1.0, 1.0 - d, uVignette);

    color += rand(vec2(uTime, 0.0)) * uFlicker * 0.1;

    gl_FragColor = vec4(color, 1.0);
}`;
}

export function generateReadme(effect: EffectId): string {
  const titles: Record<EffectId, string> = {
    ascii: "ASCII Renderer",
    particles: "Particle System",
    crt: "CRT",
  };
  return `# ${titles[effect]}

This effect runs entirely inside the Raylib/WebAssembly canvas. React never draws
into the canvas — it only sends JSON parameter updates over the bridge defined
in \`src/lib/wasmBridge.ts\`, which calls \`js_set_effect_json\` in
\`native/main.c\`.

## Message contract

\`\`\`json
{ "effect": "${effect}", "params": { ... } }
\`\`\`

## Where the logic lives

- \`native/main.c\` — dispatches the decoded message to the active effect module
- \`native/effects/${effect}_effect.c/.h\` — owns simulation + drawing for this effect
- \`native/main.c: js_get_stats_json\` — reports FPS / frame / GPU time back to React

## Rebuilding

\`\`\`bash
cd native
make raylib   # first time only — builds libraylib.a for PLATFORM_WEB
make          # builds index.html/js/wasm via emcc
make run      # serves on http://localhost:8000
\`\`\`

Copy the build output into \`public/wasm/\` (as \`index.js\` + \`index.wasm\`) so
the Vite dev server can find it — see \`wasmBridge.ts\`'s \`WASM_GLUE_PATH\`.
Until that build exists, the app runs on the Canvas2D preview in
\`src/lib/mockRenderer.ts\`, which mirrors the same parameter contract.
`;
}
