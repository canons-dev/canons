import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  globToRe,
  loadScopeRules,
  matchScopeRules,
  parseListKey,
  staticPrefix,
} from "../rules.ts";

test("globToRe: *, ?, ** and literal brackets", () => {
  assert.ok(globToRe("src/**/*.ts").test("src/a.ts"), "** matches zero dirs");
  assert.ok(globToRe("src/**/*.ts").test("src/lib/deep/a.ts"));
  assert.ok(!globToRe("src/*.ts").test("src/lib/a.ts"), "* stays in segment");
  assert.ok(globToRe("src/a?.ts").test("src/a1.ts"));
  assert.ok(!globToRe("src/a?.ts").test("src/a/1.ts"), "? stays in segment");
  assert.ok(globToRe("app/(app)/[id]/*.tsx").test("app/(app)/[id]/page.tsx"));
  assert.ok(globToRe("docs/**").test("docs/a/b.md"));
});

test("globToRe rejects unsupported syntax", () => {
  for (const bad of ["", "/abs", "../up", "a/{b,c}", "!neg", "a\\b"])
    assert.throws(() => globToRe(bad), /unsupported rule path/);
});

test("staticPrefix", () => {
  assert.equal(staticPrefix("src/lib/**/*.ts"), "src/lib");
  assert.equal(staticPrefix("AGENTS.md"), "AGENTS.md");
  assert.equal(staticPrefix("**/x.md"), "");
});

test("parseListKey", () => {
  const fm = (body: string) => `---\n${body}\n---\n# x\n`;
  assert.deepEqual(parseListKey(fm('paths:\n  - "a/**"\n  - b.md'), "paths"), [
    "a/**",
    "b.md",
  ]);
  assert.deepEqual(parseListKey(fm("other: 1"), "paths"), []);
  assert.throws(() => parseListKey("# no fm\n", "paths"), /frontmatter/);
  assert.throws(() => parseListKey(fm("paths: [a]"), "paths"), /block list/);
  assert.throws(() => parseListKey(fm("paths:\n"), "paths"), /empty/);
  assert.throws(
    () => parseListKey(fm("paths:\n  - a/** # note"), "paths"),
    /trailing comments/,
  );
});

test("loadScopeRules scans subdirectories and matches", () => {
  const root = mkdtempSync(join(tmpdir(), "canons-rules-"));
  mkdirSync(join(root, ".agents/rules/canons"), { recursive: true });
  writeFileSync(
    join(root, ".agents/rules/apis.md"),
    '---\npaths:\n  - "src/api/**"\n---\n',
  );
  writeFileSync(join(root, ".agents/rules/canons/global.md"), "---\nx: 1\n---\n");
  const rules = loadScopeRules(root, ".agents/rules");
  assert.deepEqual(
    rules.map((r) => r.file),
    [".agents/rules/apis.md", ".agents/rules/canons/global.md"],
  );
  const hit = matchScopeRules(rules, ["src/api/a.ts"]);
  assert.equal(hit.length, 2, "global rule always returned");
  const miss = matchScopeRules(rules, ["src/web/a.ts"]);
  assert.deepEqual(
    miss.map((r) => r.file),
    [".agents/rules/canons/global.md"],
  );
});

test("loadScopeRules names the broken file", () => {
  const root = mkdtempSync(join(tmpdir(), "canons-rules-"));
  mkdirSync(join(root, ".agents/rules"), { recursive: true });
  writeFileSync(join(root, ".agents/rules/bad.md"), '---\npaths:\n  - "{a,b}"\n---\n');
  assert.throws(() => loadScopeRules(root, ".agents/rules"), /bad\.md/);
});
