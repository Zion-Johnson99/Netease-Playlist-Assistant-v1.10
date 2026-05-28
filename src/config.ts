import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { text } from "./locale.js";

const dataDir = path.resolve(process.cwd(), ".netease-assistant");
const cookiePath = path.join(dataDir, "cookie.txt");
const appConfigPath = path.join(dataDir, "config.json");
const envPath = path.resolve(process.cwd(), ".env");
const supportedDeepseekModels = [
  "deepseek-v4-pro",
  "deepseek-v4-flash",
] as const;
const supportedLocales = ["cn", "en"] as const;

export type DeepseekModel = (typeof supportedDeepseekModels)[number];
export type AppLocale = (typeof supportedLocales)[number];

export type AppConfig = {
  dataDir: string;
  localeDataDir: string;
  cookiePath: string;
  appConfigPath: string;
  locale: AppLocale;
  deepseekApiKey: string | undefined;
  deepseekModel: string;
  deepseekBaseUrl: string;
  deepseekBatchConcurrency: number;
  deepseekBatchTimeoutMs: number;
  deepseekBatchRetries: number;
};

export function isSupportedDeepseekModel(
  model: string,
): model is DeepseekModel {
  return supportedDeepseekModels.includes(model as DeepseekModel);
}

export function formatSupportedDeepseekModels(): string {
  return supportedDeepseekModels.join(" 或 ");
}

export function isSupportedLocale(locale: string): locale is AppLocale {
  return supportedLocales.includes(locale as AppLocale);
}

export function setLocale(
  locale: AppLocale,
  targetConfigPath = appConfigPath,
): void {
  const targetDataDir = path.dirname(targetConfigPath);
  fs.mkdirSync(targetDataDir, { recursive: true });
  fs.writeFileSync(
    targetConfigPath,
    `${JSON.stringify({ locale }, null, 2)}\n`,
    "utf8",
  );
}

export function readLocale(targetConfigPath = appConfigPath): AppLocale {
  if (!fs.existsSync(targetConfigPath)) {
    return "cn";
  }

  const raw = JSON.parse(fs.readFileSync(targetConfigPath, "utf8")) as {
    locale?: unknown;
  };
  if (typeof raw.locale === "string" && isSupportedLocale(raw.locale)) {
    return raw.locale;
  }

  return "cn";
}

export function setDeepseekModel(model: string, targetEnvPath = envPath): void {
  if (!isSupportedDeepseekModel(model)) {
    const locale = readLocale();
    throw new Error(
      text(
        locale,
        `模型只支持 ${formatSupportedDeepseekModels()}`,
        `Model only supports ${formatSupportedDeepseekModels().replace(" 或 ", " or ")}`,
      ),
    );
  }

  const nextLine = `DEEPSEEK_MODEL=${model}`;
  if (!fs.existsSync(targetEnvPath)) {
    fs.writeFileSync(targetEnvPath, `${nextLine}\n`, "utf8");
    return;
  }

  const content = fs.readFileSync(targetEnvPath, "utf8");
  const lines = content.split(/\r?\n/);
  let updated = false;
  const nextLines = lines.map((line) => {
    if (/^DEEPSEEK_MODEL=/.test(line)) {
      updated = true;
      return nextLine;
    }
    return line;
  });

  if (!updated) {
    if (nextLines[nextLines.length - 1] === "") {
      nextLines[nextLines.length - 1] = nextLine;
    } else {
      nextLines.push(nextLine);
    }
  }

  fs.writeFileSync(
    targetEnvPath,
    `${nextLines.join("\n").replace(/\n+$/, "")}\n`,
    "utf8",
  );
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
}

export function loadConfig(): AppConfig {
  const locale = readLocale();
  return {
    dataDir,
    localeDataDir: path.join(dataDir, locale),
    cookiePath,
    appConfigPath,
    locale,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    deepseekBaseUrl:
      process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    deepseekBatchConcurrency: readPositiveInteger(
      "DEEPSEEK_BATCH_CONCURRENCY",
      2,
    ),
    deepseekBatchTimeoutMs: readPositiveInteger(
      "DEEPSEEK_BATCH_TIMEOUT_MS",
      60_000,
    ),
    deepseekBatchRetries: readPositiveInteger("DEEPSEEK_BATCH_RETRIES", 1),
  };
}

export function ensureDataDir(config = loadConfig()): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.localeDataDir, { recursive: true });
}

export function readCookie(config = loadConfig()): string {
  if (!fs.existsSync(config.cookiePath)) {
    throw new Error(
      text(
        config.locale,
        "未找到网易云登录状态，请先运行 login",
        "NetEase login state was not found. Run login first.",
      ),
    );
  }

  const cookie = fs.readFileSync(config.cookiePath, "utf8").trim();
  if (!cookie) {
    throw new Error(
      text(
        config.locale,
        "网易云登录状态为空，请重新运行 login",
        "NetEase login state is empty. Run login again.",
      ),
    );
  }

  return cookie;
}

export function writeCookie(cookie: string, config = loadConfig()): void {
  ensureDataDir(config);
  fs.writeFileSync(config.cookiePath, cookie, "utf8");
}
