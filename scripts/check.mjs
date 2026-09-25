#!/usr/bin/env node
// pnpm check ─ PR を出す前の静的チェック。
//   1. 全作品の work.json: 必須キー・語彙・generatedImages 10 件以下・記録したファイルの実在・雛形の埋め残し
//   2. pnpm build（scripts/build.mjs）
//   3. サムネイルがビルド出力に実在し、1200×630 前後の webp であること
//   4. 一覧ページ dist/index.html から全作品へのリンク（と、一覧が参照する作品内のファイル）が dist/ 内に実在すること
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { loadWorks, ROOT_DIR, SUMMARY_PLACEHOLDER } from "./lib/work-json.mjs";

const DIST_DIR = join(ROOT_DIR, "dist");
const THUMBNAIL_MIN_WIDTH = 1000;
const THUMBNAIL_MAX_WIDTH = 1600;
const THUMBNAIL_MIN_RATIO = 1.8; // 1200 / 630 ≒ 1.905
const THUMBNAIL_MAX_RATIO = 2.0;
const PLACEHOLDER_PATTERN = /__[A-Z]+__/;

const errors = [];
const report = (scope, message) => errors.push(`${scope}: ${message}`);

async function checkWorkJson() {
  const works = await loadWorks({ shouldCheckFiles: true });
  for (const { dirName, workDir, work, errors: workErrors } of works) {
    const scope = `works/${dirName}`;
    for (const error of workErrors) report(scope, error);
    if (!work) continue;
    if (work.summary === SUMMARY_PLACEHOLDER) report(scope, "summary が未記入（new-work.mjs の仮の文のまま）");
    const indexPath = join(workDir, "index.html");
    if (!existsSync(indexPath)) {
      report(scope, "index.html が無い");
    } else if (PLACEHOLDER_PATTERN.test(await readFile(indexPath, "utf8"))) {
      report(scope, "index.html に雛形の埋め残し（__XXX__）がある");
    }
    if (PLACEHOLDER_PATTERN.test(JSON.stringify(work))) report(scope, "work.json に雛形の埋め残し（__XXX__）がある");
  }
  return works;
}

function runBuild() {
  console.log("check: pnpm build");
  const build = spawnSync(process.execPath, [join(ROOT_DIR, "scripts", "build.mjs")], { cwd: ROOT_DIR, stdio: "inherit" });
  return build.status === 0;
}

async function checkThumbnails(works) {
  for (const { work } of works) {
    if (!work || typeof work.thumbnail !== "string") continue;
    const scope = `works/${work.slug}`;
    const thumbnailPath = join(DIST_DIR, "works", work.slug, work.thumbnail);
    if (!existsSync(thumbnailPath)) {
      report(scope, `サムネイル ${work.thumbnail} がビルド出力 dist/works/${work.slug}/ に無い（public/ に置く。作り方は AGENTS.md）`);
      continue;
    }
    const metadata = await sharp(thumbnailPath).metadata();
    const ratio = metadata.width / metadata.height;
    if (metadata.format !== "webp") report(scope, `サムネイルが webp でない（${metadata.format}）`);
    if (metadata.width < THUMBNAIL_MIN_WIDTH || metadata.width > THUMBNAIL_MAX_WIDTH || ratio < THUMBNAIL_MIN_RATIO || ratio > THUMBNAIL_MAX_RATIO) {
      report(scope, `サムネイルが ${metadata.width}×${metadata.height}（1200×630 前後にする）`);
    }
  }
}

async function checkGalleryLinks(works) {
  const galleryPath = join(DIST_DIR, "index.html");
  if (!existsSync(galleryPath)) {
    report("dist", "index.html が無い");
    return;
  }
  const html = await readFile(galleryPath, "utf8");
  const references = [...html.matchAll(/(?:href|src)="(works\/[^"]*)"/g)].map((match) => match[1]);
  for (const { work } of works) {
    if (!work) continue;
    if (!references.includes(`works/${work.slug}/`)) report("dist/index.html", `works/${work.slug}/ へのリンクが無い`);
  }
  for (const reference of new Set(references)) {
    const target = join(DIST_DIR, decodeURIComponent(reference), reference.endsWith("/") ? "index.html" : "");
    if (!existsSync(target)) report("dist/index.html", `${reference} の参照先が dist/ に無い`);
  }
}

async function main() {
  const works = await checkWorkJson();
  if (!runBuild()) report("build", "pnpm build が失敗した");
  else {
    await checkThumbnails(works);
    await checkGalleryLinks(works);
  }

  if (errors.length > 0) {
    console.error(`\ncheck: FAIL（${errors.length} 件）`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`\ncheck: pass（${works.length} 作品）`);
}

main().catch((error) => {
  console.error(`check: ${error.stack ?? error.message}`);
  process.exit(1);
});
