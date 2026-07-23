#version 100
precision mediump float;

varying vec2 fragTexCoord;
varying vec4 fragColor;

uniform sampler2D texture0;
uniform float uTime;
uniform float uScanlineIntensity;
uniform float uScanlineCount;
uniform float uScanlineSpeed;
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
    vec4 centerSample = texture2D(texture0, uv);
    float g = centerSample.g;
    float b = texture2D(texture0, uv - vec2(ab, 0.0)).b;
    vec3 color = vec3(r, g, b);
    float srcAlpha = centerSample.a;

    float scanY = uv.y - uTime * uScanlineSpeed * 0.2;
    float scan = sin(scanY * uScanlineCount * 3.14159) * 0.5 + 0.5;
    color *= mix(1.0, scan, uScanlineIntensity);

    float n = (rand(uv * uTime) - 0.5) * uNoise;
    color += n;

    float d = distance(uv, vec2(0.5));
    color *= mix(1.0, 1.0 - d, uVignette);

    color += rand(vec2(uTime, 0.0)) * uFlicker * 0.1;

    gl_FragColor = vec4(color, srcAlpha);
}
