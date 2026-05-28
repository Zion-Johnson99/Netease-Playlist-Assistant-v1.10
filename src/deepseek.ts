import OpenAI from "openai";
import { z } from "zod";
import { AppConfig, AppLocale } from "./config.js";
import { text } from "./locale.js";
import { PlaylistTask, TaskSchema } from "./types.js";

const parseInstructionTimeoutMs = 30_000;

const ModelResponseSchema = z.object({
  sourcePlaylistName: z.string(),
  targetPlaylistName: z.string(),
  limit: z.number().int().positive().optional(),
  filter: z.object({
    type: z.enum(["language", "artist", "semantic"]),
    value: z.string(),
  }),
});

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) {
    return JSON.parse(match[1].trim());
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new Error("模型返回内容里没有 JSON 对象");
}

type DeepseekErrorLike = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
};

function isDeepseekErrorLike(value: unknown): value is DeepseekErrorLike {
  return typeof value === "object" && value !== null;
}

function getDeepseekErrorStatus(error: DeepseekErrorLike): number | undefined {
  return typeof error.status === "number" ? error.status : undefined;
}

function getDeepseekErrorName(error: DeepseekErrorLike): string {
  return typeof error.name === "string" ? error.name : "";
}

function getDeepseekErrorMessage(error: DeepseekErrorLike): string {
  return typeof error.message === "string" ? error.message : "";
}

export function describeDeepseekError(
  error: unknown,
  locale: AppLocale,
  action: string,
  timeoutMs: number,
): string {
  if (isDeepseekErrorLike(error)) {
    const name = getDeepseekErrorName(error);
    const status = getDeepseekErrorStatus(error);
    const message = getDeepseekErrorMessage(error);

    if (name === "APIConnectionTimeoutError") {
      return text(
        locale,
        `DeepSeek ${action}请求超时，已等待 ${timeoutMs / 1000} 秒。请稍后重试。`,
        `DeepSeek timed out while ${action} after waiting ${timeoutMs / 1000} seconds. Please try again later.`,
      );
    }

    if (status === 503) {
      return text(
        locale,
        "DeepSeek 服务繁忙（503），请求没有完成。请稍后重试。",
        "DeepSeek is busy (503) and the request did not complete. Please try again later.",
      );
    }

    if (message) {
      return text(
        locale,
        `DeepSeek ${action}失败：${message}`,
        `DeepSeek failed while ${action}: ${message}`,
      );
    }
  }

  return text(
    locale,
    `DeepSeek ${action}失败，请稍后重试。`,
    `DeepSeek failed while ${action}. Please try again later.`,
  );
}

export async function parseInstruction(
  instruction: string,
  config: AppConfig,
  sourcePlaylistCandidates: string[] = [],
  locale: AppLocale = config.locale,
): Promise<PlaylistTask> {
  if (!config.deepseekApiKey) {
    throw new Error(
      text(
        locale,
        "未配置 DEEPSEEK_API_KEY，请在项目根目录创建 .env 并写入该变量",
        "DEEPSEEK_API_KEY is not configured. Create .env in the project root and set it.",
      ),
    );
  }

  const client = new OpenAI({
    apiKey: config.deepseekApiKey,
    baseURL: config.deepseekBaseUrl,
  });

  const completion = await client.chat.completions
    .create(
      {
        model: config.deepseekModel,
        messages: [
          {
            role: "system",
            content: text(
              locale,
              "你把中文音乐歌单操作指令解析为 JSON。只输出 JSON，不输出解释。字段：sourcePlaylistName、targetPlaylistName、filter、limit。filter.type 可选 artist、language、semantic。明确按歌手筛选时用 artist，明确按语种筛选时用 language，曲风、情绪、年代、场景、复杂描述用 semantic。filter.value 保留用户原始筛选值。用户明确要求歌曲数量时，把正整数写入 limit；未要求数量时省略 limit。sourcePlaylistName 只能填写用户已有歌单候选中的精确名称；用户说“我两首这个歌单”时，候选里存在“两首”，就输出“两首”。targetPlaylistName 按用户要新建的名称输出。",
              "Parse English music playlist operation instructions into JSON. Output JSON only, with no explanation. Fields: sourcePlaylistName, targetPlaylistName, filter, limit. filter.type must be one of artist, language, semantic. Use artist for explicit artist filters, language for explicit singing-language filters, and semantic for genre, mood, era, scene, or complex descriptions. Keep the original filter value in filter.value. When the user explicitly requests a track count, write the positive integer to limit; omit limit when no count is requested. sourcePlaylistName must be the exact name from the user's existing playlist candidates. targetPlaylistName must be the new playlist name requested by the user.",
            ),
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction,
              sourcePlaylistCandidates,
            }),
          },
        ],
        temperature: 0,
      },
      {
        maxRetries: 0,
        timeout: parseInstructionTimeoutMs,
      },
    )
    .catch((error: unknown) => {
      throw new Error(
        describeDeepseekError(
          error,
          locale,
          text(locale, "解析需求", "parsing the request"),
          parseInstructionTimeoutMs,
        ),
        { cause: error },
      );
    });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error(
      text(
        locale,
        "模型没有返回解析结果",
        "The model returned no parse result.",
      ),
    );
  }

  const raw = extractJsonObject(content);
  const normalized = ModelResponseSchema.parse(raw);
  return TaskSchema.parse(normalized);
}
