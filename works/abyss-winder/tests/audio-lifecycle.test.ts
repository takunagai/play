// 実行: node --experimental-strip-types --test works/abyss-winder/tests/audio-lifecycle.test.ts
// Web Audio 境界だけを fake 化し、実音源の予約・終了・取消を context 時計で検証する。
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test, type TestContext } from "node:test";
import { EIGHTH_MS, SPEED_MAX_RAD_S } from "../src/tuning.ts";

// 製品の bundler 向け拡張子省略を Node のテスト内だけで解決する。
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { SynthAudioEngine } = await import("../src/audio/synth-engine.ts");
hooks.deregister();

class FakeParam {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}

class FakeNode {
  connections = new Set<FakeNode>();
  disconnects = 0;
  connect(destination: FakeNode): FakeNode {
    this.connections.add(destination);
    return destination;
  }
  disconnect(): void {
    this.connections.clear();
    this.disconnects++;
  }
}

class FakeSource extends FakeNode {
  frequency = new FakeParam();
  type = "sine";
  buffer = null;
  loop = false;
  startAt = Infinity;
  stopAt = Infinity;
  stopCalls: number[] = [];
  ended = false;
  onended: (() => void) | null = null;
  start(at: number): void { this.startAt = at; }
  stop(at = 0): void {
    this.stopCalls.push(at);
    this.stopAt = at;
  }
}

class FakeContext {
  currentTime = 10;
  sampleRate = 1000;
  state = "running";
  destination = new FakeNode();
  sources: FakeSource[] = [];
  nodes: FakeNode[] = [];
  async resume() {}
  getOutputTimestamp() {
    return { contextTime: this.currentTime, performanceTime: performance.now() };
  }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (channel: number) => data[channel] };
  }
  keep<T extends FakeNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
  createGain() { return this.keep(Object.assign(new FakeNode(), { gain: new FakeParam() })); }
  createConvolver() { return this.keep(Object.assign(new FakeNode(), { buffer: null })); }
  createDynamicsCompressor() {
    return this.keep(Object.assign(new FakeNode(), { threshold: new FakeParam(), ratio: new FakeParam() }));
  }
  createAnalyser() {
    return this.keep(Object.assign(new FakeNode(), { fftSize: 1024, getFloatTimeDomainData() {} }));
  }
  createBiquadFilter() {
    return this.keep(Object.assign(new FakeNode(), { type: "lowpass", frequency: new FakeParam(), Q: new FakeParam() }));
  }
  createStereoPanner() { return this.keep(Object.assign(new FakeNode(), { pan: new FakeParam() })); }
  createBufferSource() {
    const source = this.keep(new FakeSource());
    this.sources.push(source);
    return source;
  }
  createOscillator() { return this.createBufferSource(); }
  advance(to: number): void {
    // stop() は ended を同期発火しない。予定終了順にイベントを配送する。
    for (;;) {
      const source = this.sources.filter((item) => !item.ended && item.stopAt <= to)
        .sort((a, b) => a.stopAt - b.stopAt)[0];
      if (!source) break;
      this.currentTime = Math.max(this.currentTime, source.stopAt);
      source.ended = true;
      source.onended?.();
    }
    this.currentTime = to;
  }
}

async function setup(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let context: FakeContext | undefined;
  class TestContext extends FakeContext {
    constructor() {
      super();
      context = this;
    }
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: TestContext, addEventListener() {} },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const engine = new SynthAudioEngine();
  await engine.start();
  assert.ok(context);
  const pending = Reflect.get(engine, "pendingClosures");
  assert.ok(pending instanceof Map);
  return { engine, context, pending };
}

function close(engine: InstanceType<typeof SynthAudioEngine>, token: number): void {
  const now = performance.now();
  engine.planClosure(token, now, now);
}

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("閉鎖の短いノイズ終了は爪・木胴・ベルの予定寿命を切らない", async (t) => {
  const { engine, context, pending } = await setup(t);
  close(engine, 1);
  const group = pending.get(1);
  const sources = [...context.sources];
  const t0 = sources[0].startAt;
  assert.equal(sources.length, 9);
  const wood = sources.filter((source) => source.frequency.value === 92 || source.frequency.value === 138);
  const bell = sources.filter((source) => source.stopAt > t0 + 0.5);
  assert.equal(wood.length, 2);
  assert.equal(bell.length, 3);
  for (const source of wood) near(source.stopAt - t0, 0.18);
  for (const source of bell) near(source.stopAt - t0, 0.6);

  context.advance(t0 + 0.017);
  assert.equal(group.disposed, false, "16ms のノイズ終了だけで全声を破棄してはいけない");
  assert.equal(group.sources.length, 8, "終了した source の参照だけ外す");
  assert.equal(sources[2].onended, null);
  assert.equal(sources[2].disconnects, 1);
  for (const source of sources) assert.equal(source.stopCalls.length, 1, "自然終了で再 stop しない");
  context.advance(t0 + 0.051);
  assert.equal(group.sources.length, 5, "爪と木胴励振だけが終わり、木胴とベルは残る");
  context.advance(t0 + 0.181);
  assert.equal(group.sources.length, 3);
  assert.equal(group.disposed, false);
  context.advance(t0 + 0.601);
  assert.equal(group.disposed, true);
  assert.equal(group.sources.length, 0);
  assert.equal(engine.getDiagnostics().voices, 0);
});

