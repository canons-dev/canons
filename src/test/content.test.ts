import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseConfig } from "../config.ts";
import {
  extractBlock,
  isBreakingUpgrade,
  loadCanon,
  PACKAGE_ROOT,
  renderBlock,
  sha256,
  upsertBlock,
} from "../content.ts";

test("renderBlock / extractBlock round-trip", () => {
  const canon = loadCanon("en");
  const block = renderBlock(canon);
  const info = extractBlock(`# T\n\n${block}\n\nrest\n`);
  assert.ok(info);
  assert.equal(info.body, canon.block);
  assert.equal(info.attrs.sha256, sha256(canon.block));
  assert.equal(info.attrs.version, canon.version);
});

test("upsertBlock inserts after the H1 and replaces in place", () => {
  const canon = loadCanon("en");
  const block = renderBlock(canon);
  const inserted = upsertBlock("# Title\n\nproject text\n", block);
  assert.match(inserted, /^# Title\n\n<!-- canons:begin /);
  assert.match(inserted, /canons:end -->\n\nproject text\n$/);
  assert.equal(upsertBlock(inserted, block), inserted, "idempotent");
});

test("extractBlock rejects duplicate blocks", () => {
  const block = renderBlock(loadCanon("en"));
  assert.throws(() => extractBlock(`${block}\n${block}`), /exactly one/);
});

test("isBreakingUpgrade", () => {
  assert.equal(isBreakingUpgrade("1.2.0", "2.0.0"), true);
  assert.equal(isBreakingUpgrade("1.2.0", "1.3.0"), false);
  assert.equal(isBreakingUpgrade("0.1.0", "0.2.0"), true);
  assert.equal(isBreakingUpgrade("0.1.0", "0.1.5"), false);
  assert.equal(isBreakingUpgrade("1.0.0", "0.9.0"), false);
});

test("parseConfig rejects unknown keys and unshipped features", () => {
  assert.equal(parseConfig({ format: 1 }).locale, "en");
  assert.throws(() => parseConfig({ format: 1, locales: "x" }), /unknown key/);
  for (const removed of ["version", "clients", "rulesDir", "skillsDir", "presets", "hooks"])
    assert.throws(() => parseConfig({ format: 1, [removed]: 1 }), /unknown key/);
  assert.throws(() => parseConfig({ format: 1, agents: ["vim"] }), /agents/);
  assert.throws(() => parseConfig({ format: 1, budget: 40000 }), /32768/);
  assert.throws(() => parseConfig({ format: 1, source: ["../x"] }), /source/);
  for (const key of Object.keys(parseConfig({ format: 1 })))
    assert.match(key, /^[a-z]{6}$/, "config keys have six lowercase letters");
});

test("unknown locale lists the available ones", () => {
  assert.throws(() => loadCanon("xx"), /available: en, zh-CN/);
});

test("npm script names have six lowercase letters, except npm lifecycle hooks", () => {
  const lifecycle = new Set(["prepack", "prepare", "prepublishOnly", "postpack"]);
  const scripts = Object.keys(JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).scripts);
  for (const name of scripts) if (!lifecycle.has(name)) assert.match(name, /^[a-z]{6}$/, name);
});
