#!/usr/bin/env node
// canons CLI entry. Exit code 0 = ok, 1 = errors (or warnings with --strict).
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./check.ts";
import { findRoot, loadConfig } from "./config.ts";
import { packageVersion } from "./content.ts";
import { doctor } from "./doctor.ts";
import {
  changedScopePaths,
  expandScopePaths,
  loadScopeRules,
  matchScopeRules,
} from "./rules.ts";
import { init, sync } from "./sync.ts";

const HELP = `canons ${packageVersion()}

Usage:
  canons init [--locale <code>]      create canons.json and run sync
  canons sync [--accept-major] [--force]
                                     write the AGENTS.md block, managed rules, client links, lock
  canons check [--strict]            deterministic hygiene checks (for CI and pre-commit)
  canons scopes [--changed] [--json] <file-or-dir>...
                                     list the rules that apply to the given paths
  canons doctor                      environment diagnostics with fix hints
  canons --version | --help

A rule with no match does not mean "no constraints": the root AGENTS.md still applies.`;

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

export function main(argv: string[], cwd = process.cwd()): number {
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
  const root = findRoot(cwd);
  switch (command) {
    case "init": {
      const locale = takeOption(args, "--locale");
      assertFlags(args, []);
      for (const line of init(root, locale)) console.log(line);
      console.log('done. Next: write project rules outside the canons block, then run "canons check".');
      return 0;
    }
    case "sync": {
      assertFlags(args, ["--accept-major", "--force"]);
      const log = sync(root, {
        acceptMajor: args.includes("--accept-major"),
        force: args.includes("--force"),
      });
      for (const line of log) console.log(line);
      if (!log.length) console.log("already up to date");
      return 0;
    }
    case "check": {
      assertFlags(args, ["--strict"]);
      const { errors, warnings } = check(root);
      for (const e of errors) console.log(`error  ${e}`);
      for (const w of warnings) console.log(`warn   ${w}`);
      const failed = errors.length > 0 || (args.includes("--strict") && warnings.length > 0);
      console.log(
        failed
          ? `canons check failed: ${errors.length} error(s), ${warnings.length} warning(s)`
          : `canons check passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}`,
      );
      return failed ? 1 : 0;
    }
    case "scopes": {
      assertFlags(args, ["--changed", "--json"]);
      const changed = args.includes("--changed");
      const inputs = args.filter((a) => !a.startsWith("--"));
      if (!inputs.length && !changed)
        throw new Error("pass files/directories, or --changed");
      const config = loadConfig(root);
      const paths = [
        ...new Set([
          ...expandScopePaths(root, inputs, cwd),
          ...(changed ? changedScopePaths(root) : []),
        ]),
      ].sort();
      const rules = matchScopeRules(loadScopeRules(root, config.rulesDir), paths);
      if (args.includes("--json")) {
        console.log(JSON.stringify({ paths, rules }, null, 2));
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
      return 0;
    }
    case "doctor":
      assertFlags(args, []);
      for (const line of doctor(root)) console.log(line);
      return 0;
    default:
      throw new Error(`unknown command "${command}"; see canons --help`);
  }
}

const invokedDirectly =
  !!process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`canons: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
