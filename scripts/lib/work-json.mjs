// work.json の契約（VPS の kickoff と共有する。仕様の正本は docs/work-json.md）
// 語彙はスキル interactive-art-builder の references/wizard.md の選択肢ラベルと完全一致させる。
import { readdir, readFile, lstat } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
/** new-work.mjs が summary を省略されたときに入れる文。pnpm check はこれを未記入として弾く */
export const SUMMARY_PLACEHOLDER = "（1 行説明を書く）";

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

/** Git のコマンドを 1 回だけ実行し、stdout を返す。失敗は stderr を載せて投げる（潰さない）。 */
function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr ?? "").trim();
    const error = new Error(`git ${args.join(" ")} が失敗した: ${detail}`);
    error.stderr = result.stderr ?? "";
    throw error;
  }
  return result.stdout;
}

/**
 * HEAD の状態を確認する。true なら commit 済み、false なら unborn（コミットが 1 つも無い新規リポジトリ）。
 * rev-parse の stderr は正規 unborn と壊れた ref で同じ語句になるため、語句一致で unborn を
 * 断定しない。HEAD が symbolic で参照先がまだ無い場合だけ unborn とし、それ以外の確認不能な
 * Git 異常（壊れた・読み取れない ref 等）は投げる（unborn に握り潰さない）。
 */
