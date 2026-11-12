// End to end against a copy of fixtures/minimal in a fresh git repository.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { check } from "../check.ts";
import { main } from "../cli.ts";
import { PACKAGE_ROOT } from "../content.ts";
import {
  changedScopePaths,
  expandScopePaths,
  loadScopeRules,
  matchScopeRules,
} from "../rules.ts";
import { init, sync } from "../sync.ts";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "canons-e2e-"));
  cpSync(resolve(PACKAGE_ROOT, "src/test/fixtures/minimal"), root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function synced(): string {
  const root = fixture();
  sync(root);
  return root;
}

const errorsOf = (root: string) => check(root).errors.join("\n");

test("sync writes block, managed rules, links and lock; check passes", () => {
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
  assert.deepEqual(check(root), { errors: [], warnings: [] });
  assert.deepEqual(sync(root), [], "second sync is a no-op");
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

test("hand edits to managed content are caught by check and refused by sync", () => {
  const root = synced();
  const agents = join(root, "AGENTS.md");
  writeFileSync(agents, readFileSync(agents, "utf8").replace("**C8**", "**C8** (edited)"));
  assert.match(errorsOf(root), /edited by hand/);
  assert.throws(() => sync(root), /local edits/);
  sync(root, { force: true });
  assert.deepEqual(check(root).errors, []);

  const rule = join(root, ".agents/rules/canons/vendor.md");
  writeFileSync(rule, `${readFileSync(rule, "utf8")}\n- extra\n`);
  assert.match(errorsOf(root), /vendor\.md was edited by hand/);
  assert.throws(() => sync(root), /local edits/);

  sync(root, { force: true });
  writeFileSync(join(root, ".agents/rules/canons/mine.md"), "---\nx: 1\n---\n");
  assert.match(errorsOf(root), /mine\.md is not managed/);
  assert.throws(() => sync(root), /not managed by canons/);
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
  writeFileSync(join(root, ".agents/rules/apis.md"), '---\npaths:\n  - "src/nothing/**"\n---\n');
  assert.match(check(root).warnings.join("\n"), /matches no file under src\/nothing/);

  rmSync(join(root, "CLAUDE.md"));
  writeFileSync(join(root, "CLAUDE.md"), "copy\n");
  assert.match(errorsOf(root), /CLAUDE\.md must be a symlink/);
  assert.throws(() => sync(root), /exists but is not a symlink/);
});

test("init creates canons.json in the chosen locale; codex-only skips links", () => {
  const root = fixture();
  rmSync(join(root, "canons.json"));
  init(root, "zh-CN");
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /locale=zh-CN/);
  assert.throws(() => init(root, "en"), /already exists/);

  const codexOnly = fixture();
  writeFileSync(join(codexOnly, "canons.json"), JSON.stringify({ version: 1, clients: ["codex"] }));
  sync(codexOnly);
  assert.equal(lstatSync(join(codexOnly, "CLAUDE.md"), { throwIfNoEntry: false }), undefined);
  assert.deepEqual(check(codexOnly).errors, []);
});

test("breaking upgrades need --accept-major", () => {
  const root = synced();
  const lockPath = join(root, "canons.lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  writeFileSync(lockPath, JSON.stringify({ ...lock, canons: "0.0.1" }));
  assert.throws(() => sync(root), /breaking upgrade/);
  sync(root, { acceptMajor: true });
  assert.deepEqual(check(root).errors, []);
});

test("cli exit codes", () => {
  const root = synced();
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(main(["check"], root), 0);
    writeFileSync(join(root, "AGENTS.override.md"), "x\n");
    assert.equal(main(["check"], root), 1);
    assert.equal(main(["scopes", "src/api/hello.ts"], root), 0);
    assert.throws(() => main(["check", "--nope"], root), /unknown option/);
  } finally {
    console.log = log;
  }
});
