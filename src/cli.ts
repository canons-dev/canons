#!/usr/bin/env node
// canons CLI entry. Exit code 0 = ok, 1 = errors (or warnings with --strict).
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "./verify.ts";
import { RULES_DIR, RUNNERS, findRoot, loadConfig, type Runner } from "./config.ts";
import { isBreakingUpgrade, packageName, packageVersion, readJson, runnerCommand } from "./content.ts";
import { doctor } from "./doctor.ts";
import {
  changedScopePaths,
  effectiveInstructions,
  expandScopePaths,
  loadScopeRules,
  matchScopeRules,
} from "./rules.ts";
import {
  cacheDir,
  changelogUrl,
  decline,
  fetchLatest,
  isNewer,
  readCache,
  refreshCache,
  updateNotice,
  writeCache,
} from "./notice.ts";
import { create, readLock, update } from "./update.ts";

const HELP = `canons ${packageVersion()}

Usage:
  canons create [--locale <code>] [--runner local|npx] [--adopt]
                                     write canons.json and run update
  canons update [--accept-major] [--force] [--adopt]
                                     write the AGENTS.md block, managed rules, client links, lock
                                     from the installed version (it does not upgrade the package)
                                     --adopt moves an existing CLAUDE.md, .claude/rules or
                                     .claude/skills into AGENTS.md / .agents/ and links it
  canons verify [--strict]           deterministic hygiene checks (for CI and pre-commit)
  canons scopes [--changed] [--effective] [--json] <file-or-dir>...
                                     list the rules that apply to the given paths;
                                     --effective also lists every AGENTS.md and rule
                                     loaded for them, with byte counts
  canons latest [--json] [--decline <version>]
                                     compare with the newest published version (network);
                                     --decline stops the notice for that version
  canons doctor                      environment diagnostics with fix hints
  canons --version | --help

A rule with no match does not mean "no constraints": the root AGENTS.md still applies.
scopes and doctor mention a newer canons version from a local cache, refreshed daily
in the background; set CANONS_NO_UPDATE_CHECK=1 or "notify": false to turn it off.`;

/** The update notice for `root`, or undefined. Never throws, never waits for the network. */
function noticeFor(root: string): string | undefined {
  try {
    const config = loadConfig(root);
    if (!config.notify) return undefined;
    // Not inside canons' own repository.
    if ((readJson(resolve(root, "package.json")) as { name?: string } | undefined)?.name === packageName())
      return undefined;
    return updateNotice({
      installed: readLock(root)?.canons ?? packageVersion(),
      command: runnerCommand(config.runner),
    });
  } catch {
    return undefined;
  }
}

/** Command names before every command had six letters; kept only to point at the new name. */
const RENAMED: Record<string, string> = { init: "create", sync: "update", check: "verify" };

function takeOption(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  args.splice(at, 2);
  return value;
}

function assertFlags(args: string[], allowed: string[]): void {
  const unknown = args.filter((a) => a.startsWith("--") && !allowed.includes(a));
  if (unknown.length)
    throw new Error(`unknown option ${unknown.join(", ")}; see canons --help`);
}

