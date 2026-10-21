// scripts/tests/work-json.test.mjs ─ loadWorks の作品列挙と欠落検出の回帰テスト。
// 実行: node --test scripts/tests/work-json.test.mjs
// fixture はすべて tmpdir の隔離領域に作る（実リポジトリの works/ には触れない）。
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { lstatSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadWorks } from "../lib/work-json.mjs";

const tmpRoots = [];
test.after(async () => {
  await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function newRoot() {
  const root = await mkdtemp(join(tmpdir(), "work-json-"));
  tmpRoots.push(root);
  await mkdir(join(root, "works"), { recursive: true });
  return root;
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} が失敗: ${result.stderr?.trim()}`);
  }
  return result.stdout;
}

function workJson(slug, overrides = {}) {
  return {
    slug,
    title: "T",
    date: "2026-01-01",
    origin: "autopilot",
    summary: "S",
    emotion: "カタルシス解放",
    verb: "溜めて解放",
    tone: "ダーク＋ネオン",
    sound: "電子シンセ",
    scale: "マイナーペンタトニック",
    thumbnail: "public/thumbnail.webp",
    license: "MIT",
    generatedImages: [],
    ...overrides,
  };
}

async function addWork(root, slug, { files = [], work } = {}) {
  const workDir = join(root, "works", slug);
  await mkdir(workDir, { recursive: true });
  for (const rel of files) {
    const path = join(workDir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "x");
  }
  await writeFile(join(workDir, "work.json"), JSON.stringify(work ?? workJson(slug)));
  return workDir;
}

/** HEAD を持つ Git リポジトリ fixture（tide-bloom を1作品 commit 済み。node_modules は無い） */
async function newGitRoot() {
  const root = await newRoot();
  git(root, "init", "-q", "-b", "main");
  await addWork(root, "tide-bloom", { files: ["index.html"] });
  git(root, "add", ".");
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "init");
  return root;
}

function findWork(works, dirName) {
  return works.find((work) => work.dirName === dirName);
}

test("追跡済みと未追跡の正規作品を dirName 順で列挙し、戻り形式を維持する", async () => {
  const root = await newGitRoot();
  await addWork(root, "aqua-drift", { files: ["index.html"] });
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(works.map((work) => work.dirName), ["aqua-drift", "tide-bloom"]);
  assert.ok(works.every((work) => work.errors.length === 0), JSON.stringify(works));
  for (const work of works) {
    assert.equal(typeof work.workDir, "string");
    assert.equal(work.work.slug, work.dirName);
  }
});

test("生成物のみの未追跡 dir は列挙しない", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "residue");
  await mkdir(join(workDir, "node_modules", "dep"), { recursive: true });
  await mkdir(join(workDir, "dist"), { recursive: true });
  await writeFile(join(workDir, "node_modules", "dep", "index.js"), "x");
  await writeFile(join(workDir, "dist", "bundle.js"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(!works.some((work) => work.dirName === "residue"));
});

test("空の未追跡 dir は列挙しない", async () => {
  const root = await newGitRoot();
  await mkdir(join(root, "works", "empty-dir"), { recursive: true });
  const works = await loadWorks({ rootDir: root });
  assert.ok(!works.some((work) => work.dirName === "empty-dir"));
});

test("生成物のみ dir に隠しファイルが混ざると欠落エラー", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "residue");
  await mkdir(join(workDir, "node_modules"), { recursive: true });
  await writeFile(join(workDir, ".DS_Store"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "residue")?.errors.some((error) => error.includes("work.json")));
});

test("生成物のみ dir に src/ が混ざると欠落エラー", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "residue");
  await mkdir(join(workDir, "node_modules"), { recursive: true });
  await mkdir(join(workDir, "src"), { recursive: true });
  await writeFile(join(workDir, "src", "main.ts"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "residue")?.errors.some((error) => error.includes("work.json")));
});

test("生成物のみ dir に package.json が混ざると欠落エラー", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "residue");
  await mkdir(join(workDir, "dist"), { recursive: true });
  await writeFile(join(workDir, "package.json"), "{}");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "residue")?.errors.some((error) => error.includes("work.json")));
});

test("生成物のみ dir に未知ファイルが混ざると欠落エラー", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "residue");
  await mkdir(join(workDir, "dist"), { recursive: true });
  await writeFile(join(workDir, "notes.txt"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "residue")?.errors.some((error) => error.includes("work.json")));
});

test("node_modules や dist と同名の通常ファイルは許可しない", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "residue");
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "node_modules"), "not a dir");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "residue")?.errors.some((error) => error.includes("work.json")));
});

test("node_modules や dist と同名の symlink は許可しない", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "residue");
  await mkdir(workDir, { recursive: true });
  await symlink(join(root, "elsewhere"), join(workDir, "dist"));
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "residue")?.errors.some((error) => error.includes("work.json")));
});

test("tracked work.json を unstaged で削除すると生成物だけでも欠落エラー", async () => {
  const root = await newGitRoot();
  await rm(join(root, "works", "tide-bloom", "work.json"));
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "tide-bloom")?.errors.some((error) => error.includes("work.json")));
});

test("work.json の staged 削除でも dir が残る間は欠落エラー", async () => {
  const root = await newGitRoot();
  git(root, "rm", "-q", "works/tide-bloom/work.json");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "tide-bloom")?.errors.some((error) => error.includes("work.json")));
});

test("全削除 unstaged（dir 不在・index 残留）はエラー", async () => {
  const root = await newGitRoot();
  await rm(join(root, "works", "tide-bloom"), { recursive: true, force: true });
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "tide-bloom")?.errors.length > 0);
});

test("全削除 staged（git rm -r・dir 不在）は列挙しない", async () => {
  const root = await newGitRoot();
  git(root, "rm", "-q", "-r", "works/tide-bloom");
  const works = await loadWorks({ rootDir: root });
  assert.ok(!works.some((work) => work.dirName === "tide-bloom"));
});

test("削除 commit 後に残った生成物 dir は列挙しない", async () => {
  const root = await newGitRoot();
  git(root, "rm", "-q", "-r", "works/tide-bloom");
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "remove");
  const workDir = join(root, "works", "tide-bloom", "node_modules");
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "leftover.js"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(!works.some((work) => work.dirName === "tide-bloom"));
});

test("壊れた JSON は Git モードでもエラーを維持する", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "broken-thing");
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "work.json"), "{ broken");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "broken-thing")?.errors.some((error) => error.includes("JSON")));
});

test("未コミット新規 Git は index の証拠で列挙する", async () => {
  const root = await newRoot();
  git(root, "init", "-q", "-b", "main");
  await addWork(root, "fresh-work", { files: ["index.html"] });
  git(root, "add", ".");
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(findWork(works, "fresh-work")?.errors, []);
});

test("未コミット新規 Git でも生成物のみ dir は除外する", async () => {
  const root = await newRoot();
  git(root, "init", "-q", "-b", "main");
  await addWork(root, "fresh-work", { files: ["index.html"] });
  git(root, "add", ".");
  await mkdir(join(root, "works", "residue", "node_modules"), { recursive: true });
  await writeFile(join(root, "works", "residue", "node_modules", "x.js"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(findWork(works, "fresh-work")?.errors, []);
  assert.ok(!works.some((work) => work.dirName === "residue"));
});

test("非 Git rootDir では生成物のみ dir も欠落エラー（保守的 fallback）", async () => {
  const root = await newRoot();
  const workDir = join(root, "works", "residue");
  await mkdir(join(workDir, "node_modules"), { recursive: true });
  await writeFile(join(workDir, "node_modules", "x.js"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "residue")?.errors.some((error) => error.includes("work.json")));
});

test("非 Git rootDir では正規 manifest を検証する", async () => {
  const root = await newRoot();
  await addWork(root, "plain-work", { files: ["index.html"] });
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(findWork(works, "plain-work")?.errors, []);
});

test("非 Git rootDir でも壊れた JSON はエラー", async () => {
  const root = await newRoot();
  const workDir = join(root, "works", "broken-thing");
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "work.json"), "{ broken");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "broken-thing")?.errors.some((error) => error.includes("JSON")));
});

test("ROOT に .git marker があるのに top-level が不一致なら失敗する", async () => {
  const parent = await newRoot();
  git(parent, "init", "-q", "-b", "main");
  const root = join(parent, "nested-root");
  await mkdir(join(root, "works"), { recursive: true });
  await writeFile(join(root, ".git"), "gitdir: /dev/null\n");
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("作品 dir への symlink（証拠なし）は列挙しない", async () => {
  const root = await newGitRoot();
  await symlink(join(root, "works", "tide-bloom"), join(root, "works", "sym-alias"));
  const works = await loadWorks({ rootDir: root });
  assert.ok(!works.some((work) => work.dirName === "sym-alias"));
});

test("作品 dir への symlink に index 証拠があるなら黙殺せずエラー", async () => {
  const root = await newGitRoot();
  await symlink(join(root, "works", "tide-bloom"), join(root, "works", "sym-alias"));
  git(root, "add", "works/sym-alias");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "sym-alias")?.errors.length > 0);
});

test("manifest への symlink は従来通り読む", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "aqua-drift");
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "actual.json"), JSON.stringify(workJson("aqua-drift")));
  await symlink(join(workDir, "actual.json"), join(workDir, "work.json"));
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(findWork(works, "aqua-drift")?.errors, []);
});

test("manifest が dangling symlink なら欠落エラー（生成物除外にしない）", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "aqua-drift");
  await mkdir(workDir, { recursive: true });
  await symlink(join(workDir, "no-such.json"), join(workDir, "work.json"));
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "aqua-drift")?.errors.some((error) => error.includes("work.json")));
});

test("work.json が dir ならエラー", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "aqua-drift");
  await mkdir(join(workDir, "work.json"), { recursive: true });
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "aqua-drift")?.errors.length > 0);
});

test("作品 dir が走査できないならエラー", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root では権限制限のテストが無効");
    return;
  }
  const root = await newGitRoot();
  await addWork(root, "aqua-drift");
  const workDir = join(root, "works", "aqua-drift");
  await rm(join(workDir, "work.json"));
  await chmod(workDir, 0o000);
  let works;
  try {
    works = await loadWorks({ rootDir: root });
  } finally {
    await chmod(workDir, 0o700);
  }
  assert.ok(findWork(works, "aqua-drift")?.errors.length > 0);
});

test("shouldCheckFiles で generatedImages の実在確認が効く（在来シグネチャ維持）", async () => {
  const root = await newGitRoot();
  await addWork(root, "aqua-drift", {
    work: workJson("aqua-drift", { generatedImages: [{ file: "assets/a.png", prompt: "p", model: "m" }] }),
  });
  const checked = await loadWorks({ shouldCheckFiles: true, rootDir: root });
  assert.ok(findWork(checked, "aqua-drift")?.errors.some((error) => error.includes("assets/a.png")));
  const unchecked = await loadWorks({ rootDir: root });
  assert.deepEqual(findWork(unchecked, "aqua-drift")?.errors, []);
});

// ── ここから t_768f9683 の仕様起点で追加した受入ケース（docs/work-json.md L101-117） ──

test("staged 全削除後に空 dir が残る間は HEAD 証拠で欠落エラー", async () => {
  const root = await newGitRoot();
  git(root, "rm", "-q", "-r", "works/tide-bloom");
  await mkdir(join(root, "works", "tide-bloom"), { recursive: true });
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "tide-bloom")?.errors.length > 0);
});

test("staged 全削除後に生成物 dir が残る間も HEAD 証拠で欠落エラー", async () => {
  const root = await newGitRoot();
  git(root, "rm", "-q", "-r", "works/tide-bloom");
  await mkdir(join(root, "works", "tide-bloom", "dist"), { recursive: true });
  await writeFile(join(root, "works", "tide-bloom", "dist", "bundle.js"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "tide-bloom")?.errors.length > 0);
});

test("削除を commit した後の不在（dir も index 証拠も無し）は列挙しない", async () => {
  const root = await newGitRoot();
  git(root, "rm", "-q", "-r", "works/tide-bloom");
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "remove");
  const works = await loadWorks({ rootDir: root });
  assert.ok(!works.some((work) => work.dirName === "tide-bloom"));
});

test("語彙外の emotion は未追跡 manifest でも検証エラー", async () => {
  const root = await newGitRoot();
  await addWork(root, "odd-work", {
    files: ["index.html"],
    work: workJson("odd-work", { emotion: "怒り爆発" }),
  });
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "odd-work")?.errors.length > 0);
});

test("slug と dir 名の不一致は検証エラー", async () => {
  const root = await newGitRoot();
  await addWork(root, "dir-name", { files: ["index.html"], work: workJson("other-slug") });
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "dir-name")?.errors.length > 0);
});

test("rootDir を symlink 経由で渡しても realpath 一致で Git 作業場として列挙する", async () => {
  const root = await newGitRoot();
  const linkParent = await mkdtemp(join(tmpdir(), "work-json-link-"));
  tmpRoots.push(linkParent);
  const link = join(linkParent, "root-link");
  await symlink(root, link);
  const works = await loadWorks({ rootDir: link });
  assert.deepEqual(findWork(works, "tide-bloom")?.errors, []);
});

test("スペース・改行入りの dir 名や追跡パスでも列挙が壊れない", async () => {
  const root = await newGitRoot();
  const srcDir = join(root, "works", "tide-bloom", "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(join(srcDir, "wei rd file.ts"), "x");
  await writeFile(join(srcDir, "break\nline.ts"), "x");
  git(root, "add", ".");
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "spacey");
  await mkdir(join(root, "works", "resi due\ndir"), { recursive: true });
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(works.map((work) => work.dirName), ["tide-bloom"]);
  assert.deepEqual(findWork(works, "tide-bloom")?.errors, []);
});

test("HEAD の唯一の証拠パスにタブが含まれていても欠落エラーにする", async () => {
  const root = await newRoot();
  git(root, "init", "-q", "-b", "main");
  const srcDir = join(root, "works", "tab-work", "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(join(srcDir, "source\tfile.txt"), "x");
  git(root, "add", ".");
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "tab path");
  git(root, "rm", "-q", "-r", "works/tab-work");
  await mkdir(join(root, "works", "tab-work", "dist"), { recursive: true });
  await writeFile(join(root, "works", "tab-work", "dist", "bundle.js"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "tab-work")?.errors.length > 0);
});

test("HEAD が破損しているときは unborn と誤認せず失敗する", async () => {
  const root = await newGitRoot();
  await writeFile(join(root, ".git", "HEAD"), "garbage\n");
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("symbolic HEAD の参照先 ref が壊れているときは unborn と誤認せず失敗する", async () => {
  const root = await newGitRoot();
  await writeFile(join(root, ".git", "refs", "heads", "main"), "garbage\n");
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("symbolic HEAD の参照先 ref が dangling symlink でも unborn と誤認せず失敗する", async () => {
  const root = await newGitRoot();
  const ref = join(root, ".git", "refs", "heads", "main");
  await rm(ref);
  // 存在しない参照先への symlink（.git/refs/heads/absent-target に解決され、実体は無い）。
  // symbolic-ref は refs/heads/main を返すので、非空の出力だけでは unborn を断定できない
  await symlink("absent-target", ref);
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("symbolic HEAD の参照先 ref が directory でも unborn と誤認せず失敗する", async () => {
  const root = await newGitRoot();
  const ref = join(root, ".git", "refs", "heads", "main");
  await rm(ref);
  await mkdir(ref, { recursive: true });
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("index が壊れているときは追跡なし扱いにせず失敗する", async () => {
  const root = await newGitRoot();
  await writeFile(join(root, ".git", "index"), "not an index");
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("git コマンド不在では保守的 fallback（manifest なしは空でもエラー、ありは検証）", async () => {
  const root = await newRoot();
  await addWork(root, "plain-work", { files: ["index.html"] });
  await mkdir(join(root, "works", "residue"), { recursive: true });
  const originalPath = process.env.PATH;
  process.env.PATH = "/nonexistent-for-work-json-test";
  let works;
  try {
    works = await loadWorks({ rootDir: root });
  } finally {
    process.env.PATH = originalPath;
  }
  assert.ok(findWork(works, "residue")?.errors.some((error) => error.includes("work.json")));
  assert.deepEqual(findWork(works, "plain-work")?.errors, []);
});

test("親 repo に包含される非 Git ROOT は非 Git として保守的に扱う", async () => {
  const parent = await newRoot();
  git(parent, "init", "-q", "-b", "main");
  const root = join(parent, "app");
  await mkdir(join(root, "works"), { recursive: true });
  await addWork(root, "plain-work", { files: ["index.html"] });
  await mkdir(join(root, "works", "residue", "node_modules"), { recursive: true });
  await writeFile(join(root, "works", "residue", "node_modules", "x.js"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(findWork(works, "plain-work")?.errors, []);
  assert.ok(findWork(works, "residue")?.errors.some((error) => error.includes("work.json")));
});

test("cwd が違っても rootDir の列挙結果は同じ", async () => {
  const root = await newGitRoot();
  const originalCwd = process.cwd();
  process.chdir(tmpdir());
  try {
    const works = await loadWorks({ rootDir: root });
    assert.deepEqual(works.map((work) => work.dirName), ["tide-bloom"]);
  } finally {
    process.chdir(originalCwd);
  }
});

test("gitignore 済みでも証拠なし dir の src/ は除外されない", async () => {
  const root = await newGitRoot();
  await writeFile(join(root, ".gitignore"), "works/ghost-src/\n");
  const workDir = join(root, "works", "ghost-src");
  await mkdir(join(workDir, "src"), { recursive: true });
  await writeFile(join(workDir, "src", "main.ts"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "ghost-src")?.errors.some((error) => error.includes("work.json")));
});

test("work.json が読めないならエラーを隠さない", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root では権限制限のテストが無効");
    return;
  }
  const root = await newGitRoot();
  await addWork(root, "aqua-drift", { files: ["index.html"] });
  const manifest = join(root, "works", "aqua-drift", "work.json");
  await chmod(manifest, 0o000);
  let works;
  try {
    works = await loadWorks({ rootDir: root });
  } finally {
    await chmod(manifest, 0o600);
  }
  assert.ok(findWork(works, "aqua-drift")?.errors.length > 0);
});

test("未コミット新規 Git では証拠が index のみでも src/ だけの dir はエラー", async () => {
  const root = await newRoot();
  git(root, "init", "-q", "-b", "main");
  await mkdir(join(root, "works", "half-made", "src"), { recursive: true });
  await writeFile(join(root, "works", "half-made", "src", "main.ts"), "x");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "half-made")?.errors.some((error) => error.includes("work.json")));
});

// ── ここから t_768f9683 の実装参照後に追加した内部境界ケース ──

test("works/ 自体が無くても index 残留 slug は欠落エラーで列挙する", async () => {
  const root = await newGitRoot();
  await rm(join(root, "works"), { recursive: true, force: true });
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "tide-bloom")?.errors.length > 0);
});

test("works 直下の追跡ファイルは index 候補として「ディレクトリでない」エラー", async () => {
  const root = await newGitRoot();
  await writeFile(join(root, "works", "stray.txt"), "x");
  git(root, "add", "works/stray.txt");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "stray.txt")?.errors.some((error) => error.includes("ディレクトリでない")));
});

test("work.json が通常ファイル以外（FIFO）ならエラー", async (t) => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "aqua-drift");
  await mkdir(workDir, { recursive: true });
  const manifest = join(workDir, "work.json");
  const fifo = spawnSync("mkfifo", [manifest]);
  if (fifo.error || fifo.status !== 0) {
    t.skip("mkfifo を使えない環境");
    return;
  }
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "aqua-drift")?.errors.some((error) => error.includes("通常ファイルでない")));
});

test("works/ の走査が拒否されたらエラーを隠さない", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root では権限制限のテストが無効");
    return;
  }
  const root = await newGitRoot();
  await chmod(join(root, "works"), 0o000);
  let rejected = false;
  try {
    await loadWorks({ rootDir: root });
  } catch {
    rejected = true;
  } finally {
    await chmod(join(root, "works"), 0o700);
  }
  assert.ok(rejected);
});

test("work.json が配列ならオブジェクト検証でエラー", async () => {
  const root = await newGitRoot();
  const workDir = join(root, "works", "aqua-drift");
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "work.json"), "[]");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "aqua-drift")?.errors.some((error) => error.includes("オブジェクト")));
});

test("date が実在しない暦日ならエラー", async () => {
  const root = await newGitRoot();
  await addWork(root, "aqua-drift", {
    files: ["index.html"],
    work: workJson("aqua-drift", { date: "2026-02-30" }),
  });
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "aqua-drift")?.errors.some((error) => error.includes("date")));
});

test("generatedImages が上限を超えるとエラー", async () => {
  const root = await newGitRoot();
  const images = Array.from({ length: 11 }, (_, index) => ({ file: `a${index}.png`, prompt: "p", model: "m" }));
  await addWork(root, "aqua-drift", { files: ["index.html"], work: workJson("aqua-drift", { generatedImages: images }) });
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "aqua-drift")?.errors.some((error) => error.includes("上限")));
});

test("autopilot で MIT 以外の license はエラー", async () => {
  const root = await newGitRoot();
  await addWork(root, "aqua-drift", {
    files: ["index.html"],
    work: workJson("aqua-drift", { license: "AGPL-3.0" }),
  });
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "aqua-drift")?.errors.some((error) => error.includes("license")));
});

test("summary は 80 文字まで（コードポイント数）で 81 文字はエラー", async () => {
  const root = await newGitRoot();
  await addWork(root, "aqua-drift", {
    files: ["index.html"],
    work: workJson("aqua-drift", { summary: "あ".repeat(80) }),
  });
  await addWork(root, "bass-well", {
    files: ["index.html"],
    work: workJson("bass-well", { summary: "あ".repeat(81) }),
  });
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(findWork(works, "aqua-drift")?.errors, []);
  assert.ok(findWork(works, "bass-well")?.errors.some((error) => error.includes("81 文字")));
});

// ── ここから t_419775da（検証R1）の仕様由来で追加した受入ケース（V-1/V-2 の Git 証拠統合） ──

/** 「唯一の HEAD 証拠 + index 全削除 staged + 生成物残存」の V-1 系 fixture */
async function newHeadOnlyEvidenceRoot(fileName) {
  const root = await newRoot();
  git(root, "init", "-q", "-b", "main");
  const srcDir = join(root, "works", "evidence-work", "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(join(srcDir, fileName), "x");
  git(root, "add", ".");
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "evidence");
  git(root, "rm", "-q", "-r", "works/evidence-work");
  await mkdir(join(root, "works", "evidence-work", "dist"), { recursive: true });
  await writeFile(join(root, "works", "evidence-work", "dist", "bundle.js"), "x");
  return root;
}

test("HEAD の唯一の証拠パスにスペースが含まれていても欠落エラーにする", async () => {
  const root = await newHeadOnlyEvidenceRoot("source file.txt");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "evidence-work")?.errors.length > 0);
});

test("HEAD の唯一の証拠パスに改行が含まれていても欠落エラーにする", async () => {
  const root = await newHeadOnlyEvidenceRoot("source\nfile.txt");
  const works = await loadWorks({ rootDir: root });
  assert.ok(findWork(works, "evidence-work")?.errors.length > 0);
});

test("symbolic HEAD の参照先 ref が読めないときは unborn と誤認せず失敗する", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root では権限制限のテストが無効");
    return;
  }
  const root = await newGitRoot();
  const ref = join(root, ".git", "refs", "heads", "main");
  await chmod(ref, 0o000);
  let rejected = false;
  try {
    await loadWorks({ rootDir: root });
  } catch {
    rejected = true;
  } finally {
    await chmod(ref, 0o600);
  }
  assert.ok(rejected);
});

test("symbolic HEAD の参照先が実在しない object でも unborn や成功に潰さず失敗する", async () => {
  const root = await newGitRoot();
  // 40 桁 SHA は rev-parse --verify を通るが object が無く、ls-tree HEAD が失敗する
  await writeFile(join(root, ".git", "refs", "heads", "main"), "0123456789012345678901234567890123456789\n");
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("worktree（.git が file）でも HEAD 証拠で欠落エラーを検出する", async () => {
  const root = await newGitRoot();
  const wtParent = await mkdtemp(join(tmpdir(), "work-json-wt-"));
  tmpRoots.push(wtParent);
  const wt = join(wtParent, "wt");
  git(root, "worktree", "add", "-q", "-b", "wt1", wt);
  await rm(join(wt, "works", "tide-bloom", "work.json"));
  const works = await loadWorks({ rootDir: wt });
  assert.ok(findWork(works, "tide-bloom")?.errors.length > 0);
});

test("HEAD にだけ証拠が残る作品 dir symlink は候補にならず列挙外のまま", async () => {
  const root = await newGitRoot();
  git(root, "rm", "-q", "-r", "--cached", "works/tide-bloom");
  await rm(join(root, "works", "tide-bloom"), { recursive: true, force: true });
  const stash = join(root, "stash", "tide-bloom");
  await mkdir(stash, { recursive: true });
  await writeFile(join(stash, "index.html"), "x");
  await symlink(stash, join(root, "works", "tide-bloom"));
  const works = await loadWorks({ rootDir: root });
  assert.ok(!works.some((work) => work.dirName === "tide-bloom"));
});

// ── ここから t_c3a91e71（検証R2）の仕様由来で追加した受入ケース（V-2-R1 の統合境界） ──

test("HEAD 唯一の証拠 + index 全削除 staged + dist 残存でも refs/heads/main が dangling symlink なら unborn や成功に潰さず失敗する", async () => {
  const root = await newHeadOnlyEvidenceRoot("source.txt");
  const ref = join(root, ".git", "refs", "heads", "main");
  await rm(ref);
  await symlink("absent-target", ref);
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("同 fixture で refs/heads/main が directory でも unborn や成功に潰さず失敗する", async () => {
  const root = await newHeadOnlyEvidenceRoot("source.txt");
  const ref = join(root, ".git", "refs", "heads", "main");
  await rm(ref);
  await mkdir(ref, { recursive: true });
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("refs/heads/main が packed-refs のみにある commit 済み repo は通常どおり列挙する", async () => {
  const root = await newGitRoot();
  const sha = git(root, "rev-parse", "HEAD").trim();
  await rm(join(root, ".git", "refs", "heads", "main"));
  await writeFile(join(root, ".git", "packed-refs"), `${sha} refs/heads/main\n`);
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(works.map((work) => work.dirName), ["tide-bloom"]);
  assert.deepEqual(findWork(works, "tide-bloom")?.errors, []);
});

test("packed-refs に参照先が在るのに object が解決できないなら unborn に潰さず失敗する", async () => {
  const root = await newGitRoot();
  await rm(join(root, ".git", "refs", "heads", "main"));
  await writeFile(join(root, ".git", "packed-refs"), "0123456789012345678901234567890123456789 refs/heads/main\n");
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

// ── ここから t_3c3708fc（修正R3）の仕様由来で追加した受入ケース（R2-V1 の packed-refs 境界） ──

/** 「HEAD 唯一の証拠」fixture から loose ref を消したもの（packed-refs 系反例の土台） */
async function newHeadOnlyEvidenceWithoutLooseRef() {
  const root = await newHeadOnlyEvidenceRoot("source.txt");
  await rm(join(root, ".git", "refs", "heads", "main"));
  return root;
}

/** fixture 事前条件: loose ref が不在であること（loose が残ると packed-refs 側の反例にならない） */
function assertLooseRefAbsent(root) {
  assert.throws(
    () => lstatSync(join(root, ".git", "refs", "heads", "main")),
    (error) => error.code === "ENOENT",
  );
}

test("HEAD 唯一の証拠 + index 全削除 staged + dist 残存でも packed-refs が dangling symlink なら unborn や成功に潰さず失敗する", async () => {
  const root = await newHeadOnlyEvidenceWithoutLooseRef();
  const packed = join(root, ".git", "packed-refs");
  await symlink("absent-packed-target", packed);
  assertLooseRefAbsent(root);
  // 事前条件: packed-refs は lstat 上 symlink で、stat（参照先追跡）では不在＝dangling
  assert.ok(lstatSync(packed).isSymbolicLink());
  assert.throws(() => statSync(packed), (error) => error.code === "ENOENT");
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("packed-refs が実在する先への symlink でも unborn に潰さず失敗する", async () => {
  const root = await newHeadOnlyEvidenceWithoutLooseRef();
  const packed = join(root, ".git", "packed-refs");
  // 実体は git が読める有効な packed-refs 形式（別名 refname）にする。git 自身の読み取り失敗で
  // 止まらず、symlink の実体種別そのもので失敗することを確認する
  await writeFile(join(root, ".git", "packed-refs.real"), "0123456789012345678901234567890123456789 refs/heads/main2\n");
  await symlink(join(root, ".git", "packed-refs.real"), packed);
  assertLooseRefAbsent(root);
  assert.ok(lstatSync(packed).isSymbolicLink());
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("packed-refs が directory でも unborn に潰さず失敗する", async () => {
  const root = await newHeadOnlyEvidenceWithoutLooseRef();
  const packed = join(root, ".git", "packed-refs");
  await mkdir(packed, { recursive: true });
  assertLooseRefAbsent(root);
  assert.ok(lstatSync(packed).isDirectory());
  await assert.rejects(() => loadWorks({ rootDir: root }));
});

test("packed-refs が読めないときは unborn と誤認せず失敗する", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root では権限制限のテストが無効");
    return;
  }
  const root = await newHeadOnlyEvidenceWithoutLooseRef();
  const packed = join(root, ".git", "packed-refs");
  await writeFile(packed, "0123456789012345678901234567890123456789 refs/heads/main\n");
  await chmod(packed, 0o000);
  let rejected = false;
  try {
    await loadWorks({ rootDir: root });
  } catch {
    rejected = true;
  } finally {
    await chmod(packed, 0o600);
  }
  assert.ok(rejected);
});

test("packed-refs の refname は完全一致で比較し、前方一致の別名を誤検知しない", async () => {
  const root = await newGitRoot();
  const sha = git(root, "rev-parse", "HEAD").trim();
  await rm(join(root, ".git", "refs", "heads", "main"));
  await writeFile(join(root, ".git", "packed-refs"), `${sha} refs/heads/main2\n`);
  // 別名 refname を参照先と誤認して throw せず、正規 unborn 対照として index 証拠から列挙する
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(works.map((work) => work.dirName), ["tide-bloom"]);
  assert.deepEqual(findWork(works, "tide-bloom")?.errors, []);
});

test("packed-refs にヘッダと peel 行があっても通常どおり列挙する", async () => {
  const root = await newGitRoot();
  const sha = git(root, "rev-parse", "HEAD").trim();
  await rm(join(root, ".git", "refs", "heads", "main"));
  await writeFile(
    join(root, ".git", "packed-refs"),
    `# pack-refs with: peeled fully-peeled sorted \n${sha} refs/heads/main\n^${sha}\n`,
  );
  const works = await loadWorks({ rootDir: root });
  assert.deepEqual(findWork(works, "tide-bloom")?.errors, []);
});

test("既定引数では ROOT_DIR の works を読む（worktree の 4 作品、errors 空）", async () => {
  const works = await loadWorks();
  assert.deepEqual(
    works.map((work) => work.dirName),
    ["heartburst", "light-domino", "prism-pop", "shatter-spire"],
  );
  assert.ok(works.every((work) => work.errors.length === 0), JSON.stringify(works));
});
