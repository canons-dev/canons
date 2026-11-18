// canons.json: the consumer's declaration. Unknown keys are rejected so typos
// cannot silently disable a setting.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const CONFIG_FILE = "canons.json";
export const LOCK_FILE = "canons.lock.json";
export const ROOT_FILE = "AGENTS.md";
/** Codex stops loading project instructions once their combined size reaches this (default `project_doc_max_bytes`). */
export const CODEX_CHAIN_MAX_BYTES = 32 * 1024;

export const CLIENTS = ["codex", "claude"] as const;
export type Client = (typeof CLIENTS)[number];

/**
 * How the managed rules tell agents to run canons: `local` relies on the
 * package being a dev dependency (`npx canons`); `npx` names the exact
 * published version, for repositories without a package.json.
 */
export const RUNNERS = ["local", "npx"] as const;
export type Runner = (typeof RUNNERS)[number];

/** Where the real rules and skills live; client adapters link here (C1). */
export const RULES_DIR = ".agents/rules";
export const SKILLS_DIR = ".agents/skills";

export interface CanonsConfig {
  /** Format of canons.json itself. */
  format: 1;
  locale: string;
  /** Which coding agents get adapters. */
  agents: Client[];
  runner: Runner;
  /** Where rule `anchors` must still appear (repo-relative directories). */
  source: string[];
  /** Extra directories whose Markdown links `verify` checks (AGENTS.md, rules and skills are always checked). */
  docset: string[];
  /** Byte budget for the root AGENTS.md alone. */
  budget: number;
  /** Optional naming rule for the project's own top-level rule files (basename without .md). */
  naming?: string;
  /** Whether `scopes` and `doctor` mention a newer canons version (default true). */
  notify: boolean;
}

export const DEFAULT_CONFIG: CanonsConfig = {
  format: 1,
  locale: "en",
  agents: ["codex", "claude"],
  runner: "local",
  source: ["src"],
  docset: [],
  budget: 24 * 1024,
  notify: true,
};

const KEYS = new Set(["$schema", "format", "locale", "agents", "runner", "source", "docset", "budget", "naming", "notify"]);

export function parseConfig(raw: unknown): CanonsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${CONFIG_FILE} must be a JSON object`);
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj))
    if (!KEYS.has(key)) throw new Error(`${CONFIG_FILE}: unknown key "${key}"`);
  const config: CanonsConfig = { ...DEFAULT_CONFIG, ...obj } as CanonsConfig;
  const fail = (msg: string): never => {
    throw new Error(`${CONFIG_FILE}: ${msg}`);
  };
  if (config.format !== 1) fail(`unsupported format ${String(config.format)}`);
  if (typeof config.locale !== "string" || !config.locale)
    fail("locale must be a non-empty string");
  if (
    !Array.isArray(config.agents) ||
    config.agents.some((c) => !(CLIENTS as readonly string[]).includes(c))
  )
    fail(`agents must be a list drawn from: ${CLIENTS.join(", ")}`);
  if (!(RUNNERS as readonly string[]).includes(config.runner))
    fail(`runner must be one of: ${RUNNERS.join(", ")}`);
  const isRepoPath = (v: unknown) =>
    typeof v === "string" && !!v && !v.startsWith("/") && !v.split("/").includes("..");
  if (!Array.isArray(config.source) || !config.source.length || !config.source.every(isRepoPath))
    fail("source must be a non-empty list of repo-relative directories");
  if (!Array.isArray(config.docset) || !config.docset.every(isRepoPath))
    fail("docset must be a list of repo-relative directories");
  if (!Number.isInteger(config.budget) || config.budget <= 0)
    fail("budget must be a positive integer");
  if (config.budget > CODEX_CHAIN_MAX_BYTES)
    fail(
      `budget must not exceed ${CODEX_CHAIN_MAX_BYTES} (Codex stops loading instructions beyond that)`,
    );
  if (config.naming !== undefined) {
    if (typeof config.naming !== "string") fail("naming must be a string");
    try {
      new RegExp(config.naming);
    } catch {
      fail("naming is not a valid regular expression");
    }
  }
  if (typeof config.notify !== "boolean") fail("notify must be true or false");
  return config;
}

export function loadConfig(root: string): CanonsConfig {
  const file = resolve(root, CONFIG_FILE);
  if (!existsSync(file))
    throw new Error(`${CONFIG_FILE} not found in ${root}; run "canons create"`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  return parseConfig(raw);
}

/** Walks up from `start` to the nearest directory holding canons.json, else the git root. */
export function findRoot(start: string): string {
  let dir = resolve(start);
  let gitRoot: string | undefined;
  for (;;) {
    if (existsSync(resolve(dir, CONFIG_FILE))) return dir;
    if (!gitRoot && existsSync(resolve(dir, ".git"))) gitRoot = dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return gitRoot ?? resolve(start);
}