test("閉鎖を96回自然完了しても token・source・途中ノードの参照を残さない", async (t) => {
  const { engine, context, pending } = await setup(t);
  for (let token = 1; token <= 96; token++) {
    const nodeStart = context.nodes.length;
    close(engine, token);
    const group = pending.get(token);
    assert.equal(pending.size, 1);
    assert.equal(engine.getDiagnostics().voices, 1);
    const lastStop = Math.max(...group.sources.map((source: FakeSource) => source.stopAt));
    context.advance(lastStop + 0.001);
    assert.equal(pending.size, 0, "正常完了した token は map から外す");
    assert.equal(engine.getDiagnostics().voices, 0);
    assert.equal(group.sources.length, 0);
    assert.equal(group.extraNodes.length, 0);
    for (const node of context.nodes.slice(nodeStart)) {
      assert.equal(node.connections.size, 0, "group 固有の途中ノードも切り離す");
      assert.equal(node.disconnects, 1);
    }
    const sourceCount = context.sources.length;
    close(engine, token);
    assert.equal(context.sources.length, sourceCount, "自然終了後も同 token の予約は冪等");
  }
});

for (const [speed, duration] of [[0, 0.06], [SPEED_MAX_RAD_S, 0.02]]) {
  test(`拍爪は速度 ${speed} の長さ ${duration * 1000}ms と停止余白まで生存する`, async (t) => {
    const { engine, context } = await setup(t);
    const now = performance.now();
    const cue = { gestureId: 1, progress: 0, speed, accuracy: 1, atMs: now, beatOriginMs: now + 20 };
    engine.winding({ ...cue, phase: "start" });
    engine.winding({ ...cue, phase: "move" });
    const sources = context.sources.filter((source) => !source.loop);
    assert.equal(sources.length, 4);
    const t0 = sources[0].startAt;
    for (const source of sources.slice(0, 3)) near(source.stopAt - t0, duration + 0.02);
    context.advance(t0 + 0.017);
    assert.equal(engine.getDiagnostics().voices, 1);
    for (const source of sources.slice(0, 3)) assert.equal(source.ended, false);
    context.advance(t0 + duration + 0.021);
    assert.equal(engine.getDiagnostics().voices, 0);
    for (const source of sources) assert.equal(source.stopCalls.length, 1);
  });
}

for (const [startIndex, expected] of [
  [0, [81, 79, 78, 76, 74, 72, 71]],
  [7, [69, 67, 66, 64, 62, 60, 59]],
  [14, [57, 55, 54, 52, 50, 48, 47, 45]],
] as const) {
  test(`拍爪のAドリアン下降は MIDI ${expected[0]} から ${expected.at(-1)} まで相対度数を守る`, async (t) => {
    const { engine, context } = await setup(t);
    const originMs = 1000;
    let nowMs = originMs - 20;
    t.mock.method(performance, "now", () => nowMs);
    const cue = { gestureId: 1, progress: 0, speed: 0, accuracy: 1, beatOriginMs: originMs };
    engine.winding({ ...cue, phase: "start", atMs: nowMs });
    const midiNotes: number[] = [];
    // 最下端の次の2拍まで進め、折り返さず無音程の爪になることも確認する。
    for (let beat = 0; beat < 24; beat++) {
      nowMs = originMs + beat * EIGHTH_MS - 20;
      context.advance(10 + beat * EIGHTH_MS / 1000);
      const sourceStart = context.sources.length;
      engine.winding({ ...cue, phase: "move", atMs: nowMs });
      const sources = context.sources.slice(sourceStart);
      assert.equal(sources.length, beat < 22 ? 4 : 3);
      const fundamental = sources[0];
      near(fundamental.startAt, 10.02 + beat * EIGHTH_MS / 1000);
      near(fundamental.stopAt - fundamental.startAt, 0.08);
      near(sources[1].frequency.value / fundamental.frequency.value, 2.37);
      if (beat < 22) {
        near(sources[2].frequency.value / fundamental.frequency.value, 3.61);
        const midi = Math.round(69 + 12 * Math.log2(fundamental.frequency.value / 440));
        near(fundamental.frequency.value, 440 * 2 ** ((midi - 69) / 12));
        midiNotes.push(midi);
      } else {
        near(fundamental.frequency.value, 1900);
      }
    }
    assert.equal(engine.getDiagnostics().descentBeats, 22);
    assert.deepEqual(midiNotes.slice(startIndex, startIndex + expected.length), expected);
    for (let index = 1; index < midiNotes.length; index++) {
      assert.ok(midiNotes[index] < midiNotes[index - 1], "各拍で厳密に下降し、重複・折り返しをしない");
    }
    // 絶対音名 A/B/C/D/E/F#/G のみ。下のオクターブは BASE_MIDI 未満で剰余が負になる。
    for (const midi of midiNotes) assert.ok([9, 11, 0, 2, 4, 6, 7].includes(midi % 12));
  });
}

