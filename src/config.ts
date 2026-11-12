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

export interface CanonsConfig {
  version: 1;
  locale: string;
  clients: Client[];
  rulesDir: string;
  skillsDir: string;
  /** Byte budget for the root AGENTS.md alone. */
  budgetBytes: number;
  /** Optional naming rule for the project's own top-level rule files (basename without .md). */
  ruleNamePattern?: string;
  presets: string[];
  hooks: boolean;
}

export const DEFAULT_CONFIG: CanonsConfig = {
  version: 1,
  locale: "en",
  clients: ["codex", "claude"],
  rulesDir: ".agents/rules",
  skillsDir: ".agents/skills",
  budgetBytes: 24 * 1024,
  presets: [],
  hooks: false,
};

const KEYS = new Set([
  "$schema",
  "version",
  "locale",
  "clients",
  "rulesDir",
  "skillsDir",
  "budgetBytes",
  "ruleNamePattern",
  "presets",
  "hooks",
]);

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
  if (config.version !== 1) fail(`unsupported version ${String(config.version)}`);
  if (typeof config.locale !== "string" || !config.locale)
    fail("locale must be a non-empty string");
  if (
    !Array.isArray(config.clients) ||
    config.clients.some((c) => !(CLIENTS as readonly string[]).includes(c))
  )
    fail(`clients must be a list drawn from: ${CLIENTS.join(", ")}`);
  for (const key of ["rulesDir", "skillsDir"] as const) {
    const value = config[key];
    if (
      typeof value !== "string" ||
      !value ||
      value.startsWith("/") ||
      value.split("/").includes("..")
    )
      fail(`${key} must be a repo-relative path`);
  }
  if (!Number.isInteger(config.budgetBytes) || config.budgetBytes <= 0)
    fail("budgetBytes must be a positive integer");
  if (config.budgetBytes > CODEX_CHAIN_MAX_BYTES)
    fail(
      `budgetBytes must not exceed ${CODEX_CHAIN_MAX_BYTES} (Codex stops loading instructions beyond that)`,
    );
  if (config.ruleNamePattern !== undefined) {
    if (typeof config.ruleNamePattern !== "string")
      fail("ruleNamePattern must be a string");
    try {
      new RegExp(config.ruleNamePattern);
    } catch {
      fail("ruleNamePattern is not a valid regular expression");
    }
  }
  if (!Array.isArray(config.presets))
    fail("presets must be a list");
  if (config.presets.length)
    fail("presets are not available in this version; leave the list empty");
  if (typeof config.hooks !== "boolean") fail("hooks must be true or false");
  if (config.hooks)
    fail("hooks are not available in this version; set hooks to false");
  return config;
}

export function loadConfig(root: string): CanonsConfig {
  const file = resolve(root, CONFIG_FILE);
  if (!existsSync(file))
    throw new Error(`${CONFIG_FILE} not found in ${root}; run "canons init"`);
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
