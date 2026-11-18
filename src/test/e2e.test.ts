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
  symlinkSync,
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
import { doctor } from "../doctor.ts";

// The update notice reads and refreshes a per-user cache; keep tests away from it.
process.env.CANONS_NO_UPDATE_CHECK = "1";

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
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.equal(lstatSync(join(root, "CLAUDE.md")).isFile(), true);
  assert.equal(readlinkSync(join(root, ".claude/rules")), "../.agents/rules");
  assert.equal(readlinkSync(join(root, ".claude/skills")), "../.agents/skills");
  readFileSync(join(root, ".agents/rules/canons/layout.md"), "utf8");
  assert.match(readFileSync(join(root, ".agents/skills/canons/SKILL.md"), "utf8"), /^---\nname: canons\n/);
  const lock = JSON.parse(readFileSync(join(root, "canons.lock.json"), "utf8"));
  for (const key of Object.keys(lock)) assert.match(key, /^[a-z]{6}$/, "lock keys have six lowercase letters");
  assert.deepEqual(Object.keys(lock.hashes), [
    ".agents/rules/canons/layout.md",
    ".agents/rules/canons/vendor.md",
    ".agents/skills/canons/SKILL.md",
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
  writeFileSync(config, JSON.stringify({ format: 1, budget: 1000, naming: "^[a-z]{6}$" }));
  const errors = errorsOf(root);
  assert.match(errors, /over the 1000-byte budget/);
  assert.match(errors, /apis\.md: name does not match/);
  assert.doesNotMatch(errors, /layout\.md: name/, "managed subdir is exempt");

  writeFileSync(config, JSON.stringify({ format: 1 }));
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
  assert.match(errorsOf(root), /CLAUDE\.md must hold only the import "@AGENTS\.md"/);
  assert.throws(() => update(root), /CLAUDE\.md exists with its own content/);

  // The symlink adapter of earlier versions is replaced by the import.
  rmSync(join(root, "CLAUDE.md"));
  symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
  assert.match(errorsOf(root), /CLAUDE\.md is a symlink; run "canons update"/);
  assert.ok(update(root).includes("wrote CLAUDE.md (imports AGENTS.md)"));
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.equal(lstatSync(join(root, "CLAUDE.md")).isSymbolicLink(), false);
});

test("create creates canons.json in the chosen locale; codex-only skips links", () => {
  const root = fixture();
  rmSync(join(root, "canons.json"));
  create(root, { locale: "zh-CN" });
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /locale=zh-CN/);
  assert.throws(() => create(root, { locale: "en" }), /already exists/);

  const codexOnly = fixture();
  writeFileSync(join(codexOnly, "canons.json"), JSON.stringify({ format: 1, agents: ["codex"] }));
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
  assert.throws(() => create(root), /CLAUDE\.md exists with its own content/);
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
  writeFileSync(config, JSON.stringify({ format: 1, source: ["lib"] }));
  assert.match(errorsOf(root), /declares anchors, but source \(lib\) holds no files/);
  writeFileSync(config, JSON.stringify({ format: 1, source: ["../x"] }));
  assert.match(errorsOf(root), /source must be a non-empty list/);
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
  writeFileSync(join(root, ".claude/skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: Deploy the service.\n---\n");

  assert.throws(() => create(root), /Rerun with --adopt/);
  assert.deepEqual(readdirSync(root).sort(), [".claude", ".git", "CLAUDE.md"], "refusal changes nothing");

  const log = create(root, { adopt: true });
  assert.ok(log.includes("adopted CLAUDE.md into AGENTS.md"), log.join("\n"));
  assert.ok(log.includes("adopted .claude/rules into .agents/rules (1 entry)"), log.join("\n"));
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /^# Service\n\n<!-- canons:begin/);
  assert.match(agents, /Project notes\./);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
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

  // An identical copy is simply replaced by the import.
  rmSync(join(root, "CLAUDE.md"));
  writeFileSync(join(root, "CLAUDE.md"), readFileSync(join(root, "AGENTS.md"), "utf8"));
  update(root, { adopt: true });
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");

  rmSync(join(root, ".claude/rules"));
  mkdirSync(join(root, ".claude/rules"));
  writeFileSync(join(root, ".claude/rules/apis.md"), "clash\n");
  assert.throws(() => update(root, { adopt: true }), /both contain apis\.md/);
  assert.equal(lstatSync(join(root, ".claude/rules")).isDirectory(), true, "nothing moved");
});

