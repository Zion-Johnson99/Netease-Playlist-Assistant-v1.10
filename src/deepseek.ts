import OpenAI from "openai";
import { z } from "zod";
import { AppConfig, AppLocale } from "./config.js";
import { text } from "./locale.js";
import { PlaylistTask, TaskSchema } from "./types.js";

const parseInstructionTimeoutMs = 30_000;

const ModelResponseSchema = TaskSchema;

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
              "你把中文音乐歌单操作指令解析为 JSON。只输出 JSON，不输出解释。字段必须包含 type、sourcePlaylistName、targetPlaylistName。type 可选 create_playlist_from_filter 或 playlist_diff。用户表达“某歌单中有、另一个歌单中没有、缺失、补全、添加到已有歌单、列出差异”时输出 playlist_diff，只输出 type、sourcePlaylistName、targetPlaylistName。用户表达“筛出、找到某类歌曲、创建、新建、整理到新歌单”时输出 create_playlist_from_filter，并输出 filter，必要时输出 limit。filter.type 可选 artist、language、semantic。明确按歌手筛选时用 artist，明确按语种筛选时用 language，曲风、情绪、年代、场景、复杂描述用 semantic。filter.value 保留用户原始筛选值。用户明确要求歌曲数量时，把正整数写入 limit；未要求数量时省略 limit。sourcePlaylistName 和 targetPlaylistName 优先填写用户已有歌单候选中的精确名称；用户说“我两首这个歌单”时，候选里存在“两首”，就输出“两首”。create_playlist_from_filter 的 targetPlaylistName 按用户要新建的名称输出；playlist_diff 的 targetPlaylistName 按用户要补全的已有歌单名称输出。",
              "Parse English music playlist operation instructions into JSON. Output JSON only, with no explanation. Required fields: type, sourcePlaylistName, targetPlaylistName. type must be create_playlist_from_filter or playlist_diff. Use playlist_diff when the user asks for songs that exist in one playlist but not another, missing tracks, completion, adding missing tracks to an existing playlist, or listing differences. For playlist_diff, output only type, sourcePlaylistName, and targetPlaylistName. Use create_playlist_from_filter when the user asks to filter tracks, find a category of tracks, create a new playlist, or organize tracks into a new playlist. Then output filter and optional limit. filter.type must be artist, language, or semantic. Use artist for explicit artist filters, language for explicit singing-language filters, and semantic for genre, mood, era, scene, or complex descriptions. Keep the original filter value in filter.value. When the user explicitly requests a track count, write the positive integer to limit; omit limit when no count is requested. sourcePlaylistName and targetPlaylistName should prefer exact names from existing playlist candidates. For create_playlist_from_filter, targetPlaylistName is the new playlist name requested by the user. For playlist_diff, targetPlaylistName is the existing playlist to complete.",
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
