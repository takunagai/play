// ============================================================
// creatures.ts ─ 浮遊生物（背景を漂う半透明の海の生き物）の動きと画像の読み込み
// 状態は描画非依存（standard の creatures2d.ts と rich の rich-gl.ts が同じ姿勢を描く）。
// 操作の対象にしない（当たり判定なし）。正本は docs/architecture.md 7.5 節。
// ============================================================

import {
  CREATURE_BASE_ASPECT,
  CREATURE_PORTRAIT_SCALE,
  CREATURE_GLIDE_SPEED_MAX,
  CREATURE_GLIDE_SPEED_MIN,
  CREATURE_RISE_SPEED_MAX,
  CREATURE_RISE_SPEED_MIN,
} from "./tuning";

/** rise: 上へ昇る / glide: 頭の向きへ横に進む / drift: 斜めに漂いながら回転する */
type MotionKind = "rise" | "glide" | "drift";

export interface CreatureSpec {
  readonly name: string;
  readonly src: string;
  /** 画像 1 辺 = 基準長 × この比率 */
  readonly sizeRatio: number;
  readonly motion: MotionKind;
  /** glide のとき、画像の頭が向いている水平方向（1 = 右, -1 = 左） */
  readonly facing: 1 | -1;
  /** 横幅・縦幅の脈動（拍動・羽ばたき）の振幅と周期 */
  readonly pulseX: number;
  readonly pulseY: number;
  readonly pulsePeriodS: number;
  /** 傾きの揺れ幅（ラジアン） */
  readonly tiltAmplitude: number;
}

export const CREATURE_SPECS: readonly CreatureSpec[] = [
  { name: "ray", src: "creatures/ray.webp", sizeRatio: 0.4, motion: "glide", facing: 1, pulseX: 0.03, pulseY: 0.05, pulsePeriodS: 5.5, tiltAmplitude: 0.12 },
  { name: "clione", src: "creatures/clione.webp", sizeRatio: 0.2, motion: "rise", facing: 1, pulseX: 0.07, pulseY: 0.015, pulsePeriodS: 1.3, tiltAmplitude: 0.08 },
  { name: "ctenophore", src: "creatures/ctenophore.webp", sizeRatio: 0.35, motion: "rise", facing: 1, pulseX: 0.02, pulseY: 0.02, pulsePeriodS: 4.2, tiltAmplitude: 0.1 },
  { name: "octopus", src: "creatures/octopus.webp", sizeRatio: 0.4, motion: "drift", facing: 1, pulseX: 0.035, pulseY: 0.035, pulsePeriodS: 6.5, tiltAmplitude: 0 },
  { name: "seadragon", src: "creatures/seadragon.webp", sizeRatio: 0.35, motion: "glide", facing: -1, pulseX: 0.015, pulseY: 0.02, pulsePeriodS: 4.8, tiltAmplitude: 0.07 },
  { name: "jellyfish", src: "creatures/jellyfish.webp", sizeRatio: 0.35, motion: "rise", facing: 1, pulseX: 0.05, pulseY: -0.04, pulsePeriodS: 3.2, tiltAmplitude: 0.06 },
];

export interface Creature {
  readonly spec: CreatureSpec;
  readonly index: number;
  /** 中心位置（画面比 0..1） */
  x: number;
  y: number;
  /** 速度（画面比 / 秒） */
  vx: number;
  vy: number;
  /** 画像を左右反転して描くか */
  isFlipped: boolean;
  phase: number;
  /** drift の回転角（ラジアン） */
  spin: number;
  spinSpeed: number;
}

/** 描画側が使う 1 体分の姿勢（CSS px） */
export interface CreaturePose {
  index: number;
  centerX: number;
  centerY: number;
  /** 画像の半辺（脈動込み）。isFlipped のとき halfWidth は負 */
  halfWidth: number;
  halfHeight: number;
  rotation: number;
}

