// Update notice and `canons latest`.
//
// The notice must never slow down or break the command it rides on (agents run
// `canons scopes` on every task): the foreground only reads a small local cache,
// and when that cache is a day old it starts a detached child that refreshes it
// and exits. Every failure (no network, a sandbox, an unwritable cache, a
// corrupt file) is silent and only means no notice this time.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isBreakingUpgrade, packageName, PACKAGE_ROOT } from "./content.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = "latest.json";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export interface LatestCache {
  /** Newest published version seen. */
  latest?: string;
  /** Last successful registry read. */
  checkedAt?: number;
  /** Last time a refresh was started, successful or not; limits refreshes to one a day. */
  attemptedAt?: number;
  /** Version -> when the notice for it was last shown. */
  notified?: Record<string, number>;
  /** Versions the user declined; they are not raised again. */
  declined?: string[];
}

type Env = Record<string, string | undefined>;

export function cacheDir(env: Env = process.env): string {
  return env.CANONS_CACHE_DIR || join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "canons");
}

export function readCache(dir: string): LatestCache {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, CACHE_FILE), "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as LatestCache) : {};
  } catch {
    return {};
  }
}

/** Atomic write (temp file + rename) so a reader never sees half a file. */
export function writeCache(dir: string, cache: LatestCache): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const temp = join(dir, `${CACHE_FILE}.${process.pid}.tmp`);
    writeFileSync(temp, JSON.stringify(cache));
    renameSync(temp, join(dir, CACHE_FILE));
    return true;
  } catch {
    return false;
  }
}

/** True when `a` is a newer plain x.y.z release than `b`; anything else (pre-releases, junk) is not newer. */
export function isNewer(a: unknown, b: string): boolean {
  const parse = (v: unknown) => (typeof v === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(v) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d > 0;
  }
  return false;
}

export function checkDisabled(env: Env): boolean {
  const on = (v: string | undefined) => !!v && v !== "0" && v.toLowerCase() !== "false";
  return on(env.CI) || on(env.CANONS_NO_UPDATE_CHECK);
}

function registry(env: Env): string {
  return (env.CANONS_REGISTRY || env.npm_config_registry || DEFAULT_REGISTRY).replace(/\/+$/, "");
}

/** Reads the `latest` dist-tag from the registry. Throws on any failure. */
export async function fetchLatest(
  env: Env = process.env,
  timeoutMs = 10_000,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const name = packageName().replace("/", "%2f");
  const response = await fetchFn(`${registry(env)}/${name}/latest`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`the registry answered ${response.status}`);
  const version = ((await response.json()) as { version?: unknown }).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version))
    throw new Error("the registry returned no version");
  return version;
}

/** Body of the detached child: refresh the cache, never throw. */
export async function refreshCache(
  dir: string,
  env: Env = process.env,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
): Promise<void> {
  try {
    const latest = await fetchLatest(env, 5_000, fetchFn);
    writeCache(dir, { ...readCache(dir), latest, checkedAt: now });
  } catch {
    // Offline, blocked or slow: try again tomorrow.
  }
}

/** Starts the refresh in a detached child that outlives this process; returns at once. */
export function spawnRefresh(dir: string): void {
  // cli.ts in development, cli.js when installed: always the file beside this one.
  const here = fileURLToPath(import.meta.url);
  const script = join(here, "..", `cli${extname(here)}`);
  const child = spawn(process.execPath, [...process.execArgv, script, "__refresh"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CANONS_CACHE_DIR: dir },
  });
  child.on("error", () => {});
  child.unref();
}

export interface NoticeOptions {
  /** Version this repository runs. */
  installed: string;
  /** How the notice spells the command, e.g. `npx canons`. */
  command: string;
  env?: Env;
  now?: number;
  dir?: string;
  refresh?: (dir: string) => void;
}

/**
 * One line for stderr when a newer version is known, at most once a day per
 * version; undefined otherwise. Synchronous, local-only, never throws.
 */
export function updateNotice(options: NoticeOptions): string | undefined {
  try {
    const env = options.env ?? process.env;
    if (checkDisabled(env)) return undefined;
    const now = options.now ?? Date.now();
    const dir = options.dir ?? cacheDir(env);
    const cache = readCache(dir);
    let dirty = false;
    if (now - Math.max(cache.checkedAt ?? 0, cache.attemptedAt ?? 0) > DAY_MS) {
      cache.attemptedAt = now;
      dirty = true;
      try {
        (options.refresh ?? spawnRefresh)(dir);
      } catch {
        // No child process: no refresh this time.
      }
    }
    let line: string | undefined;
    const latest = cache.latest;
    if (
      latest &&
      isNewer(latest, options.installed) &&
      !(Array.isArray(cache.declined) && cache.declined.includes(latest)) &&
      now - (cache.notified?.[latest] ?? 0) > DAY_MS
    ) {
      cache.notified = { [latest]: now };
      dirty = true;
      const breaking = isBreakingUpgrade(options.installed, latest) ? ", a breaking upgrade" : "";
      line = `canons ${latest} is available (this repository uses ${options.installed}${breaking}). Details: ${options.command} latest`;
    }
    if (dirty) writeCache(dir, cache);
    return line;
  } catch {
    return undefined;
  }
}

export function changelogUrl(): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      repository?: { url?: string };
    };
    const m = /github\.com[/:]([^/]+\/[^/.]+)/.exec(manifest.repository?.url ?? "");
    return m ? `https://github.com/${m[1]}/blob/main/doc/CHANGELOG.md` : undefined;
  } catch {
    return undefined;
  }
}

/** Records that the user declined `version`, so the notice stops raising it. */
export function decline(version: string, env: Env = process.env): void {
  const dir = cacheDir(env);
  const cache = readCache(dir);
  const declined = new Set(Array.isArray(cache.declined) ? cache.declined : []);
  declined.add(version);
  if (!writeCache(dir, { ...cache, declined: [...declined].sort() }))
    throw new Error(`cannot write ${join(dir, CACHE_FILE)}`);
}
