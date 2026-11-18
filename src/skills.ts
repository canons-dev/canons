// Agent Skills format checks (https://agentskills.io/specification) for
// `canons verify`. Read-only and deterministic.
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { frontmatter } from "./rules.ts";

const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const COMPATIBILITY_MAX = 500;

/**
 * Top-level scalar keys of YAML frontmatter: plain, quoted, block (`|`, `>`)
 * and multi-line plain scalars. A key whose value is a nested map or list maps
 * to an empty string; that is enough for the keys the format defines.
 */
export function frontmatterScalars(fm: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = fm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(lines[i]!);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    const more: string[] = [];
    while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]!) || !lines[i + 1]!.trim())) more.push(lines[++i]!);
    const cont = more.map((line) => line.trim());
    if (/^[|>][+-]?$/.test(value)) {
      const kept = cont.join(value.startsWith("|") ? "\n" : " ").trim();
      value = value.startsWith(">") ? kept.replace(/ {2,}/g, " ") : kept;
    } else if (/^"/.test(value)) {
      const joined = [value, ...cont].join(" ").trim();
      value = joined.replace(/^"|"$/g, "").replace(/\\"/g, '"');
    } else if (/^'/.test(value)) {
      const joined = [value, ...cont].join(" ").trim();
      value = joined.replace(/^'|'$/g, "").replace(/''/g, "'");
    } else if (value) value = [value.replace(/\s+#.*$/, ""), ...cont.filter(Boolean)].join(" ");
    out.set(m[1]!, value);
  }
  return out;
}

/**
 * Checks one `SKILL.md` (repo-relative `file`) against the Agent Skills format:
 * required `name` and `description`, their limits, and `name` equal to the
 * directory name. Returns the violations.
 */
export function checkSkill(root: string, file: string): string[] {
  const errors: string[] = [];
  const text = readFileSync(resolve(root, file), "utf8");
  const fm = frontmatter(text);
  if (fm === undefined) {
    errors.push(`${file}: no YAML frontmatter; a skill needs at least name and description`);
    return errors;
  }
  const keys = frontmatterScalars(fm);
  const dir = posix.basename(posix.dirname(file));
  const name = keys.get("name");
  if (!name) errors.push(`${file}: frontmatter has no name`);
  else {
    if ([...name].length > NAME_MAX)
      errors.push(`${file}: name is longer than ${NAME_MAX} characters`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      errors.push(
        `${file}: name "${name}" must use lowercase letters, digits and single hyphens, not starting or ending with a hyphen`,
      );
    if (name !== dir) errors.push(`${file}: name "${name}" must match its directory name "${dir}"`);
  }
  const description = keys.get("description");
  if (!description) errors.push(`${file}: frontmatter has no description, so agents cannot tell when to use it`);
  else if ([...description].length > DESCRIPTION_MAX)
    errors.push(`${file}: description is longer than ${DESCRIPTION_MAX} characters`);
  const compatibility = keys.get("compatibility");
  if (compatibility && [...compatibility].length > COMPATIBILITY_MAX)
    errors.push(`${file}: compatibility is longer than ${COMPATIBILITY_MAX} characters`);
  return errors;
}