export interface CreatureField {
  creatures: Creature[];
  poses: CreaturePose[];
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function creatureBaseLength(width: number, height: number): number {
  const baseLength = Math.min(width, height * CREATURE_BASE_ASPECT);
  return width < height ? baseLength * CREATURE_PORTRAIT_SCALE : baseLength;
}

/** 画面外の余白（画面比）。画像の半辺ぶん外に出てから再登場させる */
function marginFor(spec: CreatureSpec, width: number, height: number): { mx: number; my: number } {
  const half = (creatureBaseLength(width, height) * spec.sizeRatio) / 2;
  return { mx: half / width, my: half / height };
}

function assignVelocity(creature: Creature): void {
  const spec = creature.spec;
  if (spec.motion === "rise") {
    creature.vx = randomRange(-0.004, 0.004);
    creature.vy = -randomRange(CREATURE_RISE_SPEED_MIN, CREATURE_RISE_SPEED_MAX);
    creature.isFlipped = Math.random() < 0.5;
  } else if (spec.motion === "glide") {
    const direction = Math.random() < 0.5 ? 1 : -1;
    creature.vx = direction * randomRange(CREATURE_GLIDE_SPEED_MIN, CREATURE_GLIDE_SPEED_MAX);
    creature.vy = randomRange(-0.004, 0.004);
    creature.isFlipped = direction !== spec.facing;
  } else {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomRange(CREATURE_RISE_SPEED_MIN, CREATURE_RISE_SPEED_MAX) * 0.7;
    creature.vx = Math.cos(angle) * speed;
    creature.vy = Math.sin(angle) * speed;
    creature.isFlipped = Math.random() < 0.5;
    creature.spinSpeed = randomRange(0.04, 0.08) * (Math.random() < 0.5 ? 1 : -1);
  }
}

/** 進行方向の反対側の画面外へ置き直す */
function respawn(creature: Creature, width: number, height: number): void {
  assignVelocity(creature);
  const { mx, my } = marginFor(creature.spec, width, height);
  const isHorizontal = Math.abs(creature.vx) > Math.abs(creature.vy);
  if (isHorizontal) {
    creature.x = creature.vx > 0 ? -mx : 1 + mx;
    creature.y = randomRange(0.1, 0.9);
  } else {
    creature.x = randomRange(0.1, 0.9);
    creature.y = creature.vy > 0 ? -my : 1 + my;
  }
}

export function createCreatureField(): CreatureField {
  const count = CREATURE_SPECS.length;
  // 初期配置は横方向に散らし、全員が画面内にいる状態から始める（起動直後に空の画面を見せない）
  const slots = CREATURE_SPECS.map((_, i) => (i + 0.5) / count).sort(() => Math.random() - 0.5);
  const creatures = CREATURE_SPECS.map((spec, index): Creature => {
    const creature: Creature = { spec, index, x: slots[index], y: randomRange(0.15, 0.85), vx: 0, vy: 0, isFlipped: false, phase: Math.random() * Math.PI * 2, spin: Math.random() * Math.PI * 2, spinSpeed: 0 };
    assignVelocity(creature);
    return creature;
  });
  return { creatures, poses: creatures.map((c) => ({ index: c.index, centerX: 0, centerY: 0, halfWidth: 0, halfHeight: 0, rotation: 0 })) };
}

export function updateCreatures(field: CreatureField, dtMs: number, timeSec: number, width: number, height: number): void {
  const dt = dtMs / 1000;
  const baseLength = creatureBaseLength(width, height);

  for (const creature of field.creatures) {
    const spec = creature.spec;
    creature.x += creature.vx * dt;
    creature.y += creature.vy * dt;
    creature.spin += creature.spinSpeed * dt;

    const { mx, my } = marginFor(spec, width, height);
    const isOutside = creature.x < -mx - 0.01 || creature.x > 1 + mx + 0.01 || creature.y < -my - 0.01 || creature.y > 1 + my + 0.01;
    if (isOutside) respawn(creature, width, height);

    const t = timeSec + creature.phase * 10;
    const pulse = Math.sin((t / spec.pulsePeriodS) * Math.PI * 2);
    // ゆらぎ: 昇る種類は左右、横に進む種類は上下に、ゆっくり波打つ
    const swayX = spec.motion === "rise" ? Math.sin(t * 0.35) * 0.018 * width : 0;
    const swayY = spec.motion === "glide" ? Math.sin(t * 0.3) * 0.025 * height : 0;

    let rotation: number;
    if (spec.motion === "drift") {
      rotation = creature.spin;
    } else if (spec.motion === "glide") {
      // 波打つ上下動に合わせて進行方向へ傾ける
      rotation = Math.cos(t * 0.3) * spec.tiltAmplitude * Math.sign(creature.vx);
    } else {
      rotation = Math.sin(t * 0.35 + 0.8) * spec.tiltAmplitude;
    }

    const half = (baseLength * spec.sizeRatio) / 2;
    const pose = field.poses[creature.index];
    pose.centerX = creature.x * width + swayX;
    pose.centerY = creature.y * height + swayY;
    pose.halfWidth = half * (1 + spec.pulseX * pulse) * (creature.isFlipped ? -1 : 1);
    pose.halfHeight = half * (1 + spec.pulseY * pulse);
    pose.rotation = rotation;
  }
}

/** 全画像を読み込む。1 枚でも失敗したら null（生き物を描かないだけで本体は動く） */
export async function loadCreatureImages(): Promise<HTMLImageElement[] | null> {
  const base = import.meta.env.BASE_URL;
  try {
    return await Promise.all(
      CREATURE_SPECS.map(async (spec) => {
        const image = new Image();
        image.decoding = "async";
        image.src = base + spec.src;
        await image.decode();
        return image;
      }),
    );
  } catch {
    return null;
  }
}
