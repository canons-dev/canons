// Builds the publishable package into out/: compiled JavaScript plus a copy of
// canon/, which the modules read from their own directory at run time.
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "out");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

rmSync(out, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", resolve(root, "tsconfig.build.json")], {
  stdio: "inherit",
});
cpSync(resolve(root, "src/canon"), resolve(out, "canon"), { recursive: true });
