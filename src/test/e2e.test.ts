// End to end against a copy of fixtures/minimal in a fresh git repository.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { verify } from "../verify.ts";
import { main } from "../cli.ts";
import { PACKAGE_ROOT } from "../content.ts";
import {
  changedScopePaths,
  expandScopePaths,
  loadScopeRules,
  matchScopeRules,
} from "../rules.ts";
import { create, update } from "../update.ts";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "canons-e2e-"));
  cpSync(resolve(PACKAGE_ROOT, "src/test/fixtures/minimal"), root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function synced(): string {
  const root = fixture();
  update(root);
  return root;
}

const errorsOf = (root: string) => verify(root).errors.join("\n");

test("update writes block, managed rules, links and lock; verify passes", () => {
  const root = synced();
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /^# Example service\n\n<!-- canons:begin version=/);
  assert.match(agents, /## Project rules/, "project text kept");
  assert.equal(readlinkSync(join(root, "CLAUDE.md")), "AGENTS.md");
  assert.equal(readlinkSync(join(root, ".claude/rules")), "../.agents/rules");
  assert.equal(readlinkSync(join(root, ".claude/skills")), "../.agents/skills");
  readFileSync(join(root, ".agents/rules/canons/layout.md"), "utf8");
  readFileSync(join(root, ".agents/skills/.gitkeep"), "utf8");
  const lock = JSON.parse(readFileSync(join(root, "canons.lock.json"), "utf8"));
  assert.deepEqual(Object.keys(lock.files), [
    ".agents/rules/canons/layout.md",
    ".agents/rules/canons/vendor.md",
  ]);
  assert.deepEqual(verify(root), { errors: [], warnings: [] });
  assert.deepEqual(update(root), [], "second update is a no-op");
});

test("scopes: project and managed rules, recursive, --changed without HEAD", () => {
  const root = synced();
  const rules = loadScopeRules(root, ".agents/rules");
  const api = matchScopeRules(rules, expandScopePaths(root, ["src/api/hello.ts"]));
  assert.deepEqual(api.map((r) => r.file), [".agents/rules/apis.md"]);
  const viaLink = matchScopeRules(rules, expandScopePaths(root, [".claude/rules/apis.md"]));
  assert.ok(viaLink.some((r) => r.file === ".agents/rules/canons/layout.md"));
  const changed = changedScopePaths(root);
  assert.ok(changed.includes("AGENTS.md"));
  const dir = expandScopePaths(root, ["src"]);
  assert.deepEqual(dir, ["src/api/hello.ts"]);
});

test("hand edits to managed content are caught by verify and refused by update", () => {
  const root = synced();
  const agents = join(root, "AGENTS.md");
  writeFileSync(agents, readFileSync(agents, "utf8").replace("**C8**", "**C8** (edited)"));
  assert.match(errorsOf(root), /edited by hand/);
  assert.throws(() => update(root), /local edits/);
  update(root, { force: true });
  assert.deepEqual(verify(root).errors, []);

  const rule = join(root, ".agents/rules/canons/vendor.md");
  writeFileSync(rule, `${readFileSync(rule, "utf8")}\n- extra\n`);
  assert.match(errorsOf(root), /vendor\.md was edited by hand/);
  assert.throws(() => update(root), /local edits/);

  update(root, { force: true });
  writeFileSync(join(root, ".agents/rules/canons/mine.md"), "---\nx: 1\n---\n");
  assert.match(errorsOf(root), /mine\.md is not managed/);
  assert.throws(() => update(root), /not managed by canons/);
});

test("Codex hazards: AGENTS.override.md and the 32 KiB chain", () => {
  const root = synced();
  writeFileSync(join(root, "AGENTS.override.md"), "x\n");
  assert.match(errorsOf(root), /AGENTS\.override\.md: Codex reads it instead/);
  rmSync(join(root, "AGENTS.override.md"));
  mkdirSync(join(root, "src/deep"), { recursive: true });
  writeFileSync(join(root, "src/AGENTS.md"), "a".repeat(14 * 1024));
  writeFileSync(join(root, "src/deep/AGENTS.md"), "b".repeat(14 * 1024));
  assert.match(errorsOf(root), /AGENTS\.md \+ src\/AGENTS\.md \+ src\/deep\/AGENTS\.md = \d+ bytes/);
});

test("root budget, broken links, naming and copies instead of links", () => {
  const root = synced();
  const config = join(root, "canons.json");
  writeFileSync(config, JSON.stringify({ version: 1, budgetBytes: 1000, ruleNamePattern: "^[a-z]{6}$" }));
  const errors = errorsOf(root);
  assert.match(errors, /over the 1000-byte budget/);
  assert.match(errors, /apis\.md: name does not match/);
  assert.doesNotMatch(errors, /layout\.md: name/, "managed subdir is exempt");

  writeFileSync(config, JSON.stringify({ version: 1 }));
  writeFileSync(join(root, ".agents/rules/apis.md"), '---\npaths:\n  - "src/api/**"\n---\n\nSee [docs](docs/api.md).\n');
  assert.match(errorsOf(root), /broken link docs\/api\.md/);
  mkdirSync(join(root, "src/app/(app)/shell"), { recursive: true });
  writeFileSync(join(root, "src/app/(app)/shell/page.tsx"), "export {};\n");
  writeFileSync(
    join(root, ".agents/rules/apis.md"),
    '---\npaths:\n  - "src/api/**"\n---\n\nSee [page](<../../src/app/(app)/shell/page.tsx>), [same](../../src/app/(app)/shell/page.tsx "title") and [gone](../../src/app/(app)/nope.tsx).\n',
  );
  const linkErrors = errorsOf(root);
  assert.match(linkErrors, /broken link \.\.\/\.\.\/src\/app\/\(app\)\/nope\.tsx/);
  assert.doesNotMatch(linkErrors, /shell\/page\.tsx/);
  writeFileSync(join(root, ".agents/rules/apis.md"), '---\npaths:\n  - "src/nothing/**"\n---\n');
  assert.match(verify(root).warnings.join("\n"), /matches no file under src\/nothing/);

  rmSync(join(root, "CLAUDE.md"));
  writeFileSync(join(root, "CLAUDE.md"), "copy\n");
  assert.match(errorsOf(root), /CLAUDE\.md must be a symlink/);
  assert.throws(() => update(root), /exists but is not a symlink/);
});

test("create creates canons.json in the chosen locale; codex-only skips links", () => {
  const root = fixture();
  rmSync(join(root, "canons.json"));
  create(root, { locale: "zh-CN" });
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /locale=zh-CN/);
  assert.throws(() => create(root, { locale: "en" }), /already exists/);

  const codexOnly = fixture();
  writeFileSync(join(codexOnly, "canons.json"), JSON.stringify({ version: 1, clients: ["codex"] }));
  update(codexOnly);
  assert.equal(lstatSync(join(codexOnly, "CLAUDE.md"), { throwIfNoEntry: false }), undefined);
  assert.deepEqual(verify(codexOnly).errors, []);
});

test("create picks the npx runner without package.json; verify warns on a local runner without the package", () => {
  const root = mkdtempSync(join(tmpdir(), "canons-runner-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  create(root);
  const config = JSON.parse(readFileSync(join(root, "canons.json"), "utf8"));
  assert.equal(config.runner, "npx");
  const version = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf8")).version;
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.ok(agents.includes(`\`npx -y @canons-dev/canons@${version} scopes`), "block names the pinned command");
  assert.ok(!agents.includes("`npx canons"), "no local command left");
  assert.deepEqual(verify(root), { errors: [], warnings: [] });

  writeFileSync(join(root, "canons.json"), JSON.stringify({ ...config, runner: "local" }));
  update(root);
  assert.match(verify(root).warnings.join("\n"), /runner is "local" but package.json does not list/);

  const node = fixture();
  rmSync(join(node, "canons.json"));
  create(node);
  assert.equal(JSON.parse(readFileSync(join(node, "canons.json"), "utf8")).runner, "local");
  assert.deepEqual(verify(node), { errors: [], warnings: [] });
});

test("a refused create or update changes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "canons-refuse-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "CLAUDE.md"), "own notes\n");
  assert.throws(() => create(root), /CLAUDE\.md exists but is not a symlink/);
  assert.deepEqual(readdirSync(root).sort(), [".git", "CLAUDE.md"]);

  rmSync(join(root, "CLAUDE.md"));
  if (process.getuid?.() !== 0) {
    chmodSync(root, 0o555);
    try {
      assert.throws(() => create(root), /cannot write in this repository.*Nothing was changed/s);
    } finally {
      chmodSync(root, 0o755);
    }
    assert.deepEqual(readdirSync(root), [".git"]);
  }
  create(root);
  assert.deepEqual(verify(root).errors, []);
});

