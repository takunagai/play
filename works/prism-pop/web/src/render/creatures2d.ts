// ============================================================
// render/creatures2d.ts ─ standard の浮遊生物（#creatures canvas、CSS px 等倍）
// 姿勢は creatures.ts が決める。ここでは回転・反転・脈動の変形で drawImage するだけ。
// 正本は docs/architecture.md 7.5 節。
// ============================================================

import type { CreaturePose } from "../creatures";
import { CREATURE_OPACITY } from "../tuning";

export function drawCreatures2D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  poses: readonly CreaturePose[],
  images: readonly HTMLImageElement[],
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = CREATURE_OPACITY;
  ctx.imageSmoothingQuality = "medium";
  for (const pose of poses) {
    const image = images[pose.index];
    ctx.setTransform(1, 0, 0, 1, pose.centerX, pose.centerY);
    ctx.rotate(pose.rotation);
    // halfWidth が負のときは左右反転になる
    ctx.scale(pose.halfWidth, pose.halfHeight);
    ctx.drawImage(image, -1, -1, 2, 2);
  }
  ctx.restore();
}