function verifyHeadExists(rootDir) {
  try {
    runGit(rootDir, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch (verifyError) {
    let target;
    try {
      target = runGit(rootDir, ["symbolic-ref", "-q", "HEAD"]).trim();
    } catch (symbolicError) {
      throw new Error(
        `HEAD を読み取れない（新規リポジトリ以外の Git 異常は潰さない）: rev-parse: ${verifyError.message} / symbolic-ref: ${symbolicError.message}`,
      );
    }
    if (target === "") {
      throw new Error(`HEAD を読み取れない（symbolic HEAD の参照先が読めない）: ${verifyError.message}`);
    }
    return false; // symbolic HEAD の参照先がまだ無い（未コミット新規リポジトリ）
  }
}

/** index / HEAD の works/ 配下のパスから works/<slug>/ の slug を取り出す */
function slugFromWorkPath(path) {
  if (!path.startsWith("works/")) return null;
  const rest = path.slice("works/".length);
  if (rest === "") return null;
  const slash = rest.indexOf("/");
  const slug = slash === -1 ? rest : rest.slice(0, slash);
  return slug === "" ? null : slug;
}

/**
 * rootDir の Git 証拠を収集する（作品ごとに git を実行しない。全 slug 分を一括で取る）。
 * - Git 作業場なら { indexSlugs, headSlugs, hasHead } を返す。
 * - 非なら null を返す（保守的 fallback に回す）。
 * - .git があるのに git が使えない・top-level が不一致等は追跡なしに潰さず投げる。
 */
function collectGitEvidence(rootDir) {
  const gitMarkerExists = existsSync(join(rootDir, ".git"));
  let topLevel;
  try {
    topLevel = runGit(rootDir, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    if (gitMarkerExists) {
      throw new Error(`ROOT_DIR に .git があるのに Git リポジトリとして扱えない: ${error.message}`);
    }
    return null;
  }
  const rootReal = realpathSync(rootDir);
  const topReal = realpathSync(topLevel.trim());
  if (rootReal !== topReal) {
    if (gitMarkerExists) {
      throw new Error(`Git top-level（${topReal}）が ROOT_DIR（${rootReal}）と不一致（.git があるのに別のリポジトリに属している）`);
    }
    return null;
  }

  const indexSlugs = new Set();
  for (const path of runGit(rootDir, ["ls-files", "-z", "--", "works/"]).split("\0")) {
    const slug = slugFromWorkPath(path);
    if (slug) indexSlugs.add(slug);
  }

  const headSlugs = new Set();
  const hasHead = verifyHeadExists(rootDir);
  if (hasHead) {
    // --name-only -z の各 NUL レコードは path そのもの。タブはメタデータ区切りではなく
    // 正当なパスの一部なので、区切り扱いで slice しない
    for (const entry of runGit(rootDir, ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", "works/"]).split("\0")) {
      if (entry === "") continue;
      const slug = slugFromWorkPath(entry);
      if (slug) headSlugs.add(slug);
    }
  }
  return { indexSlugs, headSlugs, hasHead };
}

/** パスの状態を lstat で確かめる。ENOENT は "missing"、その他の失敗は { error } を返す（潰さない） */
async function probePathKind(path) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "dir";
    if (stat.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    return { error: `${path} を確認できない: ${error.message}` };
  }
}

/**
 * work.json が無い dir が「生成物だけ」かどうかを直下だけ見て判定する。
 * 空、または直下が通常 dir の node_modules/dist のみなら "artifact"（残存物として除外）。
 * 内部は走査しない。gitignore を根拠にはしない。走査に失敗したら { error }。
 */
async function classifyArtifactOnly(workDir, dirName) {
  let dirents;
  try {
    dirents = await readdir(workDir, { withFileTypes: true });
  } catch (error) {
    return { error: `works/${dirName} を走査できない: ${error.message}` };
  }
  const artifactOnly = dirents.every(
    (entry) => entry.isDirectory() && (entry.name === "node_modules" || entry.name === "dist"),
  );
  return artifactOnly ? "artifact" : "content";
}

/**
 * works/*\/work.json を読み、{ dirName, workDir, work, errors } の配列を返す（フォルダ名順）。
 * rootDir はテスト用の差し替え口（省略時は ROOT_DIR）。
 *
 * 列挙の規約:
 * - Git 作業場では候補 = 実ディレクトリ ∪ index 上の slug。
 *   - 実在する work.json は tracked/untracked を問わず parse/validateWork で検証する
 *     （壊れた JSON・読取失敗を skip しない）。
 *   - manifest が無くても index/HEAD に slug 配下の追跡証拠があれば欠落エラー
 *     （unstaged/staged の manifest 削除は生成物だけでもエラー）。
 *   - 全削除 unstaged（index 残留・dir 不在）は index 候補としてエラー、
 *     全削除 staged かつ dir 不在（git rm -r 済み）は意図的削除として列挙しない。
 *   - HEAD にしか残っていない slug（削除 commit 後の不在）は列挙しない。
 *   - 生成物（node_modules/dist）だけの未追跡 dir と空 dir は除外する
 *     （直下だけ見る。gitignore を根拠にはしない。同名のファイル・symlink は許さない）。
 * - 非 Git では保守的に、manifest が無い dir は空・生成物のみでも欠落エラー。
 * - 作品 dir の symlink は列挙外（index/HEAD 証拠があるなら黙殺せずエラー）、
 *   manifest への symlink は読む（dangling は欠落エラーとして除外しない）。
 */
export async function loadWorks({ shouldCheckFiles = false, rootDir = ROOT_DIR } = {}) {
  const worksDir = join(rootDir, "works");
  // 全削除 staged（git rm -r）で works/ 自体が消えることがある。index 候補の判定は続行する
  let dirents;
  try {
    dirents = await readdir(worksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    dirents = [];
  }
  const gitEvidence = collectGitEvidence(rootDir);
  const realDirNames = new Set(dirents.filter((item) => item.isDirectory()).map((item) => item.name));
  const candidates = [...new Set([...realDirNames, ...(gitEvidence ? gitEvidence.indexSlugs : [])])].sort((a, b) =>
    a.localeCompare(b),
  );

  const results = [];
  for (const dirName of candidates) {
    const workDir = join(worksDir, dirName);
    const indexEvidence = gitEvidence ? gitEvidence.indexSlugs.has(dirName) : false;
    const trackedEvidence = gitEvidence ? indexEvidence || gitEvidence.headSlugs.has(dirName) : false;
    const push = (work, errors) => results.push({ dirName, workDir, work, errors });

    const dirKind = await probePathKind(workDir);
    if (typeof dirKind !== "string") {
      push(null, [dirKind.error]);
      continue;
    }
    if (dirKind === "missing") {
      if (!gitEvidence) {
        push(null, [`works/${dirName} が index にあるが実ディレクトリが無い`]);
      } else if (!indexEvidence && gitEvidence.headSlugs.has(dirName)) {
        continue; // HEAD にしか残っていない slug（削除 commit 後の不在）は列挙しない
      } else {
        push(null, [`works/${dirName} が index にあるが実ディレクトリが無い（全削除は git rm で stage する）`]);
      }
      continue;
    }
    if (dirKind === "symlink") {
      if (trackedEvidence) {
        push(null, [`works/${dirName} が symlink になっている（追跡証拠があるため列挙対象にできない）`]);
      }
      continue; // 証拠が無い symlink 作品 dir は従来通り列挙外
    }
    if (dirKind !== "dir") {
      push(null, [`works/${dirName} がディレクトリでない`]);
      continue;
    }

    const jsonPath = join(workDir, "work.json");
    const manifestKind = await probePathKind(jsonPath);
    if (typeof manifestKind !== "string") {
      push(null, [manifestKind.error]);
      continue;
    }
    if (manifestKind === "missing") {
      if (!gitEvidence || trackedEvidence) {
        push(null, [trackedEvidence ? `work.json が無い（index/HEAD に作品の追跡証拠がある）` : "work.json が無い"]);
        continue;
      }
      const verdict = await classifyArtifactOnly(workDir, dirName);
      if (verdict === "artifact") continue; // 生成物だけの残存 dir・空 dir は除外
      push(null, [verdict.error ?? "work.json が無い"]);
      continue;
    }
    if (manifestKind === "dir") {
      push(null, ["work.json がディレクトリになっている"]);
      continue;
    }
    if (manifestKind === "other") {
      push(null, ["work.json が通常ファイルでない"]);
      continue;
    }

    let work;
    try {
      work = JSON.parse(await readFile(jsonPath, "utf8")); // symlink の manifest も従来通り読む
    } catch (error) {
      if (error.code === "ENOENT") {
        push(null, ["work.json が無い（symlink の参照先が無い）"]); // dangling symlink は生成物除外にしない
      } else if (error.code === "EISDIR") {
        push(null, ["work.json がディレクトリになっている"]);
      } else {
        push(null, [`work.json を JSON として読めない: ${error.message}`]);
      }
      continue;
    }
    const errors = validateWork(work, { dirName, workDir: shouldCheckFiles ? workDir : undefined });
    push(work, errors);
  }
  return results;
}
