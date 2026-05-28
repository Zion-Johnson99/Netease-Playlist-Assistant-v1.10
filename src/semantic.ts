import OpenAI from "openai";
import { z } from "zod";
import { AppConfig, AppLocale } from "./config.js";
import { extractJsonObject } from "./deepseek.js";
import { SemanticMatcherInput } from "./filter.js";
import { text } from "./locale.js";
import { createSemanticDecisionKey, SemanticCache } from "./semantic-cache.js";
import { MatchedSong, Song } from "./types.js";

const defaultBatchSize = 40;
const defaultConfidenceThreshold = 0.75;
const lyricSnippetLimit = 900;
const metadataTextLimit = 5000;

const SemanticDecisionSchema = z.object({
  songId: z.number(),
  matched: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

const SemanticBatchResponseSchema = z.object({
  results: z.array(SemanticDecisionSchema),
});

type SemanticDecision = z.infer<typeof SemanticDecisionSchema>;

export type SemanticMetadataProvider = {
  getSongWikiSummary: (songId: number) => Promise<unknown>;
};

export type CreateSemanticMatcherOptions = {
  batchSize?: number;
  concurrency?: number;
  batchConcurrency?: number;
  batchTimeoutMs?: number;
  batchRetries?: number;
  confidenceThreshold?: number;
};

type SongSemanticContext = {
  song: Song;
  metadataText: string;
};

type SemanticBatch = {
  index: number;
  contexts: SongSemanticContext[];
};

export function chooseSemanticReadConcurrency(songCount: number): number {
  if (songCount >= 700) {
    return 16;
  }

  if (songCount >= 300) {
    return 12;
  }

  if (songCount >= 100) {
    return 10;
  }

  return 8;
}

export function chooseSemanticBatchSize(): number {
  const raw = process.env.DEEPSEEK_BATCH_SIZE;
  if (!raw) {
    return defaultBatchSize;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return defaultBatchSize;
  }

  return value;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= items.length) {
          return;
        }

        results[index] = await mapper(items[index]!);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function trimText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return text.slice(0, limit);
}

function createProgressBar(processed: number, total: number): string {
  const width = 24;
  const safeTotal = Math.max(total, 1);
  const safeProcessed = Math.min(Math.max(processed, 0), safeTotal);
  const filled = Math.round((safeProcessed / safeTotal) * width);
  const percent = Math.round((safeProcessed / safeTotal) * 100);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${percent}%`;
}

function createProgressMessage(
  locale: AppLocale,
  phase: "lyrics" | "metadata",
  processed: number,
  total: number,
): string {
  const label = text(
    locale,
    phase === "lyrics" ? "读取歌词" : "读取元数据",
    phase === "lyrics" ? "Reading lyrics" : "Reading metadata",
  );
  return `${label}: ${createProgressBar(processed, total)} ${processed}/${total}`;
}

function collectText(value: unknown, output: string[], prefix = ""): void {
  if (output.join("\n").length >= metadataTextLimit) {
    return;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      output.push(prefix ? `${prefix}: ${trimmed}` : trimmed);
    }
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    output.push(prefix ? `${prefix}: ${String(value)}` : String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectText(item, output, prefix);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (/url|pic|image|avatar|cover/i.test(key)) {
        continue;
      }
      collectText(child, output, key);
    }
  }
}

function compactUnknownText(value: unknown): string {
  const output: string[] = [];
  collectText(value, output);
  return trimText([...new Set(output)].join("\n"), metadataTextLimit);
}

function createLyricSnippet(lyric: string | undefined): string | undefined {
  if (!lyric) {
    return undefined;
  }

  const cleaned = lyric
    .replace(/\[\d{1,2}:\d{1,2}(?:\.\d+)?]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return trimText(cleaned, lyricSnippetLimit);
}

function createPromptSong(context: SongSemanticContext): object {
  return {
    songId: context.song.id,
    name: context.song.name,
    artists: context.song.artists.map((artist) => artist.name),
    album: context.song.album,
    metadata: context.metadataText,
  };
}

function isLanguageFilter(
  filter: SemanticMatcherInput["task"]["filter"],
): boolean {
  return filter.type === "language";
}

function createBaseMetadataText(
  locale: AppLocale,
  song: Song,
  lyric: string | undefined,
): string {
  const lyricSnippet = createLyricSnippet(lyric);
  return trimText(
    [
      text(locale, `歌曲：${song.name}`, `Song: ${song.name}`),
      text(
        locale,
        `歌手：${song.artists.map((artist) => artist.name).join("/")}`,
        `Artists: ${song.artists.map((artist) => artist.name).join("/")}`,
      ),
      song.album
        ? text(locale, `专辑：${song.album}`, `Album: ${song.album}`)
        : "",
      lyricSnippet
        ? text(
            locale,
            `歌词片段：${lyricSnippet}`,
            `Lyric snippet: ${lyricSnippet}`,
          )
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    metadataTextLimit,
  );
}

async function readLyricWithCache(
  song: Song,
  input: SemanticMatcherInput,
  cache: SemanticCache,
): Promise<string | undefined> {
  const cached = cache.getLyric(song.id);
  if (cached) {
    return cached.text || undefined;
  }

  try {
    const lyric = await input.getLyric(song.id);
    cache.setLyric(song.id, lyric ?? "");
    return lyric;
  } catch (error) {
    input.onLyricError?.({ song, error });
    cache.setLyric(song.id, "");
    return undefined;
  }
}

async function readMetadata(
  song: Song,
  input: SemanticMatcherInput,
  provider: SemanticMetadataProvider,
  cache: SemanticCache,
  locale: AppLocale,
): Promise<SongSemanticContext> {
  const cached = cache.getMetadata(song.id);
  if (cached) {
    return {
      song,
      metadataText: cached.text,
    };
  }

  const lyric = await readLyricWithCache(song, input, cache);

  const wikiSummary = await Promise.allSettled([
    provider.getSongWikiSummary(song.id),
  ]);

  const lyricSnippet = createLyricSnippet(lyric);
  const sections = [
    text(locale, `歌曲：${song.name}`, `Song: ${song.name}`),
    text(
      locale,
      `歌手：${song.artists.map((artist) => artist.name).join("/")}`,
      `Artists: ${song.artists.map((artist) => artist.name).join("/")}`,
    ),
    song.album
      ? text(locale, `专辑：${song.album}`, `Album: ${song.album}`)
      : "",
    lyricSnippet
      ? text(
          locale,
          `歌词片段：${lyricSnippet}`,
          `Lyric snippet: ${lyricSnippet}`,
        )
      : "",
    wikiSummary[0]?.status === "fulfilled"
      ? text(
          locale,
          `音乐百科：${compactUnknownText(wikiSummary[0].value)}`,
          `Music encyclopedia: ${compactUnknownText(wikiSummary[0].value)}`,
        )
      : "",
  ].filter(Boolean);

  const metadataText = trimText(sections.join("\n\n"), metadataTextLimit);
  cache.setMetadata(song.id, metadataText);

  return {
    song,
    metadataText,
  };
}

async function createLanguageContexts(
  songs: Song[],
  input: SemanticMatcherInput,
  cache: SemanticCache,
  concurrency: number,
  locale: AppLocale,
): Promise<SongSemanticContext[]> {
  let processed = 0;
  input.onProgress(0, 0, {
    phase: "lyrics",
    total: songs.length,
    force: true,
    message: createProgressMessage(locale, "lyrics", 0, songs.length),
  });

  return mapWithConcurrency(songs, concurrency, async (song) => {
    const lyric = await readLyricWithCache(song, input, cache);
    const metadataText = createBaseMetadataText(locale, song, lyric);

    processed += 1;
    if (processed % 25 === 0 || processed === songs.length) {
      input.onProgress(processed, 0, {
        phase: "lyrics",
        total: songs.length,
        force: true,
        message: createProgressMessage(
          locale,
          "lyrics",
          processed,
          songs.length,
        ),
      });
    }

    return {
      song,
      metadataText,
    };
  });
}

async function createMetadataContexts(
  songs: Song[],
  input: SemanticMatcherInput,
  provider: SemanticMetadataProvider,
  cache: SemanticCache,
  concurrency: number,
  locale: AppLocale,
): Promise<SongSemanticContext[]> {
  let processed = 0;
  input.onProgress(0, 0, {
    phase: "metadata",
    total: songs.length,
    force: true,
    message: createProgressMessage(locale, "metadata", 0, songs.length),
  });

  return mapWithConcurrency(songs, concurrency, async (song) => {
    const context = await readMetadata(song, input, provider, cache, locale);

    processed += 1;
    if (processed % 25 === 0 || processed === songs.length) {
      input.onProgress(processed, 0, {
        phase: "metadata",
        total: songs.length,
        force: true,
        message: createProgressMessage(
          locale,
          "metadata",
          processed,
          songs.length,
        ),
      });
    }

    return context;
  });
}

async function classifyContexts(
  locale: AppLocale,
  client: OpenAI,
  model: string,
  input: SemanticMatcherInput,
  cache: SemanticCache,
  contexts: SongSemanticContext[],
  batchSize: number,
  batchConcurrency: number,
  batchTimeoutMs: number,
  batchRetries: number,
  confidenceThreshold: number,
): Promise<MatchedSong[]> {
  const decisions = new Map<number, SemanticDecision>();
  const missingContexts: SongSemanticContext[] = [];

  for (const context of contexts) {
    const key = createSemanticDecisionKey(
      locale,
      input.task,
      context.song,
      context.metadataText,
    );
    const cached = cache.getDecision(key);
    if (cached) {
      decisions.set(context.song.id, {
        songId: context.song.id,
        matched: cached.matched,
        confidence: cached.confidence,
        reason: cached.reason,
        tags: cached.tags,
      });
    } else {
      missingContexts.push(context);
    }
  }

  const batches: SemanticBatch[] = [];
  for (let index = 0; index < missingContexts.length; index += batchSize) {
    batches.push({
      index: batches.length,
      contexts: missingContexts.slice(index, index + batchSize),
    });
  }

  if (batches.length > 0) {
    input.onProgress(0, 0, {
      phase: "semantic",
      total: missingContexts.length,
      force: true,
      message: text(
        locale,
        `DeepSeek 判定：${createProgressBar(0, missingContexts.length)} 已完成 0/${missingContexts.length}，批次 0/${batches.length}，运行中 0，失败批次 0，并发 ${batchConcurrency}`,
        `DeepSeek judging: ${createProgressBar(0, missingContexts.length)} completed 0/${missingContexts.length}, batch 0/${batches.length}, running 0, failed batches 0, concurrency ${batchConcurrency}`,
      ),
    });
  }

  let completedSongCount = 0;
  let failedBatchCount = 0;
  let runningBatchCount = 0;
  await mapWithConcurrency(batches, batchConcurrency, async (batch) => {
    runningBatchCount += 1;
    input.onProgress(completedSongCount, 0, {
      phase: "semantic",
      total: missingContexts.length,
      force: true,
      message: text(
        locale,
        `DeepSeek 判定：${createProgressBar(completedSongCount, missingContexts.length)} 已完成 ${completedSongCount}/${missingContexts.length}，批次 ${batch.index + 1}/${batches.length}，运行中 ${runningBatchCount}，失败批次 ${failedBatchCount}`,
        `DeepSeek judging: ${createProgressBar(completedSongCount, missingContexts.length)} completed ${completedSongCount}/${missingContexts.length}, batch ${batch.index + 1}/${batches.length}, running ${runningBatchCount}, failed batches ${failedBatchCount}`,
      ),
    });

    const batchDecisions = await classifyBatchWithRetry(
      client,
      model,
      input,
      batch,
      batchTimeoutMs,
      batchRetries,
      locale,
    );

    if (!batchDecisions) {
      failedBatchCount += 1;
      completedSongCount += batch.contexts.length;
      runningBatchCount -= 1;
      input.onProgress(completedSongCount, 0, {
        phase: "semantic",
        total: missingContexts.length,
        force: true,
        message: text(
          locale,
          `DeepSeek 判定：${createProgressBar(completedSongCount, missingContexts.length)} 已完成 ${completedSongCount}/${missingContexts.length}，批次 ${batch.index + 1}/${batches.length}，运行中 ${runningBatchCount}，失败批次 ${failedBatchCount}`,
          `DeepSeek judging: ${createProgressBar(completedSongCount, missingContexts.length)} completed ${completedSongCount}/${missingContexts.length}, batch ${batch.index + 1}/${batches.length}, running ${runningBatchCount}, failed batches ${failedBatchCount}`,
        ),
      });
      return;
    }

    for (const decision of batchDecisions) {
      const context = batch.contexts.find(
        (item) => item.song.id === decision.songId,
      );
      if (!context) {
        continue;
      }

      const key = createSemanticDecisionKey(
        locale,
        input.task,
        context.song,
        context.metadataText,
      );
      decisions.set(decision.songId, decision);
      cache.setDecision(key, {
        matched: decision.matched,
        confidence: decision.confidence,
        reason: decision.reason,
        tags: decision.tags,
      });
    }
    cache.save();
    completedSongCount += batch.contexts.length;
    runningBatchCount -= 1;
    input.onProgress(completedSongCount, 0, {
      phase: "semantic",
      total: missingContexts.length,
      force: true,
      message: text(
        locale,
        `DeepSeek 判定：${createProgressBar(completedSongCount, missingContexts.length)} 已完成 ${completedSongCount}/${missingContexts.length}，批次 ${batch.index + 1}/${batches.length}，运行中 ${runningBatchCount}，失败批次 ${failedBatchCount}`,
        `DeepSeek judging: ${createProgressBar(completedSongCount, missingContexts.length)} completed ${completedSongCount}/${missingContexts.length}, batch ${batch.index + 1}/${batches.length}, running ${runningBatchCount}, failed batches ${failedBatchCount}`,
      ),
    });
  });

  const matched: MatchedSong[] = [];
  for (const [index, context] of contexts.entries()) {
    const decision = decisions.get(context.song.id);
    if (decision?.matched && decision.confidence >= confidenceThreshold) {
      matched.push({
        ...context.song,
        reason: text(
          locale,
          `语义匹配 ${decision.confidence.toFixed(2)}：${decision.reason}`,
          `Semantic match ${decision.confidence.toFixed(2)}: ${decision.reason}`,
        ),
      });
    }
    input.onProgress(index + 1, matched.length);
  }

  return matched;
}

async function classifyBatch(
  client: OpenAI,
  model: string,
  taskFilter: SemanticMatcherInput["task"]["filter"],
  contexts: SongSemanticContext[],
  timeoutMs: number,
  locale: AppLocale,
): Promise<SemanticDecision[]> {
  const completion = await withTimeout(
    client.chat.completions.create(
      {
        model,
        messages: [
          {
            role: "system",
            content: text(
              locale,
              '你是音乐筛选判定器。只输出 JSON 对象，格式为 {"results":[{"songId":数字,"matched":布尔值,"confidence":0到1,"reason":"简短中文理由","tags":["标签"]}]}。语言筛选按实际演唱语种判断，歌手地区和常唱语种只作为弱线索，单独出现时给低置信。曲风、情绪、年代、场景按歌曲百科、曲风、专辑、歌词片段综合判断。',
              'You are a music filtering classifier. Output a JSON object only, with this shape: {"results":[{"songId":number,"matched":boolean,"confidence":0 to 1,"reason":"brief English reason","tags":["tag"]}]}. For language filters, judge the actual singing language. Artist region and common singing language are weak signals only and should have low confidence by themselves. For genre, mood, era, scene, and other semantic criteria, judge using music encyclopedia data, genre, album, and lyric snippets.',
            ),
          },
          {
            role: "user",
            content: JSON.stringify({
              filter: taskFilter,
              songs: contexts.map(createPromptSong),
            }),
          },
        ],
        temperature: 0,
      },
      {
        maxRetries: 0,
        timeout: timeoutMs,
      },
    ),
    timeoutMs,
    text(
      locale,
      `DeepSeek 批次超过 ${timeoutMs / 1000}s 未返回`,
      `DeepSeek batch did not return within ${timeoutMs / 1000}s.`,
    ),
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error(
      text(
        locale,
        "模型没有返回语义筛选结果",
        "The model returned no semantic filtering result.",
      ),
    );
  }

  const parsed = extractJsonObject(content);
  return SemanticBatchResponseSchema.parse(parsed).results;
}

async function classifyBatchWithRetry(
  client: OpenAI,
  model: string,
  input: SemanticMatcherInput,
  batch: SemanticBatch,
  timeoutMs: number,
  retries: number,
  locale: AppLocale,
): Promise<SemanticDecision[] | null> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await classifyBatch(
        client,
        model,
        input.task.filter,
        batch.contexts,
        timeoutMs,
        locale,
      );
    } catch (error) {
      const canRetry = attempt < retries;
      input.onProgress(0, 0, {
        phase: "semantic",
        total: batch.contexts.length,
        force: true,
        message: canRetry
          ? text(
              locale,
              `DeepSeek 判定：第 ${batch.index + 1} 批失败，准备重试 ${attempt + 1}/${retries}，原因：${error instanceof Error ? error.message : String(error)}`,
              `DeepSeek judging: batch ${batch.index + 1} failed, retrying ${attempt + 1}/${retries}. Reason: ${error instanceof Error ? error.message : String(error)}`,
            )
          : text(
              locale,
              `DeepSeek 判定：第 ${batch.index + 1} 批失败，已跳过，原因：${error instanceof Error ? error.message : String(error)}`,
              `DeepSeek judging: batch ${batch.index + 1} failed and was skipped. Reason: ${error instanceof Error ? error.message : String(error)}`,
            ),
      });

      if (!canRetry) {
        return null;
      }
    }
  }

  return null;
}

export function createDeepseekSemanticMatcher(
  config: AppConfig,
  provider: SemanticMetadataProvider,
  options: CreateSemanticMatcherOptions = {},
): (input: SemanticMatcherInput) => Promise<MatchedSong[]> {
  return async (input) => {
    if (!config.deepseekApiKey) {
      throw new Error(
        text(
          config.locale,
          "语义筛选需要配置 DEEPSEEK_API_KEY，请在项目根目录 .env 写入该变量",
          "Semantic filtering requires DEEPSEEK_API_KEY in the project root .env file.",
        ),
      );
    }

    const batchSize = options.batchSize ?? chooseSemanticBatchSize();
    const concurrency =
      options.concurrency ?? chooseSemanticReadConcurrency(input.songs.length);
    const batchConcurrency =
      options.batchConcurrency ?? config.deepseekBatchConcurrency;
    const batchTimeoutMs =
      options.batchTimeoutMs ?? config.deepseekBatchTimeoutMs;
    const batchRetries = options.batchRetries ?? config.deepseekBatchRetries;
    const confidenceThreshold =
      options.confidenceThreshold ?? defaultConfidenceThreshold;
    const cache = new SemanticCache(config);
    const client = new OpenAI({
      apiKey: config.deepseekApiKey,
      baseURL: config.deepseekBaseUrl,
    });

    if (isLanguageFilter(input.task.filter)) {
      const contexts = await createLanguageContexts(
        input.songs,
        input,
        cache,
        concurrency,
        config.locale,
      );
      cache.save();
      return classifyContexts(
        config.locale,
        client,
        config.deepseekModel,
        input,
        cache,
        contexts,
        batchSize,
        batchConcurrency,
        batchTimeoutMs,
        batchRetries,
        confidenceThreshold,
      );
    }

    const contexts = await createMetadataContexts(
      input.songs,
      input,
      provider,
      cache,
      concurrency,
      config.locale,
    );
    cache.save();
    return classifyContexts(
      config.locale,
      client,
      config.deepseekModel,
      input,
      cache,
      contexts,
      batchSize,
      batchConcurrency,
      batchTimeoutMs,
      batchRetries,
      confidenceThreshold,
    );
  };
}
