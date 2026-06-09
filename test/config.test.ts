import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLocale, setDeepseekModel, setLocale } from "../src/config.js";

function createTempEnv(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netease-env-"));
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, content, "utf8");
  return envPath;
}

test("updates existing deepseek model without changing other env values", () => {
  const envPath = createTempEnv(
    [
      "DEEPSEEK_API_KEY=sk-test",
      "DEEPSEEK_MODEL=deepseek-v4-pro",
      "DEEPSEEK_BASE_URL=https://api.deepseek.com",
    ].join("\n"),
  );

  setDeepseekModel("deepseek-v4-flash", envPath);

  assert.equal(
    fs.readFileSync(envPath, "utf8"),
    [
      "DEEPSEEK_API_KEY=sk-test",
      "DEEPSEEK_MODEL=deepseek-v4-flash",
      "DEEPSEEK_BASE_URL=https://api.deepseek.com",
      "",
    ].join("\n"),
  );
});

test("adds deepseek model when env file has no model line", () => {
  const envPath = createTempEnv("DEEPSEEK_API_KEY=sk-test\n");

  setDeepseekModel("deepseek-v4-pro", envPath);

  assert.equal(
    fs.readFileSync(envPath, "utf8"),
    ["DEEPSEEK_API_KEY=sk-test", "DEEPSEEK_MODEL=deepseek-v4-pro", ""].join(
      "\n",
    ),
  );
});

test("rejects unsupported deepseek model names", () => {
  const envPath = createTempEnv("DEEPSEEK_MODEL=deepseek-v4-pro\n");

  assert.throws(
    () => setDeepseekModel("deepseek-chat", envPath),
    /模型只支持 deepseek-v4-pro 或 deepseek-v4-flash|Model only supports deepseek-v4-pro or deepseek-v4-flash/,
  );
  assert.equal(
    fs.readFileSync(envPath, "utf8"),
    "DEEPSEEK_MODEL=deepseek-v4-pro\n",
  );
});

test("reads cn as default locale", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netease-config-"));
  const configPath = path.join(dir, "config.json");

  assert.equal(readLocale(configPath), "cn");
});

test("writes and reads locale", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netease-config-"));
  const configPath = path.join(dir, "config.json");

  setLocale("en", configPath);

  assert.equal(readLocale(configPath), "en");
});
