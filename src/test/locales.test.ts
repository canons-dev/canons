// English is the source of truth; every translation must keep the same
// structure (files, paths, rule ids, headings) so they cannot drift apart.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { availableLocales, loadCanon, PACKAGE_ROOT, sha256 } from "../content.ts";
import { parseListKey } from "../rules.ts";

const ids = (text: string) => [...text.matchAll(/\*\*([A-Z]\d+)\*\*/g)].map((m) => m[1]);
const headings = (text: string) =>
  text.split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => l.match(/^#+/)![0].length);

test("every locale mirrors the English structure", () => {
  const en = loadCanon("en");
  assert.ok(availableLocales().length >= 2);
  for (const locale of availableLocales()) {
    const other = loadCanon(locale);
    assert.deepEqual(ids(other.block), ids(en.block), `${locale}: block ids`);
    assert.deepEqual(headings(other.block), headings(en.block), `${locale}: block headings`);
    assert.deepEqual([...other.rules.keys()], [...en.rules.keys()], `${locale}: rule files`);
    for (const [file, text] of en.rules) {
      const t = other.rules.get(file)!;
      assert.deepEqual(parseListKey(t, "paths"), parseListKey(text, "paths"), `${locale}/${file}: paths`);
      assert.deepEqual(ids(t), ids(text), `${locale}/${file}: ids`);
      assert.deepEqual(headings(t), headings(text), `${locale}/${file}: headings`);
    }
  }
});

test("rule ids are unique and sequential per prefix", () => {
  const en = loadCanon("en");
  const all = [ids(en.block), ...[...en.rules.values()].map(ids)].flat() as string[];
  assert.equal(new Set(all).size, all.length, "duplicate id");
  const byPrefix = new Map<string, number[]>();
  for (const id of all) {
    const list = byPrefix.get(id[0]!) ?? [];
    list.push(Number(id.slice(1)));
    byPrefix.set(id[0]!, list);
  }
  for (const [prefix, nums] of byPrefix)
    assert.deepEqual(nums, nums.map((_, i) => i + 1), `${prefix} ids must run 1..n`);
});

test("the block statement of non-relaxable ids names existing ids", () => {
  const en = loadCanon("en");
  const named = en.block.split("\n").find((l) => l.includes("never relax"))!;
  for (const id of named.match(/C\d+/g)!) assert.ok(ids(en.block).includes(id), id);
});

// Shipped content must stay project-neutral. The deny-list holds sha256
// hashes of lower-cased tokens, so this file names nothing it guards against.
const DENY = new Set([
  "7ef24dfd443298f82d8e979ad4a113195885c3de7a8ccdeddd0bcf8734c00a82",
  "c8ca1f51341e4d319d91011b355db7472c2108d1d528a52625a2aaeaf55d2f4a",
  "102cf10b5286bad9fcfe5e275ace3ddd7dcc23931fb0ca93dc223daf9877cabd",
  "7cf25a10f77bcfeef0578d568aaefd170cfd58f6fde813d1449dc67425ae62da",
  "7fecbcab5cf8cc739b4cd51fbd569d8c76be9949d25da43cdec2219e5cd65cd9",
  "d198283987981fc73f6fb39f3ffc0d0e0c43f28384081d71eb587e9e568474a3",
  "787ef1c79f5c0ec3d82d202234feae328a8d74253cc86b01fbf16cb3754d3af9",
]);

// Every token, its hyphen-separated parts and each adjacent pair of parts.
function candidates(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z0-9_-]+/g) ?? []) {
    const parts = token.split("-").filter(Boolean);
    out.add(token);
    parts.forEach((part, i) => {
      out.add(part);
      if (i > 0) out.add(`${parts[i - 1]}-${part}`);
    });
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (["node_modules", ".git", "out"].includes(name)) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("no deny-listed names in shipped files", () => {
  const hits: string[] = [];
  for (const file of walk(PACKAGE_ROOT)) {
    if (file === resolve(PACKAGE_ROOT, "LICENSE")) continue;
    const text = readFileSync(file, "utf8");
    for (const word of candidates(text)) if (DENY.has(sha256(word))) hits.push(`${file}: ${word}`);
  }
  assert.deepEqual(hits, []);
});
