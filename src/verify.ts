// `canons verify`: deterministic hygiene checks. Errors fail the run; warnings
// fail only with --strict. No network, no AI.
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
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
  packageName,
  sha256,
} from "./content.ts";
import {
  globToRe,
  listMarkdown,
  loadScopeRules,
  type ScopeRule,
  repoFiles,
  staticPrefix,
} from "./rules.ts";
import { checkSkill } from "./skills.ts";
import {
  CLAUDE_FILE,
  CLAUDE_IMPORT,
  clientLinks,
  isClaudeImport,
  presentManagedFiles,
  readLock,
} from "./update.ts";

export interface VerifyResult {
  errors: string[];
  warnings: string[];
}

export interface VerifyOptions {
  contentRoot?: string;
}

// `<...>` targets may hold spaces and parentheses; bare targets may hold
// balanced parentheses, as in framework route groups such as `(app)`.
const LINK_RE = /\]\(\s*(?:<([^>\n]+)>|([^()\s]+(?:\([^()\s]*\)[^()\s]*)*))\s*(?:"[^"]*")?\)/g;

const FENCE_RE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const SPAN_RE = /`[^`\n]*`/g;

/** Relative link targets in a Markdown file, as written and resolved; code spans and fences are skipped. */
export function localLinks(abs: string): { target: string; path: string }[] {
  const text = readFileSync(abs, "utf8").replace(FENCE_RE, "").replace(SPAN_RE, "");
  const base = dirname(realpathSync(abs));
  const links: { target: string; path: string }[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const target = (m[1] ?? m[2])!;
    let raw = target.split("#")[0]!.trim();
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Keep a target with a stray % as written.
    }
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    links.push({ target, path: resolve(base, raw) });
  }
  return links;
}

/** Relative link targets in a Markdown file that do not exist; code spans and fences are skipped. */
export function brokenLinks(abs: string): string[] {
  return localLinks(abs)
    .filter((link) => !existsSync(link.path))
    .map((link) => link.target);
}

/** Lines in a text file, counting a last line without a newline. */
function lineCount(text: string): number {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** Rules and SKILL.md files longer than this get a warning; long files dilute what agents follow. */
export const MAX_LINES = 500;

/** Inline code spans and fenced blocks of a Markdown text. */
function codeOf(text: string): { spans: string[]; fences: string[] } {
  const fences = [...text.matchAll(FENCE_RE)].map((m) => m[0]);
  const spans = [...text.replace(FENCE_RE, "").matchAll(SPAN_RE)].map((m) => m[0].slice(1, -1).trim());
  return { spans, fences };
}

/** Paths among `paths` (repo-relative) that git ignores; they may legitimately be absent. */
function ignoredPaths(root: string, paths: string[]): Set<string> {
  if (!paths.length) return new Set();
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], {
    cwd: root,
    input: paths.join("\0"),
    encoding: "utf8",
  });
  return new Set((result.stdout ?? "").split("\0").filter(Boolean));
}

/**
 * References in project instruction text that no longer resolve: `npm run <script>`
 * in code with no such script in the nearest package.json, and code-span paths whose first
 * segment exists but the rest does not (and git does not ignore). Paths resolve
 * from the repository root and from the file's own directory; a token whose first
 * segment exists in neither (a package name, a URL path) is not a path, and
 * `./` and `../` paths are skipped since they often point outside the repository.
 */
export function staleReferences(root: string, file: string, text: string): string[] {
  const out: string[] = [];
  const { spans, fences } = codeOf(text);
  // The nearest package.json at or above the file, within the repository.
  let manifestPath = "";
  for (let dir = posix.dirname(file); !manifestPath; dir = posix.dirname(dir)) {
    if (existsSync(resolve(root, dir, "package.json"))) manifestPath = resolve(root, dir, "package.json");
    if (dir === ".") break;
  }
  if (manifestPath) {
    let scripts: Record<string, unknown> | undefined;
    try {
      scripts = (JSON.parse(readFileSync(manifestPath, "utf8")) as { scripts?: Record<string, unknown> }).scripts;
    } catch {
      scripts = undefined;
    }
    const missing = new Set<string>();
    for (const line of [...spans, ...fences].flatMap((code) => code.split("\n"))) {
      // Another package's scripts: a workspace, a prefix or a changed directory.
      if (/(?:^|\s)(?:--prefix|-w|--workspace|-C|cd)(?:\s|=)/.test(line)) continue;
      for (const m of line.matchAll(/\bnpm\s+(?:run(?:-script)?\s+([A-Za-z0-9:_.-]+)|(test)\b)/g)) {
        const name = (m[1] ?? m[2])!;
        if (!scripts || !(name in scripts)) missing.add(m[0].replace(/\s+/g, " "));
      }
    }
    const manifest = posix.relative(root.split("\\").join("/"), manifestPath.split("\\").join("/"));
    for (const command of missing)
      out.push(`${file}: \`${command}\` has no "${command.split(" ").pop()}" script in ${manifest}`);
  }
  const fileDir = posix.dirname(file);
  const candidates: string[] = [];
  for (const span of spans) {
    const token = span.replace(/(?::\d+){1,2}$/, "").replace(/#.*$/, "");
    // Only repo paths: no globs, placeholders, URLs, absolute, home, package or `./` `../` paths.
    if (
      !token.includes("/") ||
      /[\s*?{}<>$~|\\"'`,;=]/.test(token) ||
      /^[a-z][a-z0-9+.-]*:/i.test(token) ||
      /^[/@.-]/.test(token.replace(/^\.(?=[\w-])/, ""))
    )
      continue;
    let stale: string | undefined;
    let found = false;
    for (const base of new Set([".", fileDir])) {
      if (!existsSync(resolve(root, base, token.split("/")[0]!))) continue;
      const path = posix.normalize(posix.join(base, token)).replace(/\/+$/, "");
      if (existsSync(resolve(root, path))) found = true;
      else stale ??= path;
    }
    if (!found && stale) candidates.push(stale);
  }
  const ignored = ignoredPaths(root, candidates);
  for (const path of new Set(candidates))
    if (!ignored.has(path) && !ignored.has(`${path}/`)) out.push(`${file}: \`${path}\` does not exist`);
  return out;
}

/**
 * Each anchor must appear as a whole word in a non-ignored, non-Markdown file under
 * `sourceDirs`. Comments count; the point is to catch renames and deletions.
 */
function anchorErrors(
  root: string,
  config: CanonsConfig,
  files: string[],
  rules: ScopeRule[],
): string[] {
  const pinned = rules.filter((rule) => rule.anchors.length);
  if (!pinned.length) return [];
  const prefixes = config.sourceDirs.map((dir) => `${dir.replace(/\/+$/, "")}/`);
  const sources = files.filter(
    (f) => prefixes.some((p) => f.startsWith(p)) && !f.endsWith(".md"),
  );
  const where = config.sourceDirs.join(", ");
  if (!sources.length)
    return pinned.map(
      (rule) => `${rule.file}: declares anchors, but sourceDirs (${where}) holds no files`,
    );
  const text = sources
    .map((f) => {
      const abs = resolve(root, f);
      const size = statSync(abs, { throwIfNoEntry: false })?.size ?? 0;
      return size && size <= 2 * 1024 * 1024 ? readFileSync(abs, "utf8") : "";
    })
    .join("\n");
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const errors: string[] = [];
  for (const rule of pinned)
    for (const anchor of rule.anchors)
      if (!new RegExp(`(?<![\\w$])${escape(anchor)}(?![\\w$])`).test(text))
        errors.push(
          `${rule.file}: anchor "${anchor}" no longer appears in ${where}; update the rule together with the rename or removal`,
        );
  return errors;
}

function listFiles(root: string): string[] {
  try {
    return repoFiles(root);
  } catch {
    throw new Error("canons verify must run inside a git repository");
  }
}

export function verify(root: string, options: VerifyOptions = {}): VerifyResult {
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
  if (!lock) errors.push(`canons.lock.json is missing; run "canons update"`);
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
      if (!block) errors.push(`${ROOT_FILE} has no canons block; run "canons update"`);
      else {
        if (sha256(block.body) !== block.attrs.sha256)
          errors.push(
            `${ROOT_FILE}: the canons block was edited by hand; move the change outside the block, or propose it upstream`,
          );
        if (lock && block.attrs.sha256 !== lock.block)
          errors.push(`${ROOT_FILE}: the canons block does not match canons.lock.json; run "canons update"`);
      }
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  if (lock) {
    let canonBlockHash: string | undefined;
    try {
      const canon = loadCanon(config.locale, options.contentRoot ?? CONTENT_ROOT, config.runner);
      canonBlockHash = sha256(canon.block);
      if (lock.canons !== canon.version || lock.locale !== config.locale)
        errors.push(
          `canons.lock.json is for canons ${lock.canons} (${lock.locale}) but ${canon.version} (${config.locale}) is installed; run "canons update"`,
        );
      else if (canonBlockHash !== lock.block)
        errors.push(`canons.lock.json does not match the installed canons; run "canons update"`);
    } catch (error) {
      errors.push((error as Error).message);
    }
    for (const [path, hash] of Object.entries(lock.files)) {
      const abs = resolve(root, path);
      if (!existsSync(abs)) errors.push(`${path} is missing; run "canons update"`);
      else if (sha256(readFileSync(abs, "utf8")) !== hash)
        errors.push(
          `${path} was edited by hand; put project rules and skills outside the ${MANAGED_SUBDIR}/ directories`,
        );
    }
    for (const path of presentManagedFiles(root, config))
      if (!(path in lock.files))
        errors.push(`${path} is not managed by canons; move it out of the ${MANAGED_SUBDIR}/ directory`);
  }

  // The local runner's `npx canons` only resolves when the package is installed.
  if (config.runner === "local") {
    const name = packageName();
    const manifestPath = resolve(root, "package.json");
    let manifest: Record<string, unknown> | undefined;
    try {
      manifest = existsSync(manifestPath)
        ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>)
        : undefined;
    } catch {
      manifest = undefined;
    }
    const declared = ["devDependencies", "dependencies"].some(
      (key) => typeof manifest?.[key] === "object" && name in (manifest[key] as object),
    );
    if (manifest?.name !== name && !declared)
      warnings.push(
        `runner is "local" but package.json does not list ${name}, so \`npx canons\` will not resolve; run \`npm install --save-dev ${name}\`, or set "runner": "npx" in canons.json for a repository without package.json`,
      );
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

  // 3. Client adapters: relative symlinks for directories, an import line for CLAUDE.md; never copies.
  for (const [link, target] of clientLinks(config)) {
    const abs = resolve(root, link);
    const stat = lstatSync(abs, { throwIfNoEntry: false });
    if (!stat) errors.push(`${link} is missing; run "canons update"`);
    else if (!stat.isSymbolicLink())
      errors.push(`${link} must be a symlink to ${target}, not a copy`);
    else if (readlinkSync(abs) !== target)
      errors.push(`${link} points to ${readlinkSync(abs)}; expected ${target}`);
    else if (!existsSync(abs)) errors.push(`${link} is a dangling symlink`);
  }
  if (config.clients.includes("claude")) {
    const abs = resolve(root, CLAUDE_FILE);
    const stat = lstatSync(abs, { throwIfNoEntry: false });
    const want = JSON.stringify(CLAUDE_IMPORT.trim());
    if (!stat) errors.push(`${CLAUDE_FILE} is missing; run "canons update"`);
    else if (stat.isSymbolicLink())
      errors.push(`${CLAUDE_FILE} is a symlink; run "canons update" to replace it with the import ${want}`);
    else if (!stat.isFile() || !isClaudeImport(readFileSync(abs, "utf8")))
      errors.push(
        `${CLAUDE_FILE} must hold only the import ${want}; move its content into ${ROOT_FILE} (canons update --adopt does this)`,
      );
  }

  // 4. Rule files: parseable frontmatter, valid globs, naming, links.
  const rulesAbs = resolve(root, config.rulesDir);
  if (!existsSync(rulesAbs)) errors.push(`${config.rulesDir} is missing`);
  else {
    try {
      const rules = loadScopeRules(root, config.rulesDir);
      errors.push(...anchorErrors(root, config, files, rules));
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
    for (const file of ruleFiles)
      for (const target of brokenLinks(resolve(rulesAbs, file)))
        errors.push(
          `${config.rulesDir}/${file}: broken link ${target} (links resolve from the rule's own directory)`,
        );
  }

  // 5. Links in the other instruction files and in docDirs resolve from the file's own directory.
  const under = (dir: string) => {
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    return files.filter((f) => f.startsWith(prefix) && f.endsWith(".md"));
  };
  const instructionFiles = [...new Set([...(existsSync(rootPath) ? [ROOT_FILE] : []), ...agentsFiles])];
  for (const file of [...instructionFiles, ...config.docDirs.flatMap(under)])
    for (const target of brokenLinks(resolve(root, file)))
      errors.push(`${file}: broken link ${target}`);
  // Skills may be vendored upstream text (never edited locally), so only warn.
  for (const file of under(config.skillsDir))
    for (const target of brokenLinks(resolve(root, file)))
      warnings.push(`${file}: broken link ${target}`);

  // 6. Skills follow the Agent Skills format; long files and nested references are warnings.
  const managedSkills = `${config.skillsDir}/${MANAGED_SUBDIR}/`;
  for (const file of under(config.skillsDir).filter((f) => posix.basename(f) === "SKILL.md")) {
    const abs = resolve(root, file);
    errors.push(...checkSkill(root, file));
    const lines = lineCount(readFileSync(abs, "utf8"));
    if (lines > MAX_LINES)
      warnings.push(`${file}: ${lines} lines, over ${MAX_LINES}; move detail into referenced files`);
    // Only the skill's own bundled files count: links out to repository docs are ordinary.
    const skillDir = `${dirname(realpathSync(abs))}/`;
    const own = (path: string) => path.startsWith(skillDir) && existsSync(path) && statSync(path).isFile();
    for (const ref of localLinks(abs)) {
      if (!ref.path.endsWith(".md") || !own(ref.path)) continue;
      const deeper = [
        ...new Set(
          localLinks(ref.path)
            .filter((link) => own(link.path) && link.path !== realpathSync(abs) && link.path !== ref.path)
            .map((link) => link.target),
        ),
      ];
      if (deeper.length)
        warnings.push(
          `${file}: ${ref.target} links on to ${deeper.join(", ")}; keep references one level deep from SKILL.md`,
        );
    }
  }

  // 7. Long rules dilute what agents follow.
  const projectRules = existsSync(rulesAbs)
    ? listMarkdown(rulesAbs).map((f) => `${config.rulesDir}/${f}`)
    : [];
  for (const file of projectRules) {
    const lines = lineCount(readFileSync(resolve(root, file), "utf8"));
    if (lines > MAX_LINES) warnings.push(`${file}: ${lines} lines, over ${MAX_LINES}; split it or move detail into docs`);
  }

  // 8. Project instruction text (managed content aside) still names scripts and paths that exist.
  const managedRules = `${config.rulesDir}/${MANAGED_SUBDIR}/`;
  const projectText: [string, string][] = [];
  for (const file of instructionFiles) {
    const text = readFileSync(resolve(root, file), "utf8").replace(/\r\n/g, "\n");
    projectText.push([file, text.replace(/<!-- canons:begin[\s\S]*?<!-- canons:end -->/, "")]);
  }
  for (const file of [
    ...projectRules.filter((f) => !f.startsWith(managedRules)),
    ...under(config.skillsDir).filter((f) => !f.startsWith(managedSkills)),
  ])
    projectText.push([file, readFileSync(resolve(root, file), "utf8")]);
  for (const [file, text] of projectText) warnings.push(...staleReferences(root, file, text));

  return { errors, warnings };
}