test("links are checked in AGENTS.md, skills and docset, not inside code", () => {
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
  assert.deepEqual(verify(root).errors, [], "docs are not checked unless listed in docset");

  writeFileSync(join(root, "canons.json"), JSON.stringify({ format: 1, docset: ["doc"] }));
  assert.match(errorsOf(root), /doc\/guide\.md: broken link gone\.md/);

  mkdirSync(join(root, ".agents/skills/ship"), { recursive: true });
  writeFileSync(join(root, ".agents/skills/ship/SKILL.md"), "---\nname: ship\ndescription: Ship it.\n---\n\n[run](missing.sh)\n");
  assert.match(verify(root).warnings.join("\n"), /SKILL\.md: broken link missing\.sh/);
});

test("the managed skill is guarded like managed rules", () => {
  const root = synced();
  const skill = join(root, ".agents/skills/canons/SKILL.md");
  writeFileSync(skill, `${readFileSync(skill, "utf8")}\nlocal note\n`);
  assert.match(errorsOf(root), /\.agents\/skills\/canons\/SKILL\.md was edited by hand/);
  assert.throws(() => update(root), /local edits to managed content/);
  writeFileSync(join(root, ".agents/skills/canons/extra.md"), "mine\n");
  assert.match(errorsOf(root), /extra\.md is not managed by canons/);
});

test("scopes adds the update notice on stderr only; stdout and the exit code are unchanged", () => {
  const root = synced();
  const dir = mkdtempSync(join(tmpdir(), "canons-cache-"));
  writeFileSync(join(dir, "latest.json"), JSON.stringify({ latest: "99.0.0", checkedAt: Date.now() }));
  const saved = { ...process.env };
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (line: string) => out.push(line);
  console.error = (line: string) => err.push(line);
  try {
    delete process.env.CANONS_NO_UPDATE_CHECK;
    delete process.env.CI;
    process.env.CANONS_CACHE_DIR = dir;
    assert.equal(main(["scopes", "--json", "src/api/hello.ts"], root), 0);
    const withNotice = out.join("\n");
    assert.match(err.join("\n"), /canons 99\.0\.0 is available/);

    out.length = 0;
    err.length = 0;
    process.env.CANONS_NO_UPDATE_CHECK = "1";
    assert.equal(main(["scopes", "--json", "src/api/hello.ts"], root), 0);
    assert.equal(out.join("\n"), withNotice, "--json output is identical");
    assert.deepEqual(err, []);

    delete process.env.CANONS_NO_UPDATE_CHECK;
    assert.equal(main(["latest", "--decline", "99.0.0"], root), 0);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")).declined, ["99.0.0"]);
  } finally {
    console.log = log;
    console.error = error;
    process.env = saved;
  }
});

