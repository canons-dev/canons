// `canons create` / `canons update`: write the managed block, managed rules,
// client adapters and the lock. Never overwrites local edits silently.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { posix, relative, resolve } from "node:path";
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  LOCK_FILE,
  ROOT_FILE,
  loadConfig,
  parseConfig,
  type CanonsConfig,
  type Runner,
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

export interface UpdateOptions {
  acceptMajor?: boolean;
  force?: boolean;
  /** Move an existing CLAUDE.md, .claude/rules or .claude/skills into the real sources instead of refusing. */
  adopt?: boolean;
  contentRoot?: string;
}

/** One client path that --adopt turns into a link: what moves where. */
interface Adoption {
  link: string;
  target: string;
  /** Entries to move from the link directory into the target directory; empty for the root file. */
  entries: string[];
  /** The link is a file whose content becomes (or already is) the root file. */
  file?: "move" | "same";
}

/**
 * Plans how --adopt replaces a real client file or directory with a link.
 * Throws when it cannot do so without losing or overwriting content.
 */
function planAdoption(root: string, link: string, target: string): Adoption {
  const linkAbs = resolve(root, link);
  const targetAbs = resolve(root, posix.join(posix.dirname(link), target));
  const stat = lstatSync(linkAbs);
  const targetRel = relative(root, targetAbs).split("\\").join("/");
  if (stat.isSymbolicLink())
    throw new Error(`${link} is a symlink to ${readlinkSync(linkAbs)}, not to ${target}. Point it at ${targetRel} and rerun.`);
  if (stat.isFile()) {
    if (!existsSync(targetAbs)) return { link, target, entries: [], file: "move" };
    if (readFileSync(linkAbs, "utf8") === readFileSync(targetAbs, "utf8"))
      return { link, target, entries: [], file: "same" };
    throw new Error(`${link} and ${targetRel} both exist with different content. Merge ${link} into ${targetRel} (outside the canons block), remove it, and rerun.`);
  }
  const entries = readdirSync(linkAbs).filter((e) => e !== ".DS_Store");
  const clashes = existsSync(targetAbs) ? entries.filter((e) => existsSync(resolve(targetAbs, e))) : [];
  if (clashes.length)
    throw new Error(`cannot move ${link} into ${targetRel}: both contain ${clashes.join(", ")}. Merge them by hand and rerun.`);
  return { link, target, entries };
}

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

export function update(root: string, options: UpdateOptions = {}): string[] {
  return apply(root, loadConfig(root), options);
}

/**
 * Writes everything for `config`. All refusals (breaking upgrade, local
 * edits, client files in the way, unwritable directories) are found before
 * the first file is written, so a refused run leaves the repository as it was.
 */
