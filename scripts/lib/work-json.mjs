// work.json の契約（VPS の kickoff と共有する。仕様の正本は docs/work-json.md）
// 語彙はスキル interactive-art-builder の references/wizard.md の選択肢ラベルと完全一致させる。
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const VOCABULARY = {
  emotion: ["カタルシス解放", "癒し・瞑想", "快感・連打", "緊張と畏怖", "驚き・発見"],
  verb: ["溜めて解放", "撫でる・かき混ぜる", "弾く・割る", "育てる・枯らす", "引き寄せと反発", "沈黙を破る"],
  tone: ["ダーク＋ネオン", "白＋淡色ミニマル", "有機的グラデーション", "レトロ CRT・グリッチ", "モノクロ＋単色差し"],
  sound: ["電子シンセ", "アンビエント・ドローン", "ノイズ・インダストリアル", "アコースティック風", "チップチューン"],
  scale: ["マイナーペンタトニック", "メジャーペンタ", "ドリアン", "リディアン", "無調・ノイズ主体"],
};

export const ORIGINS = ["dialogue", "autopilot"];
export const LICENSES = { dialogue: ["MIT", "AGPL-3.0"], autopilot: ["MIT"] };
export const MAX_GENERATED_IMAGES = 10;
export const MAX_SUMMARY_LENGTH = 80;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const REQUIRED_KEYS = [
  "slug",
  "title",
  "date",
  "origin",
  "summary",
  "emotion",
  "verb",
  "tone",
  "sound",
  "scale",
  "thumbnail",
  "license",
  "generatedImages",
];

export const ROOT_DIR = fileURLToPath(new URL("../..", import.meta.url));
export const WORKS_DIR = join(ROOT_DIR, "works");

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * work.json の中身を検証してエラー文の配列を返す（空なら合格）。
 * ファイルの実在は workDir を渡したときだけ確かめる（generatedImages[].file）。
 */
export function validateWork(work, { dirName, workDir } = {}) {
  const errors = [];
  if (work === null || typeof work !== "object" || Array.isArray(work)) return ["work.json がオブジェクトではない"];

  for (const key of REQUIRED_KEYS) {
    if (!(key in work)) errors.push(`必須キー ${key} が無い`);
  }
  for (const key of Object.keys(work)) {
    if (!REQUIRED_KEYS.includes(key)) errors.push(`契約に無いキー ${key}（契約の変更は人間の PR で docs/work-json.md から）`);
  }

  if ("slug" in work) {
    if (!isNonEmptyString(work.slug) || !SLUG_PATTERN.test(work.slug)) errors.push(`slug "${work.slug}" は英小文字・数字・ハイフンのみ`);
    else if (dirName && work.slug !== dirName) errors.push(`slug "${work.slug}" がフォルダ名 "${dirName}" と一致しない`);
  }
  for (const key of ["title", "summary", "thumbnail"]) {
    if (key in work && !isNonEmptyString(work[key])) errors.push(`${key} が空`);
  }
  if (isNonEmptyString(work.summary) && [...work.summary].length > MAX_SUMMARY_LENGTH) {
    errors.push(`summary が ${MAX_SUMMARY_LENGTH} 文字を超える（${[...work.summary].length} 文字）`);
  }
  if ("date" in work && !isValidDate(work.date)) errors.push(`date "${work.date}" は YYYY-MM-DD の実在する日付`);
  if ("origin" in work && !ORIGINS.includes(work.origin)) errors.push(`origin "${work.origin}" は ${ORIGINS.join(" / ")} のどれか`);

  for (const [key, labels] of Object.entries(VOCABULARY)) {
    if (key in work && !labels.includes(work[key])) {
      errors.push(`${key} "${work[key]}" が語彙に無い（${labels.join(" / ")}）`);
    }
  }

  if (isNonEmptyString(work.thumbnail)) {
    if (!work.thumbnail.endsWith(".webp")) errors.push(`thumbnail "${work.thumbnail}" は .webp にする`);
    if (work.thumbnail.startsWith("/") || work.thumbnail.includes("..")) {
      errors.push(`thumbnail "${work.thumbnail}" は作品のビルド出力内の相対パスにする`);
    }
  }

  if ("license" in work && ORIGINS.includes(work.origin) && !LICENSES[work.origin].includes(work.license)) {
    errors.push(`license "${work.license}" は origin "${work.origin}" では ${LICENSES[work.origin].join(" / ")} のみ`);
  }

  if ("generatedImages" in work) {
    const images = work.generatedImages;
    if (!Array.isArray(images)) {
      errors.push("generatedImages は配列");
    } else {
      if (images.length > MAX_GENERATED_IMAGES) {
        errors.push(`generatedImages が ${images.length} 件（上限 ${MAX_GENERATED_IMAGES} 件）`);
      }
      images.forEach((image, index) => {
        const label = `generatedImages[${index}]`;
        if (image === null || typeof image !== "object") {
          errors.push(`${label} は { file, prompt, model } のオブジェクト`);
          return;
        }
        for (const key of ["file", "prompt", "model"]) {
          if (!isNonEmptyString(image[key])) errors.push(`${label}.${key} が空`);
        }
        const extraKeys = Object.keys(image).filter((key) => !["file", "prompt", "model"].includes(key));
        if (extraKeys.length > 0) errors.push(`${label} に契約に無いキー ${extraKeys.join(", ")}`);
        if (workDir && isNonEmptyString(image.file) && !existsSync(join(workDir, image.file))) {
          errors.push(`${label}.file "${image.file}" が works/${dirName}/ に無い`);
        }
      });
    }
  }
  return errors;
}

/** works/*\/work.json を読み、{ dirName, workDir, work, errors } の配列を返す（フォルダ名順） */
export async function loadWorks({ shouldCheckFiles = false } = {}) {
  const entries = await readdir(WORKS_DIR, { withFileTypes: true });
  const results = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const workDir = join(WORKS_DIR, entry.name);
    const jsonPath = join(workDir, "work.json");
    if (!existsSync(jsonPath)) {
      results.push({ dirName: entry.name, workDir, work: null, errors: ["work.json が無い"] });
      continue;
    }
    let work;
    try {
      work = JSON.parse(await readFile(jsonPath, "utf8"));
    } catch (error) {
      results.push({ dirName: entry.name, workDir, work: null, errors: [`work.json を JSON として読めない: ${error.message}`] });
      continue;
    }
    const errors = validateWork(work, { dirName: entry.name, workDir: shouldCheckFiles ? workDir : undefined });
    results.push({ dirName: entry.name, workDir, work, errors });
  }
  return results;
}
