import OpenAI from "openai";
import { z } from "zod";
import { AppConfig, AppLocale } from "./config.js";
import { text } from "./locale.js";
import { PlaylistTask, TaskSchema } from "./types.js";

const ModelResponseSchema = z.object({
  sourcePlaylistName: z.string(),
  targetPlaylistName: z.string(),
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

  const completion = await client.chat.completions.create({
    model: config.deepseekModel,
    messages: [
      {
        role: "system",
        content: text(
          locale,
          "你把中文音乐歌单操作指令解析为 JSON。只输出 JSON，不输出解释。字段：sourcePlaylistName、targetPlaylistName、filter。filter.type 可选 artist、language、semantic。明确按歌手筛选时用 artist，明确按语种筛选时用 language，曲风、情绪、年代、场景、复杂描述用 semantic。filter.value 保留用户原始筛选值。sourcePlaylistName 只能填写用户已有歌单候选中的精确名称；用户说“我两首这个歌单”时，候选里存在“两首”，就输出“两首”。targetPlaylistName 按用户要新建的名称输出。",
          "Parse English music playlist operation instructions into JSON. Output JSON only, with no explanation. Fields: sourcePlaylistName, targetPlaylistName, filter. filter.type must be one of artist, language, semantic. Use artist for explicit artist filters, language for explicit singing-language filters, and semantic for genre, mood, era, scene, or complex descriptions. Keep the original filter value in filter.value. sourcePlaylistName must be the exact name from the user's existing playlist candidates. targetPlaylistName must be the new playlist name requested by the user.",
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
