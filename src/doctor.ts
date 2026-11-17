// `canons doctor`: environment diagnostics with fix hints. Informational only.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";

export function doctor(root: string): string[] {
  const out: string[] = [];
  const [major = 0] = process.versions.node.split(".").map(Number);
  out.push(
    major >= 22
      ? `ok    Node ${process.versions.node}`
      : `fix   Node ${process.versions.node} is below the supported 22`,
  );
  try {
    const symlinks = execFileSync("git", ["config", "--get", "core.symlinks"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (symlinks === "false")
      out.push(
        "fix   git core.symlinks=false: client adapters would be checked out as plain files. Run `git config core.symlinks true` (on Windows enable Developer Mode first) and re-checkout.",
      );
  } catch {
    // Unset means the platform default (true outside Windows).
  }
  const real = ["CLAUDE.md", ".claude/rules", ".claude/skills"].filter((p) => {
    const stat = lstatSync(resolve(root, p), { throwIfNoEntry: false });
    return stat && !stat.isSymbolicLink();
  });
  if (real.length)
    out.push(
      `fix   ${real.join(", ")} ${real.length === 1 ? "is a real file or directory" : "are real files or directories"}, so other clients cannot read ${real.length === 1 ? "it" : "them"}. Run \`canons create --adopt\` (or \`canons update --adopt\`) to move ${real.length === 1 ? "it" : "them"} into AGENTS.md / .agents/ and link ${real.length === 1 ? "it" : "them"}.`,
    );
  let clients: string[] = [];
  try {
    clients = loadConfig(root).clients;
  } catch (error) {
    out.push(`fix   ${(error as Error).message}`);
  }
  if (clients.includes("codex"))
    out.push(
      "note  Codex reads AGENTS.md from the repository root down to the working directory; no adapter needed.",
      "note  Interactive Codex asks you to trust this folder before it starts; trusting also lets project-level Codex settings run code.",
      "note  Codex reads .agents/skills natively; no adapter needed.",
    );
  if (clients.includes("claude"))
    out.push(
      "note  Claude Code loads .claude/rules recursively and honors only the `paths` frontmatter key; queries via `canons scopes` still apply.",
    );
  out.push(
    "note  Cursor and GitHub Copilot read AGENTS.md natively. For Gemini CLI set context.fileName to [\"AGENTS.md\"] in .gemini/settings.json.",
  );
  if (existsSync(resolve(root, ".codex/hooks.json")))
    out.push(
      "note  .codex/hooks.json found: Codex runs repo hooks only after you review and trust them (/hooks).",
    );
  return out;
}
