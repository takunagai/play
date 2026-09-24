// ============================================================
// render/rich-gl.ts ─ rich の背景 + 泡（WebGL2 全画面フラグメントシェーダ）
// 薄膜干渉・フレネルのリム・背景の屈折（field.ts と同じブロブ和をシェーダ内で評価）・
// 割れる瞬間の膜の破れを 1 パスで描く。テクスチャは使わない。
// WebGL2 が無い・コンパイル失敗・コンテキスト喪失時は isAvailable=false になるので、
// main.ts はそれを見て standard へフォールバックする。正本は docs/architecture.md 7.3 節。
// ============================================================

import type { Bubble } from "../bubbles";
import type { BackgroundBlob } from "../field";
import { MAX_BUBBLES, PALETTE_BASE } from "../tuning";

const VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

const BLOB_COUNT = 4;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

#define BUBBLE_COUNT ${MAX_BUBBLES}
#define BLOB_COUNT ${BLOB_COUNT}

uniform vec2 uResolution;
uniform float uTime;
uniform float uAmp;
uniform vec3 uBaseColor;

uniform vec2 uBlobPos[BLOB_COUNT];
uniform float uBlobRadius[BLOB_COUNT];
uniform vec3 uBlobColor[BLOB_COUNT];

uniform vec2 uBubblePos[BUBBLE_COUNT];
uniform float uBubbleRadius[BUBBLE_COUNT];
uniform float uBubblePopT[BUBBLE_COUNT];
uniform float uBubbleSeed[BUBBLE_COUNT];

out vec4 outColor;

// 薄膜干渉の代表波長（nm）と膜の屈折率
const vec3 WAVELENGTH_NM = vec3(650.0, 532.0, 450.0);
const float FILM_INDEX = 1.33;
const float PI = 3.14159265;

vec3 evalBackground(vec2 p) {
  vec3 color = uBaseColor;
  for (int i = 0; i < BLOB_COUNT; i++) {
    float dist = length(p - uBlobPos[i]);
    float a = clamp(1.0 - dist / uBlobRadius[i], 0.0, 1.0);
    color += uBlobColor[i] * a * 0.8;
  }
  return clamp(color, 0.0, 1.0);
}

// 膜の厚み（nm）。泡の局所座標 u（-1..1）の滑らかな関数。角度（atan）を使わないので継ぎ目が出ない
float filmThicknessNm(vec2 u, float seed) {
  float swirl = 0.5 * sin(3.1 * u.x + 1.7 * u.y + uTime * 0.45 + seed * 6.2831)
    + 0.3 * sin(-2.3 * u.x + 2.9 * u.y - uTime * 0.33 + seed * 12.7)
    + 0.2 * sin(5.3 * length(u + vec2(0.2, -0.1)) - uTime * 0.6 + seed * 3.1);
  // 重力で膜液が下へ流れ、上ほど薄い
  float drainage = 0.35 * u.y;
  return clamp(470.0 + 170.0 * swirl + 160.0 * drainage, 220.0, 760.0);
}

// 薄膜干渉の反射色（0..1）。cosT は膜内の屈折角の cos
vec3 interferenceColor(float thicknessNm, float cosT) {
  vec3 phase = 4.0 * PI * FILM_INDEX * thicknessNm * cosT / WAVELENGTH_NM;
  // 反射時の半波長ずれで、厚み 0 付近は暗くなる
  return 0.5 - 0.5 * cos(phase);
}

