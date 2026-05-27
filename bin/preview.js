#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

const result = spawnSync(
  process.execPath,
  [
    tsxCli,
    path.join(rootDir, "src", "cli.ts"),
    "preview",
    ...process.argv.slice(2),
  ],
  {
    cwd: rootDir,
    stdio: "inherit",
  },
);

process.exitCode = result.status ?? 1;
