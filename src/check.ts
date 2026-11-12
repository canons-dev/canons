// `canons check`: deterministic hygiene checks. Errors fail the run; warnings
// fail only with --strict. No network, no AI.
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, posix, resolve } from "node:path";
import {
  CODEX_CHAIN_MAX_BYTES,
  ROOT_FILE,
  loadConfig,
  type CanonsConfig,
} from "./config.ts";
import {
  MANAGED_SUBDIR,
  CONTENT_ROOT,
  extractBlock,
  loadCanon,
  sha256,
} from "./content.ts";
import {
  globToRe,
  listMarkdown,
  loadScopeRules,
  repoFiles,
  staticPrefix,
} from "./rules.ts";
import { clientLinks, managedRulePath, readLock } from "./sync.ts";

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

export interface CheckOptions {
  contentRoot?: string;
}

function listFiles(root: string): string[] {
  try {
    return repoFiles(root);
  } catch {
    throw new Error("canons check must run inside a git repository");
  }
}

export function check(root: string, options: CheckOptions = {}): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let config: CanonsConfig;
  try {
    config = loadConfig(root);
  } catch (error) {
    return { errors: [(error as Error).message], warnings };
  }
  const files = listFiles(root);
  const fileSet = new Set(files);

  // 1. Root file, managed block, lock.
  const rootPath = resolve(root, ROOT_FILE);
  const lock = readLock(root);
  if (!lock) errors.push(`canons.lock.json is missing; run "canons sync"`);
  if (!existsSync(rootPath)) errors.push(`${ROOT_FILE} is missing`);
  else {
    const text = readFileSync(rootPath, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > config.budgetBytes)
      errors.push(
        `${ROOT_FILE} is ${bytes} bytes, over the ${config.budgetBytes}-byte budget; trim it or move rationale into docs (never drop red lines)`,
      );
    try {
      const block = extractBlock(text);
      if (!block) errors.push(`${ROOT_FILE} has no canons block; run "canons sync"`);
      else {
        if (sha256(block.body) !== block.attrs.sha256)
          errors.push(
            `${ROOT_FILE}: the canons block was edited by hand; move the change outside the block, or propose it upstream`,
          );
        if (lock && block.attrs.sha256 !== lock.block)
          errors.push(`${ROOT_FILE}: the canons block does not match canons.lock.json; run "canons sync"`);
      }
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  if (lock) {
    let canonBlockHash: string | undefined;
    try {
      const canon = loadCanon(config.locale, options.contentRoot ?? CONTENT_ROOT);
      canonBlockHash = sha256(canon.block);
      if (lock.canons !== canon.version || lock.locale !== config.locale)
        errors.push(
          `canons.lock.json is for canons ${lock.canons} (${lock.locale}) but ${canon.version} (${config.locale}) is installed; run "canons sync"`,
        );
      else if (canonBlockHash !== lock.block)
        errors.push(`canons.lock.json does not match the installed canons; run "canons sync"`);
    } catch (error) {
      errors.push((error as Error).message);
    }
    for (const [path, hash] of Object.entries(lock.files)) {
      const abs = resolve(root, path);
      if (!existsSync(abs)) errors.push(`${path} is missing; run "canons sync"`);
      else if (sha256(readFileSync(abs, "utf8")) !== hash)
        errors.push(
          `${path} was edited by hand; put project rules outside ${config.rulesDir}/${MANAGED_SUBDIR}/`,
        );
    }
    const managedDir = resolve(root, config.rulesDir, MANAGED_SUBDIR);
    if (existsSync(managedDir))
      for (const file of listMarkdown(managedDir)) {
        const path = managedRulePath(config, file);
        if (!(path in lock.files))
          errors.push(`${path} is not managed by canons; move it to ${config.rulesDir}/`);
      }
  }

  // 2. Codex: AGENTS.override.md shadows AGENTS.md in its directory, and the
  //    instructions along any root-to-cwd chain are cut off at 32 KiB.
  for (const file of files)
    if (posix.basename(file) === "AGENTS.override.md")
      errors.push(
        `${file}: Codex reads it instead of AGENTS.md in that directory, bypassing the canons block; remove it (personal overrides belong in ~/.codex)`,
      );
  const agentsFiles = files.filter((f) => posix.basename(f) === ROOT_FILE);
  const size = (f: string) =>
    statSync(resolve(root, f), { throwIfNoEntry: false })?.size ?? 0;
  for (const file of agentsFiles) {
    let total = 0;
    const chain: string[] = [];
    let dir = posix.dirname(file);
    const dirs: string[] = [];
    for (;;) {
      dirs.unshift(dir);
      if (dir === ".") break;
      dir = posix.dirname(dir);
    }
    for (const d of dirs) {
      const candidate = d === "." ? ROOT_FILE : `${d}/${ROOT_FILE}`;
      if (fileSet.has(candidate) || (d === "." && existsSync(rootPath))) {
        total += size(candidate);
        chain.push(candidate);
      }
    }
    if (total > CODEX_CHAIN_MAX_BYTES)
      errors.push(
        `${chain.join(" + ")} = ${total} bytes; Codex stops loading project instructions at ${CODEX_CHAIN_MAX_BYTES} bytes`,
      );
  }

  // 3. Client adapters must be relative symlinks, never copies.
  for (const [link, target] of clientLinks(config)) {
    const abs = resolve(root, link);
    const stat = lstatSync(abs, { throwIfNoEntry: false });
    if (!stat) errors.push(`${link} is missing; run "canons sync"`);
    else if (!stat.isSymbolicLink())
      errors.push(`${link} must be a symlink to ${target}, not a copy`);
    else if (readlinkSync(abs) !== target)
      errors.push(`${link} points to ${readlinkSync(abs)}; expected ${target}`);
    else if (!existsSync(abs)) errors.push(`${link} is a dangling symlink`);
  }

  // 4. Rule files: parseable frontmatter, valid globs, naming, links.
  const rulesAbs = resolve(root, config.rulesDir);
  if (!existsSync(rulesAbs)) errors.push(`${config.rulesDir} is missing`);
  else {
    try {
      const rules = loadScopeRules(root, config.rulesDir);
      const managedPrefix = `${config.rulesDir}/${MANAGED_SUBDIR}/`;
      // Managed rules are generic and may name files a project does not have.
      for (const rule of rules.filter((r) => !r.file.startsWith(managedPrefix)))
        for (const glob of rule.paths) {
          const re = globToRe(glob);
          if (!files.some((f) => re.test(f)))
            warnings.push(
              `${rule.file}: "${glob}" matches no file${/[*?]/.test(glob) ? ` under ${staticPrefix(glob) || "."}` : ""}`,
            );
        }
    } catch (error) {
      errors.push((error as Error).message);
    }
    const ruleFiles = listMarkdown(rulesAbs);
    if (config.ruleNamePattern) {
      const re = new RegExp(config.ruleNamePattern);
      for (const file of ruleFiles)
        if (!file.includes("/") && !re.test(file.replace(/\.md$/, "")))
          errors.push(
            `${config.rulesDir}/${file}: name does not match ruleNamePattern ${config.ruleNamePattern}`,
          );
    }
    for (const file of ruleFiles) {
      const abs = resolve(rulesAbs, file);
      const text = readFileSync(abs, "utf8");
      const base = dirname(realpathSync(abs));
      for (const m of text.matchAll(/\]\(<?([^)>\s]+)>?\)/g)) {
        const raw = decodeURIComponent(m[1]!.split("#")[0]!.trim());
        if (!raw || /^[a-z]+:/i.test(raw)) continue;
        if (!existsSync(resolve(base, raw)))
          errors.push(
            `${config.rulesDir}/${file}: broken link ${m[1]} (links resolve from the rule's own directory)`,
          );
      }
    }
  }

  return { errors, warnings };
}