void main() {
  vec2 fragPixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec3 color = evalBackground(fragPixel);

  for (int i = 0; i < BUBBLE_COUNT; i++) {
    float baseRadius = uBubbleRadius[i];
    if (baseRadius <= 0.0) continue;

    vec2 center = uBubblePos[i];
    float popT = uBubblePopT[i];
    float bulge = popT < 0.35 ? mix(1.0, 1.12, popT / 0.35) : mix(1.12, 1.3, (popT - 0.35) / 0.65);
    float radius = baseRadius * bulge;

    vec2 delta = fragPixel - center;
    float dist = length(delta);
    if (dist > radius + 1.5) continue;

    float seed = uBubbleSeed[i];
    vec2 u = delta / radius;
    float r = min(dist / radius, 1.0);

    // 球とみなした法線の z 成分 = 入射角の cos
    float cosI = sqrt(max(0.0, 1.0 - r * r));
    float sinT = r / FILM_INDEX;
    float cosT = sqrt(max(0.0, 1.0 - sinT * sinT));
    // Schlick のフレネル（水の F0 ≈ 0.02）。縁だけが強く反射する
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);

    vec3 film = interferenceColor(filmThicknessNm(u, seed), cosT);
    // 映り込む環境光: 上が明るい空、下は背景色の照り返し
    vec3 environment = mix(evalBackground(fragPixel) * 1.6 + 0.08, vec3(0.92, 0.95, 1.0), 0.5 - 0.5 * u.y);

    // 屈折: 薄い膜なので縁の近くだけわずかに歪む
    vec2 normal2d = dist > 0.001 ? delta / dist : vec2(0.0);
    vec3 refracted = evalBackground(fragPixel - normal2d * radius * 0.06 * r * r);

    float reflectance = fresnel * 1.5 + 0.05 + uAmp * 0.08;
    vec3 bubbleColor = refracted * (1.0 - min(0.8, fresnel)) + film * environment * reflectance;

    // 窓の映り込み（左上に大きめ、右下に小さく）
    float windowMain = smoothstep(0.26, 0.0, length((u - vec2(-0.38, -0.42)) * vec2(1.0, 1.35)));
    float windowSub = smoothstep(0.1, 0.0, length(u - vec2(0.42, 0.46)));
    bubbleColor += vec3(1.0) * (windowMain * 0.55 + windowSub * 0.3);

    // 輪郭のアンチエイリアス
    float edge = smoothstep(radius + 1.0, radius - 1.0, dist);

    // 割れる瞬間: 方向ベクトルの滑らかな関数を閾値が追い越した部分から膜が破れる
    float tearNoise = 0.5 + 0.25 * sin(normal2d.x * 7.0 + seed * 40.0) + 0.25 * sin(normal2d.y * 6.0 + seed * 23.0 + r * 3.0);
    float tearThreshold = -0.1 + popT * 1.3;
    float intact = popT <= 0.0 ? 1.0 : smoothstep(tearThreshold - 0.08, tearThreshold + 0.08, tearNoise);
    float popFade = popT < 0.35 ? 1.0 : 1.0 - (popT - 0.35) / 0.65;

    color = mix(color, clamp(bubbleColor, 0.0, 1.0), edge * intact * popFade);
  }

  outColor = vec4(color, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log ?? "unknown error"}`);
  }
  return shader;
}

function hexToRgb01(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

interface Uniforms {
  resolution: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  amp: WebGLUniformLocation | null;
  baseColor: WebGLUniformLocation | null;
  blobPos: WebGLUniformLocation | null;
  blobRadius: WebGLUniformLocation | null;
  blobColor: WebGLUniformLocation | null;
  bubblePos: WebGLUniformLocation | null;
  bubbleRadius: WebGLUniformLocation | null;
  bubblePopT: WebGLUniformLocation | null;
  bubbleSeed: WebGLUniformLocation | null;
}

export interface RichRenderParams {
  bubbles: readonly Bubble[];
  blobs: readonly BackgroundBlob[];
  timeSec: number;
  amp: number;
  cssWidth: number;
  cssHeight: number;
  renderScale: number;
}

export class RichGLRenderer {
  readonly isAvailable: boolean;
  private contextLost = false;
  private gl: WebGL2RenderingContext | null = null;
  private uniforms: Uniforms | null = null;

  // 毎フレーム使い回す typed array（GC を避ける）
  private readonly bubblePosBuf = new Float32Array(MAX_BUBBLES * 2);
  private readonly bubbleRadiusBuf = new Float32Array(MAX_BUBBLES);
  private readonly bubblePopTBuf = new Float32Array(MAX_BUBBLES);
  private readonly bubbleSeedBuf = new Float32Array(MAX_BUBBLES);
  private readonly blobPosBuf = new Float32Array(BLOB_COUNT * 2);
  private readonly blobRadiusBuf = new Float32Array(BLOB_COUNT);
  private readonly blobColorBuf = new Float32Array(BLOB_COUNT * 3);

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestored = (): void => {
    // 復帰時の再初期化はスコープ外（main.ts 側が isLost を見て standard に留まる想定）
    this.contextLost = false;
  };

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "high-performance" });
    } catch {
      gl = null;
    }

    if (!gl) {
      this.isAvailable = false;
      return;
    }

    try {
      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
      const program = gl.createProgram();
      if (!program) throw new Error("createProgram failed");
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        throw new Error(`program link failed: ${log ?? "unknown error"}`);
      }
      gl.useProgram(program);

      // 属性なしのフルスクリーン三角形でも VAO のバインドを要求する実装があるため、空の VAO を作って束ねる
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      this.uniforms = {
        resolution: gl.getUniformLocation(program, "uResolution"),
        time: gl.getUniformLocation(program, "uTime"),
        amp: gl.getUniformLocation(program, "uAmp"),
        baseColor: gl.getUniformLocation(program, "uBaseColor"),
        blobPos: gl.getUniformLocation(program, "uBlobPos"),
        blobRadius: gl.getUniformLocation(program, "uBlobRadius"),
        blobColor: gl.getUniformLocation(program, "uBlobColor"),
        bubblePos: gl.getUniformLocation(program, "uBubblePos"),
        bubbleRadius: gl.getUniformLocation(program, "uBubbleRadius"),
        bubblePopT: gl.getUniformLocation(program, "uBubblePopT"),
        bubbleSeed: gl.getUniformLocation(program, "uBubbleSeed"),
      };

      const [br, bg, bb] = hexToRgb01(PALETTE_BASE);
      gl.uniform3f(this.uniforms.baseColor, br, bg, bb);

      this.gl = gl;
      this.isAvailable = true;
    } catch {
      this.isAvailable = false;
      this.gl = null;
      return;
    }

    canvas.addEventListener("webglcontextlost", this.onContextLost, false);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored, false);
  }

  get hasContextLoss(): boolean {
    return this.contextLost;
  }

  resize(cssWidth: number, cssHeight: number, renderScale: number): void {
    const width = Math.max(1, Math.round(cssWidth * renderScale));
    const height = Math.max(1, Math.round(cssHeight * renderScale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl?.viewport(0, 0, width, height);
  }

  render(params: RichRenderParams): void {
    const gl = this.gl;
    const uniforms = this.uniforms;
    if (!gl || !uniforms || this.contextLost) return;

    const pixelWidth = Math.max(1, Math.round(params.cssWidth * params.renderScale));
    const pixelHeight = Math.max(1, Math.round(params.cssHeight * params.renderScale));
    const scale = params.renderScale;

    for (let i = 0; i < BLOB_COUNT; i++) {
      const blob = params.blobs[i];
      this.blobPosBuf[i * 2] = blob.x * pixelWidth;
      this.blobPosBuf[i * 2 + 1] = blob.y * pixelHeight;
      this.blobRadiusBuf[i] = blob.radius * Math.min(pixelWidth, pixelHeight);
      this.blobColorBuf[i * 3] = blob.r;
      this.blobColorBuf[i * 3 + 1] = blob.g;
      this.blobColorBuf[i * 3 + 2] = blob.b;
    }

    for (let i = 0; i < MAX_BUBBLES; i++) {
      const bubble = params.bubbles[i];
      const isVisible = bubble.active && (bubble.state === "rising" || bubble.state === "popping");
      this.bubblePosBuf[i * 2] = bubble.x * scale;
      this.bubblePosBuf[i * 2 + 1] = bubble.y * scale;
      this.bubbleRadiusBuf[i] = isVisible ? bubble.radius * scale : 0;
      this.bubblePopTBuf[i] = bubble.state === "popping" ? bubble.popT : 0;
      this.bubbleSeedBuf[i] = bubble.shimmerSeed;
    }

    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.uniform2f(uniforms.resolution, pixelWidth, pixelHeight);
    gl.uniform1f(uniforms.time, params.timeSec);
    gl.uniform1f(uniforms.amp, params.amp);
    gl.uniform2fv(uniforms.blobPos, this.blobPosBuf);
    gl.uniform1fv(uniforms.blobRadius, this.blobRadiusBuf);
    gl.uniform3fv(uniforms.blobColor, this.blobColorBuf);
    gl.uniform2fv(uniforms.bubblePos, this.bubblePosBuf);
    gl.uniform1fv(uniforms.bubbleRadius, this.bubbleRadiusBuf);
    gl.uniform1fv(uniforms.bubblePopT, this.bubblePopTBuf);
    gl.uniform1fv(uniforms.bubbleSeed, this.bubbleSeedBuf);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
  }
}