function apply(root: string, config: CanonsConfig, options: UpdateOptions): string[] {
  const log: string[] = [];
  const canon = loadCanon(config.locale, options.contentRoot ?? CONTENT_ROOT, config.runner);
  const lock = readLock(root);

  if (lock && isBreakingUpgrade(lock.canons, canon.version) && !options.acceptMajor)
    throw new Error(
      `canons ${lock.canons} -> ${canon.version} is a breaking upgrade of the rules. Review the changelog, then rerun with --accept-major.`,
    );

  // Client adapters: never clobber a real file; with --adopt, plan to move it into place.
  const links: [string, string][] = [];
  const adoptions: Adoption[] = [];
  for (const [link, target] of clientLinks(config)) {
    const stat = lstatSync(resolve(root, link), { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() && readlinkSync(resolve(root, link)) === target) continue;
    if (stat && !options.adopt)
      throw new Error(
        `${link} exists but is not a symlink to ${target}. Rerun with --adopt to move its content into place, or merge it into ${ROOT_FILE} (outside the canons block) or ${config.rulesDir} by hand and remove it.`,
      );
    if (stat) adoptions.push(planAdoption(root, link, target));
    links.push([link, target]);
  }

  // Refuse to overwrite local edits to managed content.
  const rootPath = resolve(root, ROOT_FILE);
  const adoptedRoot = adoptions.find((a) => a.file === "move");
  const rootText = existsSync(rootPath)
    ? readFileSync(rootPath, "utf8")
    : adoptedRoot
      ? readFileSync(resolve(root, adoptedRoot.link), "utf8")
      : "";
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

  // Directories and a write probe in each, undone if any of them fails.
  const dirs = [
    ".",
    ...new Set([
      ...[...canon.rules.keys()].map((f) => posix.dirname(managedRulePath(config, f))),
      config.rulesDir,
      config.skillsDir,
      ...links.map(([link]) => posix.dirname(link)),
    ]),
  ];
  const created: string[] = [];
  try {
    for (const dir of dirs) {
      const abs = resolve(root, dir);
      const first = mkdirSync(abs, { recursive: true });
      if (first) created.push(first);
      const probe = resolve(abs, `.canons-probe-${process.pid}`);
      writeFileSync(probe, "");
      rmSync(probe);
    }
  } catch (error) {
    for (const dir of created.reverse()) rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `cannot write in this repository: ${(error as Error).message}. Nothing was changed. If a sandbox protects these paths (the Codex sandbox protects .agents/), run the command outside it.`,
    );
  }

  // Adopted client files and directories move into the real sources.
  for (const a of adoptions) {
    const linkAbs = resolve(root, a.link);
    const targetAbs = resolve(root, posix.join(posix.dirname(a.link), a.target));
    if (a.file === "move") renameSync(linkAbs, targetAbs);
    else if (a.file === "same") rmSync(linkAbs);
    else {
      for (const entry of a.entries) renameSync(resolve(linkAbs, entry), resolve(targetAbs, entry));
      rmSync(resolve(linkAbs, ".DS_Store"), { force: true });
      rmdirSync(linkAbs);
    }
    const moved = a.file ? "" : ` (${a.entries.length} entr${a.entries.length === 1 ? "y" : "ies"})`;
    log.push(`adopted ${a.link} into ${relative(root, targetAbs).split("\\").join("/")}${moved}`);
  }

  // Root file and block.
  const block = renderBlock(canon);
  const nextRoot = rootText
    ? upsertBlock(rootText, block)
    : `# AGENTS.md\n\n${block}\n\n${canon.project}`;
  if (nextRoot !== rootText.replace(/\r\n/g, "\n")) {
    writeFileSync(rootPath, nextRoot);
    log.push(`${rootText ? "updated" : "created"} ${ROOT_FILE}`);
  }

  // Managed rules: write shipped files, remove ones no longer shipped.
  const files: Record<string, string> = {};
  for (const [file, text] of canon.rules) {
    const path = managedRulePath(config, file);
    const abs = resolve(root, path);
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
  if (!readdirSync(skillsAbs).length) {
    writeFileSync(resolve(skillsAbs, ".gitkeep"), "");
    log.push(`created ${config.skillsDir}/.gitkeep`);
  }

  for (const [link, target] of links) {
    symlinkSync(target, resolve(root, link));
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

export interface CreateOptions extends UpdateOptions {
  locale?: string;
  /** Defaults to `local` when the repository has a package.json, else `npx`. */
  runner?: Runner;
}

/** Writes canons.json last, so a refused create can simply be rerun. */
export function create(root: string, options: CreateOptions = {}): string[] {
  const configPath = resolve(root, CONFIG_FILE);
  if (existsSync(configPath))
    throw new Error(`${CONFIG_FILE} already exists; run "canons update"`);
  const locale = options.locale ?? DEFAULT_CONFIG.locale;
  const runner =
    options.runner ?? (existsSync(resolve(root, "package.json")) ? "local" : "npx");
  const declared = { version: 1, locale, clients: DEFAULT_CONFIG.clients, runner };
  const log = apply(root, parseConfig(declared), options);
  writeFileSync(configPath, `${JSON.stringify(declared, null, 2)}\n`);
  return [...log, `created ${CONFIG_FILE} (runner: ${runner})`];
}

/** Used by verify: lists repo-relative paths of files under a dir, recursively. */
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
