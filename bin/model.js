#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tsxBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

const result = spawnSync(
  tsxBin,
  [path.join(rootDir, "src", "cli.ts"), "model", ...process.argv.slice(2)],
  {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

process.exitCode = result.status ?? 1;
