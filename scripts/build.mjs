#!/usr/bin/env node
// pnpm build の実体。works/*/work.json を列挙 → 各作品をビルド → dist/works/<slug>/ に配置 → 一覧ページ dist/index.html を生成。
// 1 作品でも失敗したら exit 1（main への merge がそのまま本番反映になるため、壊れたまま出さない）。
import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadWorks, ROOT_DIR } from "./lib/work-json.mjs";
import { renderGallery } from "../gallery/render.mjs";

const DIST_DIR = join(ROOT_DIR, "dist");
const GALLERY_PUBLIC_DIR = join(ROOT_DIR, "gallery", "public");

function formatSeconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
  });
}

async function main() {
  const startedAt = performance.now();
  const works = await loadWorks();
  if (works.length === 0) {
    console.error("build: works/ に作品が無い");
    process.exit(1);
  }

  const invalid = works.filter((item) => item.errors.length > 0);
  if (invalid.length > 0) {
    for (const item of invalid) {
      console.error(`build: works/${item.dirName}/work.json が契約に合わない`);
      for (const error of item.errors) console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(join(DIST_DIR, "works"), { recursive: true });

  const failures = [];
  const timings = [];
  for (const { dirName, workDir, work } of works) {
    const workStartedAt = performance.now();
    console.log(`\n=== build: ${work.slug} ===`);
    const code = await run("pnpm", ["run", "build"], workDir);
    const workOutput = join(workDir, "dist");
    if (code !== 0) {
      failures.push(`${dirName}: pnpm run build が exit ${code}`);
      continue;
    }
    if (!existsSync(join(workOutput, "index.html"))) {
      failures.push(`${dirName}: ビルド出力 works/${dirName}/dist/index.html が無い`);
      continue;
    }
    await cp(workOutput, join(DIST_DIR, "works", work.slug), { recursive: true });
    timings.push(`${work.slug} ${formatSeconds(performance.now() - workStartedAt)}`);
  }

  if (failures.length > 0) {
    console.error("\nbuild: 失敗した作品があるため中止（dist/ は不完全）");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  await cp(GALLERY_PUBLIC_DIR, DIST_DIR, { recursive: true });
  await writeFile(join(DIST_DIR, "index.html"), renderGallery(works.map((item) => item.work)));

  console.log(`\nbuild: ${works.length} 作品 + 一覧ページ → dist/（${timings.join(" / ")}・合計 ${formatSeconds(performance.now() - startedAt)}）`);
}

main().catch((error) => {
  console.error(`build: ${error.stack ?? error.message}`);
  process.exit(1);
});
