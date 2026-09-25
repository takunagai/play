#!/usr/bin/env node
// 新作を雛形から始める。templates/work/ を works/<slug>/ にコピーし、work.json と index.html を埋めて pnpm install する。
//
//   node scripts/new-work.mjs <slug> [--title <作品名>] [--summary <1 行説明>]
//        [--emotion <語>] [--verb <語>] [--tone <語>] [--sound <語>] [--scale <語>] [--origin autopilot|dialogue]
//
// 語彙は docs/work-json.md の表（= スキルの wizard.md の選択肢ラベル）。省略した項目は各語彙の先頭（推奨）で埋め、警告を出す。
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ORIGINS, ROOT_DIR, SLUG_PATTERN, SUMMARY_PLACEHOLDER, VOCABULARY, WORKS_DIR } from "./lib/work-json.mjs";

const TEMPLATE_DIR = join(ROOT_DIR, "templates", "work");
const TEXT_FILES = ["package.json", "index.html", "work.json", "docs/concept.md", "docs/architecture.md", "docs/process-log.md"];

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} に値が無い`);
      options[arg.slice(2)] = value;
      index++;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    throw new Error("usage: node scripts/new-work.mjs <slug> [--title ..] [--summary ..] [--emotion ..] [--verb ..] [--tone ..] [--sound ..] [--scale ..]");
  }
  const known = ["title", "summary", "origin", ...Object.keys(VOCABULARY)];
  for (const key of Object.keys(options)) {
    if (!known.includes(key)) throw new Error(`不明なオプション --${key}`);
  }
  return { slug: positional[0], options };
}

/** Asia/Tokyo の今日（YYYY-MM-DD） */
function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function main() {
  const { slug, options } = parseArgs(process.argv.slice(2));
  if (!SLUG_PATTERN.test(slug)) throw new Error(`slug "${slug}" は英小文字・数字・ハイフンのみ（例: tide-bloom）`);
  const workDir = join(WORKS_DIR, slug);
  if (existsSync(workDir)) throw new Error(`works/${slug}/ は既にある`);

  const origin = options.origin ?? "autopilot";
  if (!ORIGINS.includes(origin)) throw new Error(`--origin は ${ORIGINS.join(" / ")}`);

  const warnings = [];
  const vocabulary = {};
  for (const [key, labels] of Object.entries(VOCABULARY)) {
    if (options[key] === undefined) {
      vocabulary[key] = labels[0];
      warnings.push(`--${key} を省略したため "${labels[0]}" を入れた。作品に合わせて work.json を直す`);
    } else if (!labels.includes(options[key])) {
      throw new Error(`--${key} "${options[key]}" は語彙に無い（${labels.join(" / ")}）`);
    } else {
      vocabulary[key] = options[key];
    }
  }
  const title = options.title ?? titleFromSlug(slug);
  const summary = options.summary ?? SUMMARY_PLACEHOLDER;
  if (options.summary === undefined) warnings.push(`--summary を省略した。work.json の summary を書くまで pnpm check は通らない`);

  await cp(TEMPLATE_DIR, workDir, { recursive: true });
  await mkdir(join(workDir, "public"), { recursive: true });

  const replacements = {
    __SLUG__: slug,
    __TITLE__: title,
    __SUMMARY__: summary,
    __DATE__: todayInTokyo(),
  };
  for (const file of TEXT_FILES) {
    const path = join(workDir, file);
    let text = await readFile(path, "utf8");
    for (const [placeholder, value] of Object.entries(replacements)) {
      text = text.replaceAll(placeholder, file.endsWith(".html") ? escapeHtml(value) : value);
    }
    await writeFile(path, text);
  }

  // work.json は JSON として組み直す（値のエスケープを JSON に任せる）
  const workJsonPath = join(workDir, "work.json");
  const work = JSON.parse(await readFile(workJsonPath, "utf8").then((text) => text.replace(/"__[A-Z]+__"/g, '""')));
  Object.assign(work, { slug, title, date: replacements.__DATE__, origin, summary, ...vocabulary });
  await writeFile(workJsonPath, `${JSON.stringify(work, null, 2)}\n`);

  // 音階を work.json の scale に合わせる
  const musicPath = join(workDir, "src", "music.ts");
  const music = await readFile(musicPath, "utf8");
  await writeFile(musicPath, music.replace(/export const SCALE: ScaleName = "[^"]+";/, `export const SCALE: ScaleName = "${vocabulary.scale}";`));

  console.log(`works/${slug}/ を作成（origin: ${origin}、date: ${replacements.__DATE__}）`);
  for (const warning of warnings) console.warn(`  注意: ${warning}`);

  console.log("\npnpm install（works/<slug>/pnpm-lock.yaml を作る）");
  const install = spawnSync("pnpm", ["install"], { cwd: ROOT_DIR, stdio: "inherit" });
  if (install.status !== 0) {
    console.error("new-work: pnpm install が失敗した。ネットワークを確かめてルートで pnpm install をやり直す");
    process.exit(1);
  }
  console.log(`\n次: works/${slug}/docs/concept.md → 実装 → サムネイル（public/thumbnail.webp）→ pnpm check && pnpm verify ${slug}`);
}

main().catch((error) => {
  console.error(`new-work: ${error.message}`);
  process.exit(1);
});
