// scripts/tests/work-json.test.mjs ─ loadWorks の作品列挙と欠落検出の回帰テスト。
// 実行: node --test scripts/tests/work-json.test.mjs
// fixture はすべて tmpdir の隔離領域に作る（実リポジトリの works/ には触れない）。
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

test("既定引数では ROOT_DIR の works を読む（worktree の 4 作品、errors 空）", async () => {
  const works = await loadWorks();
  assert.deepEqual(
    works.map((work) => work.dirName),
    ["heartburst", "light-domino", "prism-pop", "shatter-spire"],
  );
  assert.ok(works.every((work) => work.errors.length === 0), JSON.stringify(works));
});