export function main(argv: string[], cwd = process.cwd()): number | Promise<number> {
  const args = [...argv];
  const command = args.shift();
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(packageVersion());
    return 0;
  }
  if (command === "__refresh") {
    // Detached child started by the update notice; see notice.ts.
    return refreshCache(cacheDir()).then(() => 0);
  }
  const root = findRoot(cwd);
  switch (command) {
    case "create": {
      const locale = takeOption(args, "--locale");
      const runner = takeOption(args, "--runner");
      assertFlags(args, ["--adopt"]);
      if (runner !== undefined && !(RUNNERS as readonly string[]).includes(runner))
        throw new Error(`--runner must be one of: ${RUNNERS.join(", ")}`);
      for (const line of create(root, {
        locale,
        runner: runner as Runner | undefined,
        adopt: args.includes("--adopt"),
      }))
        console.log(line);
      console.log('done. Next: write project rules outside the canons block, then run "canons verify".');
      return 0;
    }
    case "update": {
      assertFlags(args, ["--accept-major", "--force", "--adopt"]);
      const log = update(root, {
        acceptMajor: args.includes("--accept-major"),
        force: args.includes("--force"),
        adopt: args.includes("--adopt"),
      });
      for (const line of log) console.log(line);
      if (!log.length) console.log("already up to date");
      return 0;
    }
    case "verify": {
      assertFlags(args, ["--strict"]);
      const { errors, warnings } = verify(root);
      for (const e of errors) console.log(`error  ${e}`);
      for (const w of warnings) console.log(`warn   ${w}`);
      const failed = errors.length > 0 || (args.includes("--strict") && warnings.length > 0);
      console.log(
        failed
          ? `canons verify failed: ${errors.length} error(s), ${warnings.length} warning(s)`
          : `canons verify passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}`,
      );
      return failed ? 1 : 0;
    }
    case "scopes": {
      assertFlags(args, ["--changed", "--effective", "--json"]);
      const changed = args.includes("--changed");
      const inputs = args.filter((a) => !a.startsWith("--"));
      if (!inputs.length && !changed)
        throw new Error("pass files/directories, or --changed");
      loadConfig(root); // scopes needs a canons repository
      const paths = [
        ...new Set([
          ...expandScopePaths(root, inputs, cwd),
          ...(changed ? changedScopePaths(root) : []),
        ]),
      ].sort();
      const rules = matchScopeRules(loadScopeRules(root, RULES_DIR), paths);
      const notice = noticeFor(root);
      if (notice) console.error(notice);
      const effective = args.includes("--effective")
        ? effectiveInstructions(root, paths, rules)
        : undefined;
      const total = effective?.reduce((sum, e) => sum + e.bytes, 0);
      if (args.includes("--json")) {
        console.log(JSON.stringify(effective ? { paths, rules, effective, bytes: total } : { paths, rules }, null, 2));
        return 0;
      }
      console.log(
        `${paths.length} path(s), ${rules.length} rule(s). Read every listed rule before editing.`,
      );
      for (const rule of rules) {
        console.log(`\n${rule.file}`);
        if (!rule.matches.length) console.log("  global rule (no paths)");
        for (const { path, glob } of rule.matches)
          console.log(`  ${path} <- ${glob}`);
      }
      if (effective) {
        console.log(`\nEffective instructions: ${effective.length} file(s), ${total} bytes`);
        for (const { file, bytes } of effective) console.log(`  ${String(bytes).padStart(7)}  ${file}`);
      }
      return 0;
    }
    case "doctor": {
      assertFlags(args, []);
      for (const line of doctor(root)) console.log(line);
      const notice = noticeFor(root);
      if (notice) console.log(`note  ${notice}`);
      return 0;
    }
    case "latest": {
      const declined = takeOption(args, "--decline");
      assertFlags(args, ["--json"]);
      if (declined !== undefined) {
        decline(declined);
        console.log(`canons ${declined} will not be mentioned again; run "canons latest" to check by hand.`);
        return 0;
      }
      const installed = readLock(root)?.canons ?? packageVersion();
      return fetchLatest().then((latest) => {
        const dir = cacheDir();
        writeCache(dir, { ...readCache(dir), latest, checkedAt: Date.now() });
        const newer = isNewer(latest, installed);
        const breaking = newer && isBreakingUpgrade(installed, latest);
        const changelog = changelogUrl();
        if (args.includes("--json"))
          console.log(JSON.stringify({ installed, latest, newer, breaking, changelog }, null, 2));
        else if (!newer) console.log(`canons ${installed} is the latest version.`);
        else {
          console.log(`canons ${latest} is available; this repository uses ${installed}.`);
          console.log(breaking ? "breaking upgrade: rule content changed; review the changelog and update with --accept-major" : "non-breaking upgrade");
          if (changelog) console.log(`changelog: ${changelog}`);
          console.log("To upgrade, follow the canons skill (.agents/skills/canons/SKILL.md) once the user agrees.");
        }
        return newer ? 10 : 0;
      });
    }
    default:
      if (command in RENAMED)
        throw new Error(`"${command}" is now "${RENAMED[command]}"; see canons --help`);
      throw new Error(`unknown command "${command}"; see canons --help`);
  }
}

const invokedDirectly =
  !!process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const fail = (error: unknown) => {
    console.error(`canons: ${(error as Error).message}`);
    process.exitCode = 1;
  };
  try {
    Promise.resolve(main(process.argv.slice(2))).then((code) => {
      process.exitCode = code;
    }, fail);
  } catch (error) {
    fail(error);
  }
}
