#!/usr/bin/env node
// 生成画像・スクリーンショットを作品用の webp に変換する。
//
//   node scripts/prepare-image.mjs <in> <out.webp> [--black-to-alpha] [--max <px>] [--cover <W>x<H>] [--quality <1-100>] [--lossless]
//
// --black-to-alpha  黒背景を透過にする。「明るさ = 不透明度」: alpha = max(R, G, B)、色は alpha で割り戻す
//                   （光のにじみが半透明のまま残る。透過を画像生成モデルに頼むと市松模様が描き込まれるため）
//                   変換後に黒へ重ね直した画像と元画像の差（0〜255 の平均・最大）を表示する
// --max <px>        長辺をこの値以下に縮小する（拡大はしない）
// --cover <W>x<H>   中央を基準に W×H へ切り抜く（サムネイル 1200x630 用）
// --quality <n>     webp の品質（既定 82）
// --lossless        可逆圧縮にする（容量は増える）
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const USAGE =
  "usage: node scripts/prepare-image.mjs <in> <out.webp> [--black-to-alpha] [--max <px>] [--cover <W>x<H>] [--quality <1-100>] [--lossless]";

function parseArgs(argv) {
  const positional = [];
  const options = { isBlackToAlpha: false, isLossless: false, maxEdge: null, cover: null, quality: 82 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--black-to-alpha") options.isBlackToAlpha = true;
    else if (arg === "--lossless") options.isLossless = true;
    else if (arg === "--max") options.maxEdge = Number(argv[++index]);
    else if (arg === "--cover") {
      const match = /^(\d+)x(\d+)$/.exec(argv[++index] ?? "");
      if (!match) throw new Error("--cover は <W>x<H> の形で指定する（例: 1200x630）");
      options.cover = { width: Number(match[1]), height: Number(match[2]) };
    } else if (arg === "--quality") options.quality = Number(argv[++index]);
    else if (arg.startsWith("--")) throw new Error(`不明なオプション: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 2) throw new Error(USAGE);
  if (options.maxEdge !== null && !(options.maxEdge > 0)) throw new Error("--max は正の整数");
  if (!(options.quality >= 1 && options.quality <= 100)) throw new Error("--quality は 1〜100");
  return { input: positional[0], output: positional[1], options };
}

// alpha = max(R, G, B)、色は alpha で割り戻す（黒に重ね直すと元画像に戻る）
function blackToAlpha(data) {
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = Math.max(red, green, blue);
    if (alpha === 0) {
      data[offset + 3] = 0;
      continue;
    }
    data[offset] = Math.min(255, Math.round((red * 255) / alpha));
    data[offset + 1] = Math.min(255, Math.round((green * 255) / alpha));
    data[offset + 2] = Math.min(255, Math.round((blue * 255) / alpha));
    data[offset + 3] = Math.round((alpha * data[offset + 3]) / 255);
  }
}

async function main() {
  const { input, output, options } = parseArgs(process.argv.slice(2));
  if (!output.endsWith(".webp")) throw new Error("出力は .webp にする");

  let pipeline = sharp(input).rotate();
  if (options.cover) {
    pipeline = pipeline.resize(options.cover.width, options.cover.height, { fit: "cover", position: "centre" });
  } else if (options.maxEdge) {
    pipeline = pipeline.resize(options.maxEdge, options.maxEdge, { fit: "inside", withoutEnlargement: true });
  }

  const webpOptions = options.isLossless
    ? { lossless: true }
    : { quality: options.quality, alphaQuality: 100, smartSubsample: true };

  await mkdir(dirname(output) || ".", { recursive: true });
  if (!options.isBlackToAlpha) {
    const info = await sharp(await pipeline.toBuffer()).webp(webpOptions).toFile(output);
    console.log(`${output}: ${info.width}x${info.height} ${(info.size / 1024).toFixed(1)} KiB`);
    return;
  }

  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // 比較用に、透過前の画像を黒に重ねた RGB を残す
  const reference = Buffer.alloc(info.width * info.height * 3);
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const alpha = data[pixel * 4 + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      reference[pixel * 3 + channel] = Math.round(data[pixel * 4 + channel] * alpha);
    }
  }
  blackToAlpha(data);
  const written = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp(webpOptions)
    .toFile(output);
  const restored = await sharp(output).flatten({ background: "#000000" }).removeAlpha().raw().toBuffer();
  let differenceSum = 0;
  let differenceMax = 0;
  for (let index = 0; index < reference.length; index++) {
    const difference = Math.abs(restored[index] - reference[index]);
    differenceSum += difference;
    differenceMax = Math.max(differenceMax, difference);
  }
  const differenceMean = (differenceSum / reference.length).toFixed(2);
  console.log(
    `${output}: ${written.width}x${written.height} ${(written.size / 1024).toFixed(1)} KiB` +
      ` / 黒に戻した差 平均 ${differenceMean}・最大 ${differenceMax}（0〜255）`,
  );
}

main().catch((error) => {
  console.error(`prepare-image: ${error.message}`);
  process.exit(1);
});