test("skills follow the Agent Skills format; long files and nested references warn", () => {
  const root = synced();
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(".agents/skills/bare/SKILL.md", "# no frontmatter\n");
  write(".agents/skills/named/SKILL.md", "---\nname: other\n---\n");
  write(".agents/skills/Bad--name/SKILL.md", `---\nname: Bad--name\ndescription: >\n  ${"x".repeat(1025)}\n---\n`);
  write(".agents/skills/fine/SKILL.md", '---\nname: fine\ndescription: "Does a thing: well."\n---\n\nSee [ref](ref.md) and [docs](../../../AGENTS.md).\n');
  write(".agents/skills/fine/ref.md", "[deeper](deep.md)\n");
  write(".agents/skills/fine/deep.md", "end\n");
  const { errors, warnings } = verify(root);
  const text = errors.join("\n");
  assert.match(text, /bare\/SKILL\.md: no YAML frontmatter/);
  assert.match(text, /named\/SKILL\.md: name "other" must match its directory name "named"/);
  assert.match(text, /named\/SKILL\.md: frontmatter has no description/);
  assert.match(text, /Bad--name\/SKILL\.md: name "Bad--name" must use lowercase letters/);
  assert.match(text, /Bad--name\/SKILL\.md: description is longer than 1024/);
  assert.doesNotMatch(text, /fine\/SKILL\.md/);
  assert.deepEqual(
    warnings.filter((w) => w.includes("fine/")),
    [".agents/skills/fine/SKILL.md: ref.md links on to deep.md; keep references one level deep from SKILL.md"],
    "links out of the skill directory do not count",
  );

  write(".agents/skills/fine/SKILL.md", `---\nname: fine\ndescription: Fine.\n---\n${"line\n".repeat(500)}`);
  write(".agents/rules/huge.md", `---\npaths:\n  - "src/**"\n---\n${"- item\n".repeat(500)}`);
  const long = verify(root).warnings.join("\n");
  assert.match(long, /fine\/SKILL\.md: 504 lines, over 500/);
  assert.match(long, /huge\.md: 504 lines, over 500/);
});

test("verify warns about scripts and paths that project instructions name but no longer exist", () => {
  const root = synced();
  const agentsPath = join(root, "AGENTS.md");
  writeFileSync(
    agentsPath,
    `${readFileSync(agentsPath, "utf8")}
- Run \`npm run lint\` and \`npm test\`; \`npm run -s test\`, \`npm run --silent test\`; \`npm run build -w web\`, \`npm --prefix web run build\` and \`cd web && npm run build\` are another package.
- Handlers: \`src/api/\`, \`src/gone.ts\`, \`src/api/hello.ts:3\`, \`next/server.js\`, \`@scope/pkg\`, \`../sibling/x.md\`, \`tmp/notes.md\`, \`src/**\`.

\`\`\`sh
npm run deploy
\`\`\`
`,
  );
  writeFileSync(join(root, ".gitignore"), "tmp/\n");
  const warnings = verify(root).warnings.filter((w) => w.startsWith("AGENTS.md"));
  assert.deepEqual(warnings.sort(), [
    'AGENTS.md: `npm run deploy` has no "deploy" script in package.json',
    'AGENTS.md: `npm run lint` has no "lint" script in package.json',
    "AGENTS.md: `src/gone.ts` does not exist",
  ]);
  assert.deepEqual(
    verify(root).warnings.filter((w) => w.includes("canons/")),
    [],
    "managed content is not checked",
  );

  // A nested package.json answers for files below it; skill paths also resolve from the skill.
  mkdirSync(join(root, "web/.agents"), { recursive: true });
  writeFileSync(join(root, "web/package.json"), '{"scripts":{"build":"x"}}');
  writeFileSync(join(root, "web/AGENTS.md"), "Run `npm run build` and `npm run lint`.\n");
  mkdirSync(join(root, ".agents/skills/ship/scripts"), { recursive: true });
  writeFileSync(join(root, ".agents/skills/ship/scripts/run.sh"), "");
  writeFileSync(
    join(root, ".agents/skills/ship/SKILL.md"),
    "---\nname: ship\ndescription: Ship.\n---\n\nRun `scripts/run.sh`, not `scripts/old.sh`.\n",
  );
  const nested = verify(root).warnings.filter((w) => w.startsWith("web/") || w.includes("ship/"));
  assert.deepEqual(nested.sort(), [
    ".agents/skills/ship/SKILL.md: `.agents/skills/ship/scripts/old.sh` does not exist",
    'web/AGENTS.md: `npm run lint` has no "lint" script in web/package.json',
  ]);

  // An unparsable package.json has no scripts, so every one is reported.
  writeFileSync(join(root, "web/package.json"), "{");
  assert.match(verify(root).warnings.join("\n"), /web\/AGENTS\.md: `npm run build` has no "build" script/);
});