test("anchors must still appear in the source directories", () => {
  const root = synced();
  assert.deepEqual(verify(root).errors, []);
  const rule = join(root, ".agents/rules/apis.md");
  writeFileSync(rule, readFileSync(rule, "utf8").replace("  - hello", "  - hello\n  - goodbye"));
  assert.match(errorsOf(root), /apis\.md: anchor "goodbye" no longer appears in src/);
  assert.doesNotMatch(errorsOf(root), /anchor "hello"/);

  const config = join(root, "canons.json");
  writeFileSync(config, JSON.stringify({ version: 1, sourceDirs: ["lib"] }));
  assert.match(errorsOf(root), /declares anchors, but sourceDirs \(lib\) holds no files/);
  writeFileSync(config, JSON.stringify({ version: 1, sourceDirs: ["../x"] }));
  assert.match(errorsOf(root), /sourceDirs must be a non-empty list/);
});

test("breaking upgrades need --accept-major", () => {
  const root = synced();
  const lockPath = join(root, "canons.lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  writeFileSync(lockPath, JSON.stringify({ ...lock, canons: "0.0.1" }));
  assert.throws(() => update(root), /breaking upgrade/);
  update(root, { acceptMajor: true });
  assert.deepEqual(verify(root).errors, []);
});

test("cli: old command names point at the new ones", () => {
  const root = synced();
  assert.throws(() => main(["sync"], root), /"sync" is now "update"/);
  assert.throws(() => main(["init"], root), /"init" is now "create"/);
  assert.throws(() => main(["check"], root), /"check" is now "verify"/);
});

test("create writes the project settings skeleton in the chosen locale", () => {
  const en = mkdtempSync(join(tmpdir(), "canons-settings-"));
  execFileSync("git", ["init", "-q"], { cwd: en });
  create(en);
  const text = readFileSync(join(en, "AGENTS.md"), "utf8");
  assert.match(text, /## Project settings\n[\s\S]*UI language:[\s\S]*## Project rules/);
  const zh = mkdtempSync(join(tmpdir(), "canons-settings-"));
  execFileSync("git", ["init", "-q"], { cwd: zh });
  create(zh, { locale: "zh-CN" });
  assert.match(readFileSync(join(zh, "AGENTS.md"), "utf8"), /## 项目设定\n[\s\S]*UI 语言：/);
});

test("cli exit codes", () => {
  const root = synced();
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(main(["verify"], root), 0);
    writeFileSync(join(root, "AGENTS.override.md"), "x\n");
    assert.equal(main(["verify"], root), 1);
    assert.equal(main(["scopes", "src/api/hello.ts"], root), 0);
    assert.throws(() => main(["verify", "--nope"], root), /unknown option/);
  } finally {
    console.log = log;
  }
});

test("--adopt moves real client files and directories into place", () => {
  // A repository that only Claude Code could read: a real CLAUDE.md and .claude/ directories.
  const root = mkdtempSync(join(tmpdir(), "canons-adopt-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "CLAUDE.md"), "# Service\n\nProject notes.\n");
  mkdirSync(join(root, ".claude/rules"), { recursive: true });
  writeFileSync(join(root, ".claude/rules/apis.md"), '---\npaths:\n  - "CLAUDE.md"\n---\n\n# APIs\n');
  mkdirSync(join(root, ".claude/skills/deploy"), { recursive: true });
  writeFileSync(join(root, ".claude/skills/deploy/SKILL.md"), "---\nname: deploy\n---\n");

  assert.throws(() => create(root), /Rerun with --adopt/);
  assert.deepEqual(readdirSync(root).sort(), [".claude", ".git", "CLAUDE.md"], "refusal changes nothing");

  const log = create(root, { adopt: true });
  assert.ok(log.includes("adopted CLAUDE.md into AGENTS.md"), log.join("\n"));
  assert.ok(log.includes("adopted .claude/rules into .agents/rules (1 entry)"), log.join("\n"));
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /^# Service\n\n<!-- canons:begin/);
  assert.match(agents, /Project notes\./);
  assert.equal(readlinkSync(join(root, "CLAUDE.md")), "AGENTS.md");
  assert.equal(readlinkSync(join(root, ".claude/rules")), "../.agents/rules");
  assert.equal(readlinkSync(join(root, ".claude/skills")), "../.agents/skills");
  readFileSync(join(root, ".agents/rules/apis.md"), "utf8");
  readFileSync(join(root, ".agents/rules/canons/layout.md"), "utf8");
  readFileSync(join(root, ".agents/skills/deploy/SKILL.md"), "utf8");
  assert.deepEqual(verify(root).errors, []);
});

test("--adopt refuses to overwrite or merge diverging content", () => {
  const root = synced();
  rmSync(join(root, "CLAUDE.md"));
  writeFileSync(join(root, "CLAUDE.md"), "different notes\n");
  assert.throws(() => update(root, { adopt: true }), /both exist with different content/);

  // An identical copy is simply replaced by the link.
  rmSync(join(root, "CLAUDE.md"));
  writeFileSync(join(root, "CLAUDE.md"), readFileSync(join(root, "AGENTS.md"), "utf8"));
  update(root, { adopt: true });
  assert.equal(readlinkSync(join(root, "CLAUDE.md")), "AGENTS.md");

  rmSync(join(root, ".claude/rules"));
  mkdirSync(join(root, ".claude/rules"));
  writeFileSync(join(root, ".claude/rules/apis.md"), "clash\n");
  assert.throws(() => update(root, { adopt: true }), /both contain apis\.md/);
  assert.equal(lstatSync(join(root, ".claude/rules")).isDirectory(), true, "nothing moved");
});

test("links are checked in AGENTS.md, skills and docDirs, not inside code", () => {
  const root = synced();
  const agentsPath = join(root, "AGENTS.md");
  writeFileSync(
    agentsPath,
    `${readFileSync(agentsPath, "utf8")}\nSee [guide](doc/guide.md), \`[x](not/a/link.md)\` and\n\n\`\`\`md\n[y](also/not.md)\n\`\`\`\n`,
  );
  assert.match(errorsOf(root), /AGENTS\.md: broken link doc\/guide\.md/);
  assert.doesNotMatch(errorsOf(root), /not\/a\/link|also\/not/);
  mkdirSync(join(root, "doc"));
  writeFileSync(join(root, "doc/guide.md"), "[gone](gone.md)\n");
  assert.deepEqual(verify(root).errors, [], "docs are not checked unless listed in docDirs");

  writeFileSync(join(root, "canons.json"), JSON.stringify({ version: 1, docDirs: ["doc"] }));
  assert.match(errorsOf(root), /doc\/guide\.md: broken link gone\.md/);

  mkdirSync(join(root, ".agents/skills/ship"), { recursive: true });
  writeFileSync(join(root, ".agents/skills/ship/SKILL.md"), "[run](missing.sh)\n");
  assert.match(verify(root).warnings.join("\n"), /SKILL\.md: broken link missing\.sh/);
});