test("接触爪はノイズ終了後も65msまで残り、パンを含めて自然解放する", async (t) => {
  const { engine, context } = await setup(t);
  const nodeStart = context.nodes.length;
  engine.note({ x: 0.7, y: 0.5, midi: 69, velocity: 1 });
  const t0 = context.sources[0].startAt;
  context.advance(t0 + 0.017);
  assert.equal(engine.getDiagnostics().voices, 1);
  context.advance(t0 + 0.064);
  assert.equal(engine.getDiagnostics().voices, 1);
  context.advance(t0 + 0.066);
  assert.equal(engine.getDiagnostics().voices, 0);
  for (const source of context.sources) assert.equal(source.stopCalls.length, 1);
  for (const node of context.nodes.slice(nodeStart)) assert.equal(node.connections.size, 0);
});

test("64件の重複予約は24声・24token以内で、追い出したtokenの取消は隣の声を止めない", async (t) => {
  const { engine, context, pending } = await setup(t);
  close(engine, 1);
  const first = pending.get(1);
  const firstSources = [...first.sources];
  const firstNodes = [...first.extraNodes];
  for (let token = 2; token <= 64; token++) {
    close(engine, token);
    assert.equal(pending.size, Math.min(token, 24));
    assert.equal(engine.getDiagnostics().voices, Math.min(token, 24));
    assert.equal(pending.has(token), true);
  }
  assert.equal(first.disposed, true);
  assert.equal(first.sources.length, 0);
  assert.equal(first.extraNodes.length, 0);
  for (const source of firstSources) {
    assert.equal(source.onended, null);
    assert.deepEqual(source.stopCalls.slice(1), [0]);
    assert.equal(source.connections.size, 0);
  }
  for (const node of firstNodes) assert.equal(node.connections.size, 0);
  for (let token = 1; token <= 40; token++) engine.cancelClosure(token);
  assert.equal(pending.size, 24);
  assert.equal(engine.getDiagnostics().voices, 24);
  engine.cancelClosure(41);
  engine.cancelClosure(41);
  assert.equal(pending.size, 23);
  assert.equal(pending.has(42), true);
  context.advance(Math.max(...context.sources.map((source) => source.stopAt)) + 0.001);
  assert.equal(pending.size, 0);
  assert.equal(engine.getDiagnostics().voices, 0);
});

for (const afterNoise of [false, true]) {
  test(`閉鎖の取消は${afterNoise ? "ノイズ終了後" : "発音前"}の残りsourceを全停止し、隣tokenへ作用しない`, async (t) => {
    const { engine, context, pending } = await setup(t);
    close(engine, 1);
    const group = pending.get(1);
    const sources = [...context.sources];
    if (afterNoise) context.advance(sources[0].startAt + 0.017);
    const ended = sources.filter((source) => source.ended);
    const active = sources.filter((source) => !source.ended);
    close(engine, 2);
    const neighbor = pending.get(2);
    const neighborSources = [...neighbor.sources];
    engine.cancelClosure(1);
    engine.cancelClosure(1);
    assert.equal(group.disposed, true);
    assert.equal(group.sources.length, 0);
    assert.equal(group.extraNodes.length, 0);
    assert.equal(pending.size, 1);
    assert.equal(neighbor.disposed, false);
    for (const source of ended) assert.equal(source.stopCalls.length, 1);
    for (const source of active) {
      assert.deepEqual(source.stopCalls.slice(1), [0]);
      assert.equal(source.onended, null);
    }
    for (const source of neighborSources) assert.equal(source.stopCalls.length, 1);
    context.advance(Math.max(...neighborSources.map((source) => source.stopAt)) + 0.001);
    engine.cancelClosure(2);
    assert.equal(pending.size, 0);
    assert.equal(engine.getDiagnostics().voices, 0);
  });
}

test("suspend は発音中の接触爪と未発音の閉鎖をともに全停止・解放する", async (t) => {
  const { engine, context, pending } = await setup(t);
  const nodeStart = context.nodes.length;
  engine.note({ x: 0.5, y: 0.5, midi: 69, velocity: 1 });
  context.advance(context.sources[0].startAt + 0.017);
  close(engine, 1);
  const active = context.sources.filter((source) => !source.ended);
  engine.suspend();
  engine.suspend();
  assert.equal(engine.getDiagnostics().voices, 0);
  assert.equal(pending.size, 0);
  for (const source of active) {
    assert.deepEqual(source.stopCalls.slice(1), [0]);
    assert.equal(source.onended, null);
  }
  for (const node of context.nodes.slice(nodeStart)) assert.equal(node.connections.size, 0);
});
