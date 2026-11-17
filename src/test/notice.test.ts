// The update notice must never slow down or break the command it rides on.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DAY_MS,
  checkDisabled,
  decline,
  isNewer,
  readCache,
  refreshCache,
  updateNotice,
  writeCache,
} from "../notice.ts";

const tempDir = () => mkdtempSync(join(tmpdir(), "canons-notice-"));
const NOW = 1_800_000_000_000;
const quiet = { env: {} as Record<string, string>, command: "npx canons", now: NOW };

test("isNewer compares plain x.y.z releases only", () => {
  assert.ok(isNewer("0.3.0", "0.2.0"));
  assert.ok(isNewer("1.0.0", "0.9.9"));
  assert.ok(!isNewer("0.2.0", "0.2.0"));
  assert.ok(!isNewer("0.1.9", "0.2.0"));
  assert.ok(!isNewer("0.3.0-rc.1", "0.2.0"));
  assert.ok(!isNewer(42, "0.2.0"));
});

test("disabled in CI and by CANONS_NO_UPDATE_CHECK", () => {
  assert.ok(checkDisabled({ CI: "true" }));
  assert.ok(checkDisabled({ CANONS_NO_UPDATE_CHECK: "1" }));
  assert.ok(!checkDisabled({ CI: "false" }));
  assert.ok(!checkDisabled({}));
  const dir = tempDir();
  let refreshes = 0;
  const line = updateNotice({ ...quiet, env: { CI: "1" }, installed: "0.2.0", dir, refresh: () => refreshes++ });
  assert.equal(line, undefined);
  assert.equal(refreshes, 0, "no background refresh when disabled");
});

test("a stale cache starts one refresh a day and never waits for it", () => {
  const dir = tempDir();
  let refreshes = 0;
  // A refresh that never finishes: the notice must still return at once.
  const refresh = () => {
    refreshes++;
    void new Promise(() => {});
  };
  const started = performance.now();
  assert.equal(updateNotice({ ...quiet, installed: "0.2.0", dir, refresh }), undefined);
  assert.ok(performance.now() - started < 200, "returns without waiting");
  assert.equal(refreshes, 1);
  updateNotice({ ...quiet, now: NOW + 1000, installed: "0.2.0", dir, refresh });
  assert.equal(refreshes, 1, "attempted today, even though it has not finished");
  updateNotice({ ...quiet, now: NOW + DAY_MS + 1, installed: "0.2.0", dir, refresh });
  assert.equal(refreshes, 2, "a day later it tries again");
});

test("a newer version is mentioned at most once a day, never once declined", () => {
  const dir = tempDir();
  writeCache(dir, { latest: "0.3.0", checkedAt: NOW });
  const opts = { ...quiet, installed: "0.2.0", dir, refresh: () => {} };
  assert.match(updateNotice(opts) ?? "", /^canons 0\.3\.0 is available \(this repository uses 0\.2\.0, a breaking upgrade\)\. Details: npx canons latest$/);
  assert.equal(updateNotice({ ...opts, now: NOW + 1000 }), undefined, "once a day");
  assert.match(updateNotice({ ...opts, now: NOW + DAY_MS + 1 }) ?? "", /0\.3\.0/);
  assert.equal(updateNotice({ ...opts, installed: "0.3.0", now: NOW + 3 * DAY_MS }), undefined, "up to date");

  decline("0.3.0", { CANONS_CACHE_DIR: dir });
  assert.equal(updateNotice({ ...opts, now: NOW + 5 * DAY_MS }), undefined, "declined");
  writeCache(dir, { ...readCache(dir), latest: "0.3.1", checkedAt: NOW + 5 * DAY_MS });
  assert.match(updateNotice({ ...opts, now: NOW + 5 * DAY_MS }) ?? "", /0\.3\.1 is available/, "a later version is raised again");
});

test("corrupt caches, unwritable directories and failing refreshes are silent", () => {
  const corrupt = tempDir();
  writeFileSync(join(corrupt, "latest.json"), "{not json");
  assert.equal(updateNotice({ ...quiet, installed: "0.2.0", dir: corrupt, refresh: () => {} }), undefined);
  writeFileSync(join(corrupt, "latest.json"), JSON.stringify({ latest: { evil: true }, declined: "x", notified: 7 }));
  assert.equal(updateNotice({ ...quiet, installed: "0.2.0", dir: corrupt, refresh: () => {} }), undefined);

  const throwing = tempDir();
  assert.equal(
    updateNotice({ ...quiet, installed: "0.2.0", dir: throwing, refresh: () => { throw new Error("no fork"); } }),
    undefined,
  );

  if (process.getuid?.() !== 0) {
    const locked = tempDir();
    chmodSync(locked, 0o500);
    try {
      assert.equal(updateNotice({ ...quiet, installed: "0.2.0", dir: join(locked, "sub"), refresh: () => {} }), undefined);
    } finally {
      chmodSync(locked, 0o700);
    }
  }
});

test("refreshCache stores the registry's latest and swallows every failure", async () => {
  const dir = tempDir();
  const ok = (async () => new Response(JSON.stringify({ version: "0.4.0" }))) as typeof fetch;
  await refreshCache(dir, {}, ok, NOW);
  assert.deepEqual(readCache(dir), { latest: "0.4.0", checkedAt: NOW });

  const offline = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  await refreshCache(dir, {}, offline, NOW + 1);
  const notFound = (async () => new Response("nope", { status: 404 })) as typeof fetch;
  await refreshCache(dir, {}, notFound, NOW + 2);
  const junk = (async () => new Response(JSON.stringify({ version: "<script>" }))) as typeof fetch;
  await refreshCache(dir, {}, junk, NOW + 3);
  assert.deepEqual(readCache(dir), { latest: "0.4.0", checkedAt: NOW }, "failures leave the cache as it was");
  assert.equal(JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")).latest, "0.4.0");
});
