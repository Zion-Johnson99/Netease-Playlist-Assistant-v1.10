# Netease Playlist Assistant

[中文](#中文) | [English](#english)

## 中文

用自然语言整理网易云音乐歌单的本地 CLI 工具。

这个项目基于 [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 的接口能力构建，在它提供的网易云音乐登录、歌单、歌曲、歌词、音乐百科等接口基础上，封装出一个面向个人歌单整理的命令行工作流。

## 功能特性

- 自然语言指令：直接描述“从哪个歌单筛选什么歌曲，并创建成哪个新歌单”。
- 二维码登录：通过网易云音乐手机 App 扫码登录，登录状态保存在本地。
- 预览优先：先用 `preview` 查看命中歌曲和理由，再用 `run` 创建新歌单。
- 歌手筛选：本地匹配歌手名与别名，适合“周杰伦的歌”“Justin Bieber 的歌”这类任务。
- 语种筛选：结合歌词片段和 DeepSeek 判断粤语、英语、日语等语种。
- 语义筛选：支持曲风、情绪、场景、年代等开放条件，例如 R&B、Hip-Hop、夜晚英文慢歌、跑步歌单。
- 缓存复用：保存语义判断和最近一次预览结果，减少重复请求。
- 接口调度：对网易云接口调用做限速、排队和重试，降低频繁操作带来的失败率。

## 工作流示例

```powershell
npm run preview -- "把歌单A里全部粤语歌添加进新建歌单粤语精选"
npm run run -- "把歌单A里全部粤语歌添加进新建歌单粤语精选"
```

`preview` 会输出命中歌曲、匹配理由和处理进度。确认结果后执行同一条 `run` 指令，工具会优先复用最近一次预览结果创建新歌单。

## 环境要求

- Node.js 18+
- npm
- 网易云音乐账号
- DeepSeek API Key

## 快速开始

```powershell
git clone https://github.com/<your-name>/netease-playlist-assistant.git
cd netease-playlist-assistant
npm install
```

复制环境变量示例：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```env
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

可选配置：

```env
DEEPSEEK_BATCH_CONCURRENCY=2
DEEPSEEK_BATCH_TIMEOUT_MS=60000
DEEPSEEK_BATCH_RETRIES=1
```

## 登录网易云

```powershell
npm run login
```

命令会在终端显示二维码。使用网易云音乐手机 App 扫码确认后，登录状态会写入 `.netease-assistant/cookie.txt`。

## 使用方式

预览匹配结果：

```powershell
npm run preview -- "把歌单A里贾斯汀比伯的歌添加进新建歌单JB"
npm run preview -- "把歌单A里全部粤语歌添加进新建歌单粤语精选"
npm run preview -- "把歌单A里所有 R&B 歌曲添加进新建歌单R&B"
npm run preview -- "把歌单A里适合夜晚听的英文慢歌添加进新建歌单夜晚英文"
```

确认后创建新歌单：

```powershell
npm run run -- "把歌单A里贾斯汀比伯的歌添加进新建歌单JB"
npm run run -- "把歌单A里全部粤语歌添加进新建歌单粤语精选"
npm run run -- "把歌单A里所有嘻哈歌曲添加进新建歌单Hip-Hop"
```

切换 DeepSeek 模型：

```powershell
npm link
model -- deepseek-v4-flash
model -- deepseek-v4-pro
```

`npm link` 只需在项目根目录执行一次。随后可在任意 PowerShell 窗口使用 `model -- deepseek-v4-flash` 或 `model -- deepseek-v4-pro` 更新 `.env` 里的 `DEEPSEEK_MODEL`。

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

```powershell
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

This project is built on top of [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi). It uses the API capabilities provided by that project, including login, playlists, tracks, lyrics, and song metadata, then wraps them into a personal playlist management workflow.

## Features

- Natural language commands: describe the source playlist, filtering rule, and target playlist in one sentence.
- QR code login: sign in with the NetEase Cloud Music mobile app.
- Preview-first workflow: inspect matched tracks and reasons with `preview`, then create the playlist with `run`.
- Artist filtering: fast local matching for artist names and aliases.
- Language filtering: uses lyrics and DeepSeek to detect languages such as Cantonese, English, and Japanese.
- Semantic filtering: supports genres, moods, scenes, eras, and open-ended music descriptions.
- Local cache: reuses semantic decisions and the latest preview result.
- API scheduling: queues, rate-limits, and retries selected NetEase API calls.

## Example Workflow

```powershell
npm run preview -- "把歌单A里全部粤语歌添加进新建歌单粤语精选"
npm run run -- "把歌单A里全部粤语歌添加进新建歌单粤语精选"
```

`preview` prints matched tracks, reasons, and progress. After checking the result, run the same instruction with `run`; the tool will reuse the latest matching preview result when available.

## Requirements

- Node.js 18+
- npm
- NetEase Cloud Music account
- DeepSeek API Key

## Quick Start

```powershell
git clone https://github.com/<your-name>/netease-playlist-assistant.git
cd netease-playlist-assistant
npm install
```

Copy the environment example:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```env
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Optional settings:

```env
DEEPSEEK_BATCH_CONCURRENCY=2
DEEPSEEK_BATCH_TIMEOUT_MS=60000
DEEPSEEK_BATCH_RETRIES=1
```

## Login

```powershell
npm run login
```

The command prints a QR code in the terminal. Scan it with the NetEase Cloud Music mobile app. The login cookie is stored at `.netease-assistant/cookie.txt`.

## Usage

Preview matching results:

```powershell
npm run preview -- "把歌单A里贾斯汀比伯的歌添加进新建歌单JB"
npm run preview -- "把歌单A里全部粤语歌添加进新建歌单粤语精选"
npm run preview -- "把歌单A里所有 R&B 歌曲添加进新建歌单R&B"
npm run preview -- "把歌单A里适合夜晚听的英文慢歌添加进新建歌单夜晚英文"
```

Create a playlist after preview:

```powershell
npm run run -- "把歌单A里贾斯汀比伯的歌添加进新建歌单JB"
npm run run -- "把歌单A里全部粤语歌添加进新建歌单粤语精选"
npm run run -- "把歌单A里所有嘻哈歌曲添加进新建歌单Hip-Hop"
```

Switch DeepSeek models:

```powershell
npm link
model -- deepseek-v4-flash
model -- deepseek-v4-pro
```

Run `npm link` once in the project root. After that, `model -- deepseek-v4-flash` and `model -- deepseek-v4-pro` update `DEEPSEEK_MODEL` in `.env`.

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

```powershell
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
