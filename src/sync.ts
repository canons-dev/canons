// `canons init` / `canons sync`: write the managed block, managed rules,
// client adapters and the lock. Never overwrites local edits silently.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, posix, relative, resolve } from "node:path";
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  LOCK_FILE,
  ROOT_FILE,
  loadConfig,
  type CanonsConfig,
} from "./config.ts";
import {
  MANAGED_SUBDIR,
  CONTENT_ROOT,
  extractBlock,
  isBreakingUpgrade,
  loadCanon,
  parseLock,
  renderBlock,
  renderLock,
  sha256,
  upsertBlock,
  type Lock,
} from "./content.ts";
import { listMarkdown } from "./rules.ts";

export interface SyncOptions {
  acceptMajor?: boolean;
  force?: boolean;
  contentRoot?: string;
}

const PROJECT_TEMPLATE = `## Project rules

<!-- Project-specific red lines, stack, naming and verification commands go here, outside the canons block. -->
`;

export function readLock(root: string): Lock | undefined {
  const file = resolve(root, LOCK_FILE);
  return existsSync(file) ? parseLock(readFileSync(file, "utf8")) : undefined;
}

/** Client adapter links: link path -> relative target, both repo-relative. */
export function clientLinks(config: CanonsConfig): Map<string, string> {
  const links = new Map<string, string>();
  if (config.clients.includes("claude")) {
    links.set("CLAUDE.md", ROOT_FILE);
    links.set(".claude/rules", posix.relative(".claude", config.rulesDir));
    links.set(".claude/skills", posix.relative(".claude", config.skillsDir));
  }
  return links;
}

export function managedRulePath(config: CanonsConfig, file: string): string {
  return `${config.rulesDir}/${MANAGED_SUBDIR}/${file}`;
}

export function sync(root: string, options: SyncOptions = {}): string[] {
  const log: string[] = [];
  const config = loadConfig(root);
  const canon = loadCanon(config.locale, options.contentRoot ?? CONTENT_ROOT);
  const lock = readLock(root);

  if (lock && isBreakingUpgrade(lock.canons, canon.version) && !options.acceptMajor)
    throw new Error(
      `canons ${lock.canons} -> ${canon.version} is a breaking upgrade of the rules. Review the changelog, then rerun with --accept-major.`,
    );

  // Refuse to overwrite local edits to managed content.
  const rootPath = resolve(root, ROOT_FILE);
  const rootText = existsSync(rootPath) ? readFileSync(rootPath, "utf8") : "";
  const edited: string[] = [];
  const current = rootText ? extractBlock(rootText) : undefined;
  if (current && sha256(current.body) !== current.attrs.sha256)
    edited.push(`${ROOT_FILE} (managed block)`);
  for (const [path, hash] of Object.entries(lock?.files ?? {})) {
    const abs = resolve(root, path);
    if (existsSync(abs) && sha256(readFileSync(abs, "utf8")) !== hash)
      edited.push(path);
  }
  const managedDir = resolve(root, config.rulesDir, MANAGED_SUBDIR);
  const known = new Set([
    ...Object.keys(lock?.files ?? {}),
    ...[...canon.rules.keys()].map((f) => managedRulePath(config, f)),
  ]);
  if (existsSync(managedDir))
    for (const file of listMarkdown(managedDir)) {
      const path = managedRulePath(config, file);
      if (!known.has(path)) edited.push(`${path} (not managed by canons)`);
    }
  if (edited.length && !options.force)
    throw new Error(
      `local edits to managed content:\n  ${edited.join("\n  ")}\nMove project-specific text outside the canons block / ${config.rulesDir}/${MANAGED_SUBDIR}/, or rerun with --force to discard the edits.`,
    );

  // Root file and block.
  const block = renderBlock(canon);
  const nextRoot = rootText
    ? upsertBlock(rootText, block)
    : `# AGENTS.md\n\n${block}\n\n${PROJECT_TEMPLATE}`;
  if (nextRoot !== rootText.replace(/\r\n/g, "\n")) {
    writeFileSync(rootPath, nextRoot);
    log.push(`${rootText ? "updated" : "created"} ${ROOT_FILE}`);
  }

  // Managed rules: write shipped files, remove ones no longer shipped.
  const files: Record<string, string> = {};
  for (const [file, text] of canon.rules) {
    const path = managedRulePath(config, file);
    const abs = resolve(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs) || readFileSync(abs, "utf8") !== text) {
      writeFileSync(abs, text);
      log.push(`wrote ${path}`);
    }
    files[path] = sha256(text);
  }
  for (const path of Object.keys(lock?.files ?? {}))
    if (!(path in files) && existsSync(resolve(root, path))) {
      rmSync(resolve(root, path));
      log.push(`removed ${path}`);
    }
  if (existsSync(managedDir))
    for (const file of listMarkdown(managedDir)) {
      const path = managedRulePath(config, file);
      if (!(path in files)) {
        rmSync(resolve(root, path));
        log.push(`removed ${path}`);
      }
    }
  // Git does not track empty directories; without a placeholder a fresh clone
  // would get a dangling .claude/skills link.
  const skillsAbs = resolve(root, config.skillsDir);
  mkdirSync(skillsAbs, { recursive: true });
  if (!readdirSync(skillsAbs).length) {
    writeFileSync(resolve(skillsAbs, ".gitkeep"), "");
    log.push(`created ${config.skillsDir}/.gitkeep`);
  }

  // Client adapters (relative symlinks; never clobber a real file).
  for (const [link, target] of clientLinks(config)) {
    const abs = resolve(root, link);
    const stat = lstatSync(abs, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() && readlinkSync(abs) === target) continue;
    if (stat)
      throw new Error(
        `${link} exists but is not a symlink to ${target}. Merge its content into ${ROOT_FILE} (outside the canons block) or ${config.rulesDir}, remove it, and rerun.`,
      );
    mkdirSync(dirname(abs), { recursive: true });
    symlinkSync(target, abs);
    log.push(`linked ${link} -> ${target}`);
  }

  const nextLock: Lock = {
    lockfileVersion: 1,
    canons: canon.version,
    locale: canon.locale,
    block: sha256(canon.block),
    files,
  };
  const lockText = renderLock(nextLock);
  const lockPath = resolve(root, LOCK_FILE);
  if (!existsSync(lockPath) || readFileSync(lockPath, "utf8") !== lockText) {
    writeFileSync(lockPath, lockText);
    log.push(`wrote ${LOCK_FILE}`);
  }
  return log;
}

export function init(
  root: string,
  locale = DEFAULT_CONFIG.locale,
  options: SyncOptions = {},
): string[] {
  const configPath = resolve(root, CONFIG_FILE);
  if (existsSync(configPath))
    throw new Error(`${CONFIG_FILE} already exists; run "canons sync"`);
  // Validate the locale before writing anything.
  loadCanon(locale, options.contentRoot ?? CONTENT_ROOT);
  const config = { version: 1, locale, clients: DEFAULT_CONFIG.clients };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return [`created ${CONFIG_FILE}`, ...sync(root, options)];
}

/** Used by check: lists repo-relative paths of files under a dir, recursively. */
export function filesUnder(root: string, dir: string): string[] {
  const abs = resolve(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (sub: string) => {
    for (const e of readdirSync(resolve(abs, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else out.push(relative(root, resolve(abs, rel)).split("\\").join("/"));
    }
  };
  walk("");
  return out.sort();
}
