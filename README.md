# Netease Playlist Assistant

[中文](#中文) | [English](#english)

## 中文

用自然语言整理网易云音乐歌单的本地 CLI 工具。

有没有遇到过这种情况：一个大歌单里混着粤语歌、日语歌、夜晚慢歌、健身歌，想单独拎出一类做成新歌单，结果只能一首一首翻、一首一首点。像“把这个歌单里的粤语歌提出来放进新歌单”“把适合通勤的英文歌单独整理出来”这类事，手动处理很耗时间，也很容易漏歌。

这个工具就是为这种整理场景准备的。你只要用自然语言说清楚源歌单、筛选条件和目标歌单，它会先帮你预览结果，再把命中的歌曲整理进新歌单。

这个项目基于 [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 的接口能力构建，在它提供的网易云音乐登录、歌单、歌曲、歌词、音乐百科等接口基础上，封装出一个面向个人歌单整理的命令行工作流。

## 功能特性

- 自然语言指令：直接描述“从哪个歌单筛选什么歌曲，并创建成哪个新歌单”，也支持“我喜欢的音乐”这类默认歌单。
- 二维码登录：通过网易云音乐手机 App 扫码登录，登录状态保存在本地。
- 预览优先：先用 `preview` 查看命中歌曲和理由，再用 `run` 创建新歌单。
- 歌手筛选：本地匹配歌手名与别名，适合“周杰伦的歌”“Justin Bieber 的歌”这类任务。
- 语种筛选：结合歌词片段和 DeepSeek 判断粤语、英语、日语等语种。
- 语义筛选：支持曲风、情绪、场景、年代等开放条件，例如 R&B、Hip-Hop、夜晚英文慢歌、跑步歌单。
- 缓存复用：保存语义判断和最近一次预览结果，减少重复请求。
- 接口调度：对网易云接口调用做限速、排队和重试，降低频繁操作带来的失败率。

## 工作流示例

```bash
npm link
preview
run
```

`preview` 会进入预览对话框，输入完整需求后输出命中歌曲、匹配理由和处理进度。确认结果后执行 `run`，在对话框里输入同一条需求，工具会优先复用最近一次预览结果创建新歌单。

## 环境要求

- Node.js 18+
- npm
- macOS、Linux 或 Windows 终端
- 网易云音乐账号
- DeepSeek API Key，默认使用 `deepseek-v4-flash`，也支持其他 DeepSeek API 模型

## 快速开始

```bash
git clone https://github.com/<your-name>/netease-playlist-assistant.git
cd netease-playlist-assistant
npm install
```

复制环境变量示例：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

DeepSeek API 文档：

- [DeepSeek API Docs](https://api-docs.deepseek.com/zh-cn/)
- [DeepSeek Platform Docs](https://platform.deepseek.com/docs)

可选配置：

```env
DEEPSEEK_BATCH_CONCURRENCY=2
DEEPSEEK_BATCH_TIMEOUT_MS=60000
DEEPSEEK_BATCH_RETRIES=1
```

## 登录网易云

```bash
npm run login
```

命令会在终端显示二维码。使用网易云音乐手机 App 扫码确认后，登录状态会写入 `.netease-assistant/cookie.txt`。

## 使用方式

预览匹配结果：

```bash
preview
```

启动后在对话框里输入完整需求，例如：

```text
帮我在xx这个歌单中找到所有粤语歌曲并列出来，然后添加进一个新建歌单中，叫做xx
```

确认后创建新歌单：

```bash
run
```

启动后输入同一条完整需求。

切换 DeepSeek 模型：

```bash
npm link
model -- deepseek-v4-flash
model -- deepseek-v4-pro
```

`npm link` 只需在项目根目录执行一次。随后可在 Windows 的 PowerShell 或 mac 的对应终端里使用 `preview`、`run`、`model -- deepseek-v4-flash` 或 `model -- deepseek-v4-pro`。

当前命令入口和路径处理方式适合常规终端环境。常见前提是本机已安装 Node.js 18+，并且 npm 的全局 bin 目录已经加入 `PATH`，这样 `preview`、`run`、`model` 这些命令才能直接调用。

默认模型是 `deepseek-v4-flash`。如果你已经有其他 DeepSeek API 模型可用，也可以通过 `model` 命令切换。

## 筛选机制

`artist` 走本地快速路径，只匹配歌手名和别名，适合明确歌手条件。

`language` 走 DeepSeek 语义路径，结合歌曲名、歌手、专辑、歌词片段等信息判断实际演唱语种。

`semantic` 走 DeepSeek 语义路径，适合曲风、情绪、年代、场景等开放需求。语义筛选默认每批 30 首提交给 DeepSeek，歌词片段截断到 900 字，模型置信度达到 0.75 后进入结果。

## 本地数据

- `.netease-assistant/cookie.txt`：网易云登录状态。
- `.netease-assistant/semantic-cache.json`：语义筛选缓存，包含歌曲百科摘要和模型判断结果。
- `.netease-assistant/last-preview.json`：最近一次预览结果。
- `.env`：DeepSeek API Key 和模型配置。

这些文件已写入 `.gitignore`，上传 public 仓库前请确认没有提交本地 Cookie、API Key 或个人歌单缓存。

## 开发

```bash
npm run typecheck
npm run format:check
npm test
npm run verify
```

`npm run verify` 会依次执行类型检查、格式检查和测试。

## 致谢

- [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)：提供网易云音乐 API 能力。
- DeepSeek：用于自然语言指令解析和语义筛选。

## 开源协议

MIT License

---

## English

A local CLI tool for organizing NetEase Cloud Music playlists with natural language.

Ever had a big playlist packed with Cantonese tracks, late-night songs, workout songs, and random favorites, then realized pulling one category into a clean new playlist would take far too many clicks? Tasks like “extract all Cantonese songs from this playlist” or “separate the English commute tracks into a new playlist” are simple in theory and tedious in practice.

This tool is built for that workflow. Describe the source playlist, the filter, and the target playlist in natural language, review the matched result first, then create the new playlist from the confirmed selection.

This project is built on top of [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi). It uses the API capabilities provided by that project, including login, playlists, tracks, lyrics, and song metadata, then wraps them into a personal playlist management workflow.

## Features

- Natural language commands: describe the source playlist, filtering rule, and target playlist in one sentence, including default playlists such as "Liked Songs".
- QR code login: sign in with the NetEase Cloud Music mobile app.
- Preview-first workflow: inspect matched tracks and reasons with `preview`, then create the playlist with `run`.
- Artist filtering: fast local matching for artist names and aliases.
- Language filtering: uses lyrics and DeepSeek to detect languages such as Cantonese, English, and Japanese.
- Semantic filtering: supports genres, moods, scenes, eras, and open-ended music descriptions.
- Local cache: reuses semantic decisions and the latest preview result.
- API scheduling: queues, rate-limits, and retries selected NetEase API calls.

## Example Workflow

```bash
npm link
preview
run
```

`preview` opens an interactive prompt for the full request, then prints matched tracks, reasons, and progress. After checking the result, run `run` and enter the same request; the tool will reuse the latest matching preview result when available.

## Requirements

- Node.js 18+
- npm
- macOS, Linux, or Windows terminal
- NetEase Cloud Music account
- DeepSeek API Key, defaulting to `deepseek-v4-flash` with support for other DeepSeek API models

## Quick Start

```bash
git clone https://github.com/<your-name>/netease-playlist-assistant.git
cd netease-playlist-assistant
npm install
```

Copy the environment example:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

DeepSeek API references:

- [DeepSeek API Docs](https://api-docs.deepseek.com/zh-cn/)
- [DeepSeek Platform Docs](https://platform.deepseek.com/docs)

Optional settings:

```env
DEEPSEEK_BATCH_CONCURRENCY=2
DEEPSEEK_BATCH_TIMEOUT_MS=60000
DEEPSEEK_BATCH_RETRIES=1
```

## Login

```bash
npm run login
```

The command prints a QR code in the terminal. Scan it with the NetEase Cloud Music mobile app. The login cookie is stored at `.netease-assistant/cookie.txt`.

## Usage

Preview matching results:

```bash
preview
```

Enter the full request in the prompt, for example:

```text
把歌单A里全部粤语歌添加进新建歌单粤语精选
```

Create a playlist after preview:

```bash
run
```

Switch DeepSeek models:

```bash
npm link
model -- deepseek-v4-flash
model -- deepseek-v4-pro
```

Run `npm link` once in the project root. After that, `preview`, `run`, `model -- deepseek-v4-flash`, and `model -- deepseek-v4-pro` are available in Windows PowerShell or the corresponding terminal on macOS.

The current command entrypoints and path handling fit a standard terminal setup. The main prerequisite is Node.js 18+ with npm's global bin directory available in `PATH`, so the linked commands can be launched directly.

The default model is `deepseek-v4-flash`. If you have access to another DeepSeek API model, you can switch to it with the `model` command.

## How It Works

`artist` uses a local fast path and matches artist names or aliases.

`language` uses DeepSeek with track names, artists, albums, and lyric snippets to judge the actual singing language.

`semantic` uses DeepSeek for genres, moods, eras, scenes, and other open-ended criteria. By default, semantic filtering sends tracks in batches of 30, truncates lyric snippets to 900 characters, and accepts matches with confidence of at least 0.75.

## Local Data

- `.netease-assistant/cookie.txt`: NetEase login cookie.
- `.netease-assistant/semantic-cache.json`: semantic cache for metadata and model decisions.
- `.netease-assistant/last-preview.json`: latest preview result.
- `.env`: DeepSeek API Key and model settings.

These files are ignored by Git. Before publishing the repository, check that no Cookie, API Key, or personal playlist cache has been committed.

## Development

```bash
npm run typecheck
npm run format:check
npm test
npm run verify
```

`npm run verify` runs type checking, format checking, and tests.

## Acknowledgements

- [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi): NetEase Cloud Music API capabilities.
- DeepSeek: natural language instruction parsing and semantic filtering.

## License

MIT License