test("a corrupt lock file is reported, not a crash", () => {
  const root = synced();
  for (const text of ["null", "{", "[]"]) {
    writeFileSync(join(root, "canons.lock.json"), text);
    assert.match(errorsOf(root), /canons\.lock\.json is not a valid canons lock file/);
    assert.throws(() => update(root), /not a valid canons lock file/);
  }
});

test("a CLAUDE.md directory is refused before anything is written", () => {
  const root = synced();
  rmSync(join(root, "CLAUDE.md"));
  mkdirSync(join(root, "CLAUDE.md"));
  writeFileSync(join(root, "CLAUDE.md/notes.md"), "x\n");
  const before = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.throws(() => update(root, { adopt: true }), /CLAUDE\.md is not a regular file/);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), before);
  assert.match(errorsOf(root), /CLAUDE\.md must hold only the import/);
});

test("doctor points real client files at --adopt", () => {
  const root = synced();
  assert.ok(!doctor(root).some((line) => line.includes("--adopt")), "a clean setup needs no fix");
  writeFileSync(join(root, "CLAUDE.md"), "own notes\n");
  assert.ok(doctor(root).some((line) => line.startsWith("fix   CLAUDE.md is a real file") && line.includes("--adopt")));
  writeFileSync(join(root, "canons.json"), "{");
  assert.ok(doctor(root).some((line) => line.startsWith("fix   canons.json is not valid JSON")));
});

test("scopes --effective lists the AGENTS.md chain and matched rules with byte counts", () => {
  const root = synced();
  mkdirSync(join(root, "src/api/v2"), { recursive: true });
  writeFileSync(join(root, "src/api/AGENTS.md"), "# API\n");
  const out: string[] = [];
  const log = console.log;
  console.log = (line: string) => out.push(line);
  try {
    assert.equal(main(["scopes", "--effective", "--json", "src/api/v2/x.ts"], root), 0);
  } finally {
    console.log = log;
  }
  const result = JSON.parse(out.join("\n")) as { effective: { file: string; bytes: number }[]; bytes: number };
  out.length = 0;
  console.log = (line: string) => out.push(line);
  try {
    assert.equal(main(["scopes", "--effective", "src/api"], root), 0);
  } finally {
    console.log = log;
  }
  const text = out.join("\n");
  assert.match(text, /Effective instructions: \d+ file\(s\), \d+ bytes/);
  assert.match(text, /^\s+6  src\/api\/AGENTS\.md$/m);
  const files = result.effective.map((e) => e.file);
  assert.deepEqual(files.slice(0, 2), ["AGENTS.md", "src/api/AGENTS.md"]);
  assert.ok(files.includes(".agents/rules/apis.md"));
  assert.equal(result.effective[1]!.bytes, 6);
  assert.equal(result.bytes, result.effective.reduce((sum, e) => sum + e.bytes, 0));
});

test("verify warns about CLAUDE.md citations and dated history in project instructions", () => {
  const root = synced();
  const agentsPath = join(root, "AGENTS.md");
  writeFileSync(
    agentsPath,
    `${readFileSync(agentsPath, "utf8")}
- Git flow: see \`CLAUDE.md\` §Git, or [the guide](CLAUDE.md#git).
- The handler was renamed on 2026-08-18.
- 2026-11 起改为先部署再合并。
- Releases ship on 2026-12-01.

\`\`\`text
renamed 2026-01-01 inside a fence is fine
\`\`\`
`,
  );
  const warnings = verify(root).warnings.filter((w) => w.startsWith("AGENTS.md:"));
  const lines = (pattern: RegExp) =>
    warnings.filter((w) => pattern.test(w)).map((w) => Number(/^AGENTS\.md:(\d+)/.exec(w)![1]));
  const text = readFileSync(agentsPath, "utf8").split("\n");
  const lineOf = (needle: string) => text.findIndex((l) => l.includes(needle)) + 1;
  assert.deepEqual(lines(/cites CLAUDE\.md/), [lineOf("Git flow")], "one warning per line, with the real line number");
  assert.deepEqual(lines(/dated history/), [lineOf("renamed on"), lineOf("起改为")]);
  assert.ok(!warnings.some((w) => w.includes("canons:begin")));
});
