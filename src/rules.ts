// Rule files: frontmatter parsing, glob matching and scope queries.
// Read-only, no network. Unsupported syntax must throw: a silently ignored
// declaration means a rule that never fires.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";

/** Parses a top-level YAML block list (`key:` followed by `  - item` lines). */
export function parseListKey(source: string, key: string): string[] {
  const fm = frontmatter(source);
  if (fm === undefined) throw new Error("rule is missing YAML frontmatter");
  const lines = fm.split("\n");
  const keyRe = new RegExp(`^${key}:(?:\\s|$)`);
  const start = lines.findIndex((line) => keyRe.test(line));
  if (start < 0) return [];
  if (lines[start]!.trim() !== `${key}:`)
    throw new Error(`${key} must be a YAML block list`);
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = line.match(
      /^\s+-\s+(?:"([^"\n]+)"|'([^'\n]+)'|([^'"\s][^\n]*?))\s*$/,
    );
    if (!item) throw new Error(`cannot parse ${key} entry: ${line}`);
    // An unquoted value containing " #" would become part of the glob and never match.
    if (/\s#/.test(item[3] ?? ""))
      throw new Error(`${key} does not support trailing comments: ${line}`);
    result.push((item[1] ?? item[2] ?? item[3])!);
  }
  if (!result.length) throw new Error(`${key} must not be empty`);
  return result;
}

export function frontmatter(source: string): string | undefined {
  return source
    .replace(/\r\n/g, "\n")
    .match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
}

/**
 * Supported syntax: `*` (within a segment), `?` (one char), `**` (any depth;
 * `**\/` also matches zero directories). Parentheses and brackets are literal,
 * because frameworks such as Next.js use them in real paths.
 */
export function globToRe(glob: string): RegExp {
  if (
    !glob ||
    glob.startsWith("/") ||
    glob.split("/").includes("..") ||
    /[{}!\\]/.test(glob)
  )
    throw new Error(
      `unsupported rule path: ${glob} (use repo-relative paths with *, ?, **)`,
    );
  let pattern = "^";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        pattern += "(?:.*/)?";
        i++;
      } else pattern += ".*";
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "?") pattern += "[^/]";
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${pattern}$`);
}

/** The directory part of a glob before its first wildcard segment. */
export function staticPrefix(glob: string): string {
  const parts = glob.split("/");
  const wildcard = parts.findIndex((part) => /[*?]/.test(part));
  return (wildcard < 0 ? parts : parts.slice(0, wildcard)).join("/");
}

export function normalizeScopePath(
  root: string,
  input: string,
  cwd = root,
): string {
  const path = relative(resolve(root), resolve(cwd, input));
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))
    throw new Error(`path is outside the repository: ${input}`);
  return path.split(sep).join("/");
}

// A path entered through a symlink (e.g. .claude/rules -> ../.agents/rules) is
// mapped to its real path: git tracks the link, not the files behind it.
function realScopePath(root: string, path: string): string {
  try {
    return normalizeScopePath(
      realpathSync(root),
      realpathSync(resolve(root, path)),
    );
  } catch {
    // A planned file that does not exist yet, or a link leaving the repo.
    return path;
  }
}

export interface ScopeRule {
  file: string;
  paths: string[];
  /** Code symbols the rule pins; `verify` requires each to appear in the source directories. */
  anchors: string[];
}

/** Lists `.md` files under `dir`, recursively, as sorted relative paths. */
export function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  const walk = (sub: string) => {
    for (const entry of readdirSync(resolve(dir, sub), {
      withFileTypes: true,
    })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".md")) out.push(rel);
    }
  };
  walk("");
  return out.sort();
}

export function loadScopeRules(root: string, rulesDir: string): ScopeRule[] {
  const files = listMarkdown(resolve(root, rulesDir));
  if (!files.length) throw new Error(`rules directory is empty: ${rulesDir}`);
  return files.map((file) => {
    const source = readFileSync(resolve(root, rulesDir, file), "utf8");
    let paths: string[];
    let anchors: string[];
    try {
      paths = parseListKey(source, "paths");
      for (const path of paths) globToRe(path);
      anchors = parseListKey(source, "anchors");
    } catch (error) {
      throw new Error(`${rulesDir}/${file}: ${(error as Error).message}`);
    }
    return { file: `${rulesDir}/${file}`, paths, anchors };
  });
}

export interface ScopeMatch {
  file: string;
  matches: { path: string; glob: string }[];
}

/** Rules without `paths` are global and always returned. */
export function matchScopeRules(
  rules: ScopeRule[],
  paths: string[],
): ScopeMatch[] {
  return rules.flatMap((rule) => {
    const matches = rule.paths.flatMap((glob) => {
      const re = globToRe(glob);
      return paths
        .filter((path) => re.test(path))
        .map((path) => ({ path, glob }));
    });
    return matches.length || !rule.paths.length
      ? [{ file: rule.file, matches }]
      : [];
  });
}

export function gitPaths(root: string, args: string[]): string[] {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\0")
    .filter(Boolean);
}

/** Tracked and untracked-but-not-ignored files. */
export function repoFiles(root: string): string[] {
  return gitPaths(root, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
}

export function changedScopePaths(root: string): string[] {
  const hasHead = (() => {
    try {
      gitPaths(root, ["rev-parse", "--verify", "-q", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  })();
  // Staged and unstaged are unioned separately so they cannot cancel out;
  // --no-renames keeps both the old and new path of a rename.
  return [
    ...new Set([
      ...gitPaths(root, ["diff", "--cached", "--name-only", "--no-renames", "-z", ...(hasHead ? ["HEAD"] : []), "--"]),
      ...gitPaths(root, ["diff", "--name-only", "--no-renames", "-z", "--"]),
      ...gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]),
  ].sort();
}

/** Files are kept as given (planned files included); directories expand to their files. */
export function expandScopePaths(
  root: string,
  inputs: string[],
  cwd = root,
): string[] {
  let files: string[] | undefined;
  return [
    ...new Set(
      inputs.flatMap((input) => {
        const path = normalizeScopePath(root, input, cwd);
        const real = realScopePath(root, path);
        if (
          !statSync(resolve(root, path), {
            throwIfNoEntry: false,
          })?.isDirectory()
        )
          return [path, real];
        files ??= repoFiles(root);
        return files.filter((file) => !real || file.startsWith(`${real}/`));
      }),
    ),
  ].sort();
}

/** "." and every directory down to the one holding `path`, root first. */
export function ancestors(path: string): string[] {
  const dirs: string[] = [];
  for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
    dirs.unshift(dir);
    if (dir === ".") break;
  }
  return dirs;
}

export interface Effective {
  file: string;
  bytes: number;
}

/**
 * Every instruction file a client loads for `paths`: the AGENTS.md files from
 * the root down to each path's directory (the chain Codex reads), then the
 * matched rules. Skills load on demand and are not listed.
 */
export function effectiveInstructions(
  root: string,
  paths: string[],
  rules: ScopeMatch[],
): Effective[] {
  const chain = new Set<string>();
  for (const path of paths)
    for (const dir of ancestors(path)) {
      const file = posix.join(dir, "AGENTS.md");
      if (existsSync(resolve(root, file))) chain.add(file);
    }
  const ordered = [...chain].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  return [...ordered, ...rules.map((rule) => rule.file)].map((file) => ({
    file,
    bytes: statSync(resolve(root, file)).size,
  }));
}
