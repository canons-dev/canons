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
  type Canon,
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

/** Claude Code's entry file: it imports AGENTS.md instead of linking to it. */
export const CLAUDE_FILE = "CLAUDE.md";
export const CLAUDE_IMPORT = `@${ROOT_FILE}\n`;

/**
 * What CLAUDE.md is now: `import` is the adapter; `legacy` is the symlink to
 * AGENTS.md that earlier versions wrote; `symlink` points elsewhere; `own` is a
 * file with its own content; `other` is a directory or special file.
 */
export type ClaudeState = "missing" | "import" | "legacy" | "symlink" | "own" | "other";

export function claudeState(root: string): ClaudeState {
  const abs = resolve(root, CLAUDE_FILE);
  const stat = lstatSync(abs, { throwIfNoEntry: false });
  if (!stat) return "missing";
  if (stat.isSymbolicLink()) return readlinkSync(abs) === ROOT_FILE ? "legacy" : "symlink";
  if (!stat.isFile()) return "other";
  return readFileSync(abs, "utf8").trim() === CLAUDE_IMPORT.trim() ? "import" : "own";
}

/** Client adapter links: link path -> relative target, both repo-relative. */
export function clientLinks(config: CanonsConfig): Map<string, string> {
  const links = new Map<string, string>();
  if (config.clients.includes("claude")) {
    links.set(".claude/rules", posix.relative(".claude", config.rulesDir));
    links.set(".claude/skills", posix.relative(".claude", config.skillsDir));
  }
  return links;
}

export function managedRulePath(config: CanonsConfig, file: string): string {
  return `${config.rulesDir}/${MANAGED_SUBDIR}/${file}`;
}

export function managedSkillPath(config: CanonsConfig, file: string): string {
  return `${config.skillsDir}/${MANAGED_SUBDIR}/${file}`;
}

/** Every managed rule and skill file of `canon`: repo-relative path -> content. */
export function managedFiles(config: CanonsConfig, canon: Canon): Map<string, string> {
  const files = new Map<string, string>();
  for (const [file, text] of canon.rules) files.set(managedRulePath(config, file), text);
  for (const [file, text] of canon.skills) files.set(managedSkillPath(config, file), text);
  return files;
}

/** Markdown files already present in the managed rule and skill directories. */
export function presentManagedFiles(root: string, config: CanonsConfig): string[] {
  const present: string[] = [];
  for (const [dir, toPath] of [
    [config.rulesDir, managedRulePath],
    [config.skillsDir, managedSkillPath],
  ] as const) {
    const abs = resolve(root, dir, MANAGED_SUBDIR);
    if (existsSync(abs)) for (const file of listMarkdown(abs)) present.push(toPath(config, file));
  }
  return present;
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
  // CLAUDE.md imports AGENTS.md. A symlink to AGENTS.md is the old adapter and is
  // replaced; any other content is moved with --adopt or refused.
  const claude = config.clients.includes("claude") ? claudeState(root) : "import";
  if (claude === "symlink" || claude === "other")
    throw new Error(
      `${CLAUDE_FILE} is ${claude === "symlink" ? `a symlink to ${readlinkSync(resolve(root, CLAUDE_FILE))}` : "not a regular file"}. Remove it and rerun; canons writes a ${CLAUDE_FILE} that imports ${ROOT_FILE}.`,
    );
  if (claude === "own") {
    if (!options.adopt)
      throw new Error(
        `${CLAUDE_FILE} exists with its own content. Rerun with --adopt to move it into ${ROOT_FILE}, or merge it into ${ROOT_FILE} (outside the canons block) by hand and remove it.`,
      );
    adoptions.push(planAdoption(root, CLAUDE_FILE, ROOT_FILE));
  }
  const writeClaude = claude !== "import";

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
  const shipped = managedFiles(config, canon);
  const known = new Set([...Object.keys(lock?.files ?? {}), ...shipped.keys()]);
  for (const path of presentManagedFiles(root, config))
    if (!known.has(path)) edited.push(`${path} (not managed by canons)`);
  if (edited.length && !options.force)
    throw new Error(
      `local edits to managed content:\n  ${edited.join("\n  ")}\nMove project-specific text outside the canons block / ${config.rulesDir}/${MANAGED_SUBDIR}/ / ${config.skillsDir}/${MANAGED_SUBDIR}/, or rerun with --force to discard the edits.`,
    );

  // Directories and a write probe in each, undone if any of them fails.
  const dirs = [
    ".",
    ...new Set([
      ...[...shipped.keys()].map((path) => posix.dirname(path)),
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

  // Managed rules and skills: write shipped files, remove ones no longer shipped.
  const files: Record<string, string> = {};
  for (const [path, text] of shipped) {
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
  for (const path of presentManagedFiles(root, config))
    if (!(path in files)) {
      rmSync(resolve(root, path));
      log.push(`removed ${path}`);
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
  if (writeClaude) {
    rmSync(resolve(root, CLAUDE_FILE), { force: true });
    writeFileSync(resolve(root, CLAUDE_FILE), CLAUDE_IMPORT);
    log.push(`wrote ${CLAUDE_FILE} (imports ${ROOT_FILE})`);
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
