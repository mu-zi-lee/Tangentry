<div align="center">

<img src="src/web/public/favicon.svg" width="88" alt="Tangentry logo" />

# Tangentry

**沿着好奇心继续发现 —— 本地优先的多平台内容聚合、阅读与笔记工具**

把 B站、YouTube、小红书、抖音、小宇宙播客、RSS 与网页文章收进同一个阅读器里：
看视频时读字幕、截帧做笔记、一键转录与翻译，所有数据都留在你自己的电脑上。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Docker-lightgrey)
![Version](https://img.shields.io/badge/version-0.0.3.4-orange)

[功能](#-功能) · [快速开始](#-快速开始) · [使用指南](#-使用指南) · [配置](#%EF%B8%8F-配置) · [开发](#-开发) · [架构](docs/ARCHITECTURE.md) · [贡献](CONTRIBUTING.md)

</div>

---

> [!NOTE]
> Tangentry 是个人项目，目前处于 **0.x 早期阶段**，接口和数据结构仍可能变化（数据库会自动迁移）。欢迎试用并反馈问题。





https://github.com/user-attachments/assets/79f4a123-2de2-429f-b302-0f1ad761ce26






<p align="center">
  <img src="docs/images/discovery.jpg" alt="Tangentry" width="100%" />
</p>



## 📖 目录

- [为什么做 Tangentry](#-为什么做-tangentry)
- [截图](#-截图)
- [功能](#-功能)
- [快速开始](#-快速开始)
- [使用指南](#-使用指南)
- [配置](#%EF%B8%8F-配置)
- [开发](#-开发)
- [项目结构](#-项目结构)
- [隐私与安全](#-隐私与安全)
- [常见问题](#-常见问题)
- [路线图](#-路线图)
- [致谢](#-致谢)
- [许可证](#-许可证)

## 💡 为什么做 Tangentry

内容散落在不同平台：B站的课程、YouTube 的讲座、小宇宙的播客、RSS 里的长文、小红书的图文笔记……
每个平台都有自己的推荐算法、自己的收藏夹，却没有一个地方能让你 **专注地读、认真地记、长期地留存**。

Tangentry 的思路是：

- **一个入口**：订阅、推荐、搜索、收藏统一到同一个界面；
- **阅读优先**：视频和播客也可以“读” —— 字幕跟随、全文搜索、双语对照、AI 摘要；
- **笔记即资产**：笔记锚定到时间点 / 原文段落 / PDF 位置 / 截帧，可导出为 Markdown（兼容 Obsidian）；
- **本地优先**：SQLite 存储在本机，不需要注册任何 Tangentry 账号，凭据从不进入源码或浏览器。

### Why Tangentry?

**Tangentry = Tangent + Entry**

- **Tangent** — 思维的发散、知识的延伸，以及探索过程中意想不到的发现。
- **Entry** — 进入知识世界的入口，也代表每一份值得记录和探索的内容。

**Tangentry** 是一个创造词，寓意着：每一份内容都是探索的起点，每一次好奇都可能通向新的知识。

无论是视频、播客、文章还是 PDF，我们希望打破内容形式的边界，让阅读成为一场自由延伸的知识探索。

> **Every curiosity leads somewhere.**
> 每一份好奇，都通向新的发现。

## 📸 截图

<table>
  <tr>
    <td width="50%"><b>发现</b>：B站、YouTube、小红书、小宇宙的推荐汇聚在一个首页<br/><img src="docs/images/discovery.jpg" alt="发现页" /></td>
    <td width="50%"><b>播客文稿</b>：小宇宙单集自动生成可阅读、可跳转的文字稿<br/><img src="docs/images/reader-podcast.jpg" alt="播客阅读页" /></td>
  </tr>
  <tr>
    <td><b>YouTube</b>：内嵌播放、字幕同步，翻译与摘要一键可用<br/><img src="docs/images/reader-youtube.jpg" alt="YouTube 阅读页" /></td>
    <td><b>小红书</b>：图文与视频笔记在同一个阅读器里查看、收藏和下载<br/><img src="docs/images/reader-xiaohongshu.jpg" alt="小红书阅读页" /></td>
  </tr>
  <tr>
    <td><b>笔记库</b>：跨来源检索、按标签和时间筛选，一键导出 Markdown<br/><img src="docs/images/notes.jpg" alt="笔记库" /></td>
    <td><b>设置</b>：账号、AI、转录、下载与外观集中管理<br/><img src="docs/images/settings.jpg" alt="设置页" /></td>
  </tr>
</table>

> 截图中的内容来自各平台公开推荐，版权归原作者所有，仅用于展示软件功能。

## ✨ 功能

| 模块 | 能力 |
| --- | --- |
| 🔭 **发现** | 聚合 B站 / YouTube / 小红书 / 抖音 / 小宇宙的推荐流，可调整来源偏好；“稍后看”推荐队列 |
| 📡 **订阅** | B站 UP 主、YouTube 频道、RSS / Atom / JSON Feed、小宇宙播客、linux.do 话题；分组、收件箱、已读状态、定时刷新、**OPML 导入/导出** |
| ➕ **添加内容** | 粘贴链接或 ID 解析视频、UP 主、频道、播客单集、网页文章、本地 PDF |
| 📺 **阅读与播放** | 内嵌播放器 + 字幕阅读器（跟随高亮、搜索、上下文跳转）、播放进度记忆、网页正文提取（Readability）、PDF 阅读 |
| 📝 **笔记** | 时间戳笔记、原文划线笔记、PDF 锚点、截帧附图、字幕引用、嵌套标签、置顶、全文搜索；导出 Markdown ZIP（含 Obsidian frontmatter） |
| 🎙️ **转录** | 本机：whisper.cpp / faster-whisper / Qwen3-ASR；云端：Groq、SiliconFlow、Cloudflare Workers AI 等；平台字幕优先，转录结果缓存 |
| 🤖 **AI 助手** | 接入任意 **OpenAI 兼容** 接口：视频/文章摘要、字幕与正文翻译（双语导出） |
| ⬇️ **下载** | 基于 yt-dlp + FFmpeg 的音视频下载、队列与超时控制 |
| ⭐ **收藏同步** | 同步 B站收藏夹到本地，支持过滤与断点续传 |
| 🕘 **历史** | 浏览历史与搜索历史，全部存于本地数据库 |
| 🖥️ **多端运行** | 原生桌面应用（macOS / Windows / Linux）或 Docker 自托管（NAS、家庭服务器），浏览器访问 |

## 🚀 快速开始

### 方式一：桌面应用（推荐普通用户）

前往 [Releases](https://github.com/mu-zi-lee/Tangentry/releases) 下载对应平台的安装包。发布流程只在推送 `v*` tag（例如 `v0.0.1`）时运行：它会编译桌面包、运行验证并构建 Docker 镜像。

| 平台 | 说明 |
| --- | --- |
| macOS（Apple Silicon） | 打开 `.dmg` 拖入“应用程序”。若提示“无法验证开发者”，右键 → 打开 |
| Windows（x64 / ARM64） | 下载 ZIP 并解压后运行 `Tangentry.exe`。未签名版本会触发 SmartScreen，点击“更多信息 → 仍要运行” |
| Linux（x64 / ARM64） | 安装 `.deb`，依赖 `ffmpeg` 与 `libgomp1` 会自动安装 |

桌面版自带运行时；**yt-dlp、Deno 与 Whisper 模型会在首次使用时自动下载并校验**，无需手动安装。

#### 一次性准备自动更新签名

桌面版的自动更新由 MyGo 的 Ed25519 签名保护。首次启用时，在本机运行：

```bash
cd src
go tool mygo keygen
```

将生成的 `mygo-update.pub` 公钥内容保存为 `src/updater/mygo-update.pub` 并提交；将 `mygo-update.key` 私钥的完整内容加入 GitHub 仓库的 **Settings → Secrets and variables → Actions**，Secret 名称必须是 `MYGO_UPDATER_PRIVATE_KEY`。私钥不要提交到仓库，请妥善离线备份；私钥丢失后，已经安装的应用将无法验证后续更新，只能重新安装。

发布工作流会把 MyGo 生成的 `update-<os>-<arch>.json`、签名归档和增量文件作为 GitHub Release 资产上传。若未配置 Secret，构建仍会完成但会明确警告，并不会生成可安装的签名更新。

macOS 构建默认使用 ad-hoc 签名。MyGo 更新时会替换整个 `.app` bundle，因此应用安装目录必须对当前用户可写；安装到需要管理员权限的 `/Applications`、只读卷或由包管理器管理的位置时，`Enabled` 会为 false，应用不会自行替换。ad-hoc 签名不能满足其他 Mac 的 Gatekeeper 信任，正式分发应使用 Developer ID 签名并完成 Apple 公证；未公证构建可能需要用户在“系统设置 → 隐私与安全性”中允许，或按现有故障排查说明移除隔离属性。

### 方式二：Docker 自托管

```bash
docker run -d --name tangentry -p 7380:7380 -v tangentry-data:/data \
  docker.io/<你的 Docker Hub 用户名>/tangentry:latest
```

或使用仓库内的 [`docker-compose.yml`](docker-compose.yml)：

```bash
docker compose up -d
```

GitHub Actions 发布镜像前，请在仓库的 **Settings → Secrets and variables → Actions** 中配置：

- `DOCKERHUB_USERNAME`：Docker Hub 用户名；
- `DOCKERHUB_TOKEN`：Docker Hub Access Token（不要使用登录密码）。

请先在 Docker Hub 该用户名下创建名为 `tangentry` 的仓库。本地使用 Compose 前，将 `.env.example` 复制为 `.env` 并设置 Docker Hub 用户名。推送 `v0.0.1` 这类版本 tag 后，工作流会自动发布 `latest`、完整版本号和主次版本号镜像。

Docker 服务端不提供应用内自更新；升级时请拉取新的 Docker 镜像并重新创建容器，数据卷会保留。

首次启动会生成登录密码并写入日志和 `/data/admin-password`：

```bash
docker compose logs tangentry | grep password
```

浏览器打开 <http://localhost:7380>，输入密码即可使用。也可以通过环境变量 `TANGENTRY_PASSWORD` 指定自己的密码。

> [!WARNING]
> 服务端模式只有一个共享密码。**暴露到公网前务必在前面加 HTTPS 反向代理**（Caddy / Nginx / Traefik）。

### 方式三：从源码运行

需要 Go 1.27+、Node.js 24+，以及（可选）`yt-dlp`、`ffmpeg`。

```bash
git clone https://github.com/mu-zi-lee/Tangentry.git
cd Tangentry
make server                       # 构建前端 + 服务端二进制
./build/tangentry-server -data ./data -addr 127.0.0.1:7380
```

## 🧭 使用指南

> 第一次使用建议按 **设置 → 添加内容 → 阅读 → 笔记** 的顺序走一遍。

### 1. 初始设置（左侧导航「设置」）

1. **账号（可选）**：登录 B站可获得关注动态、收藏夹同步和更高清晰度；订阅公开的 B站 UP 主与 YouTube 频道不要求登录。Cookie 只保存在本机数据目录。
2. **工具**：查看 yt-dlp / FFmpeg 状态。桌面版会自动准备，Docker 镜像已内置。
3. **转录**：选择本机模型（首次会下载）或填入云端转录服务的 API Key。
4. **AI**：填写 OpenAI 兼容接口的 `Base URL`、`Model` 和 `API Key`（如 OpenAI、DeepSeek、硅基流动、本地 Ollama 等），点击检测连通性。
5. **外观**：主题、卡片每页条数、字幕样式等偏好。

### 2. 获取内容

- **发现**：首页聚合各平台推荐，点击卡片进入阅读；点击“稍后看”加入推荐队列。
- **添加内容**：粘贴以下任意一种即可：
  - B站视频链接 / `BV` 号，UP 主主页链接 / UID
  - YouTube 视频或频道链接
  - 小红书笔记、抖音分享链接
  - 小宇宙单集 / 播客链接
  - 任意网页文章 URL 或 RSS 地址
- **订阅**：添加 UP 主、频道、RSS 或播客后，新内容进入「订阅收件箱」。可创建分组、标记已读，或通过 **OPML** 从其他阅读器迁移。

### 3. 阅读与播放

- 视频左侧播放、右侧显示 **字幕阅读器**：当前句高亮跟随，点击任一句跳转；支持字幕内搜索。
- 没有字幕？点击 **转录** 生成字幕；点击 **翻译** 生成双语字幕；点击 **摘要** 让 AI 总结要点。
- 文章与 PDF 同样支持划线、翻译和摘要。
- 播放进度自动记忆，下次打开从上次位置继续。

> [!TIP]
> B站内嵌播放器无法直接读取播放时间。安装用户脚本 [`bilibili-sync.user.js`](src/web/public/bilibili-sync.user.js)（Tampermonkey / Violentmonkey）后，字幕跟随与时间戳笔记可与官方播放器精确同步。

### 4. 记笔记

- 播放中按下「记笔记」会自动附上当前 **时间戳**；也可以 **截取当前画面** 作为配图。
- 在字幕、文章或 PDF 中选中文本即可创建 **引用笔记**，点击笔记可跳回原位置。
- 使用 `#标签/子标签` 组织笔记，在「笔记」页按标签、来源或全文搜索，重要笔记可置顶。
- 「导出」生成 Markdown ZIP，每条内容一个文件，带 JSON frontmatter，可直接放入 Obsidian 仓库。

### 5. 下载与收藏

- 在阅读页点击「下载」加入下载队列（视频或仅音频），在「下载」页查看进度。
- 「收藏」页管理本地收藏；登录 B站后可开启收藏夹自动同步。

## ⚙️ 配置

服务端通过 **环境变量** 配置（不会自动读取 `.env` 文件）。参考 [`.env.example`](.env.example)：

```bash
cp .env.example .env   # 编辑后加载
set -a; source .env; set +a
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TANGENTRY_ADDR` | `:7380` | 服务端监听地址 |
| `TANGENTRY_DATA` | `/data` | 数据目录（SQLite、设置、凭据、缓存） |
| `TANGENTRY_PASSWORD` | 自动生成 | 服务端登录密码，未设置时写入 `<data>/admin-password` |
| `TANGENTRY_DOWNLOAD_DIR` | `<data>/downloads` | 下载目录 |
| `TANGENTRY_DOWNLOAD_TIMEOUT` | `2h` | 单个下载超时（1s–24h） |
| `TANGENTRY_YTDLP_PATH` | PATH 中的 `yt-dlp` | 自定义 yt-dlp 路径 |
| `TANGENTRY_FFMPEG_PATH` | PATH 中的 `ffmpeg` | 自定义 FFmpeg 路径 |
| `TANGENTRY_TOOLS_DIR` | 空 | 设置后像桌面版一样在首次使用时下载并校验 yt-dlp / Deno |
| `TANGENTRY_BILIBILI_COOKIE_FILE` | 空 | Netscape 格式的 B站 Cookie 文件（推荐改用应用内扫码登录） |
| `TANGENTRY_WHISPER_PATH` / `TANGENTRY_WHISPER_SERVER_PATH` / `TANGENTRY_WHISPER_MODEL` | 空 | whisper.cpp CLI、常驻实时服务与模型 |
| `TANGENTRY_FASTER_WHISPER_PYTHON` | 空 | 安装了 faster-whisper 的 Python 解释器 |
| `TANGENTRY_WHISPER_MODELS_DIR` | 空 | 模型目录 |

应用内「设置」中保存的选项优先于环境变量默认值。

<details>
<summary><b>本机 faster-whisper 环境（可选）</b></summary>

```bash
python3 -m venv ~/.venvs/faster-whisper
~/.venvs/faster-whisper/bin/pip install -r src/tools/transcription/requirements.txt
export TANGENTRY_FASTER_WHISPER_PYTHON=~/.venvs/faster-whisper/bin/python
```

</details>

**数据目录位置**

| 运行方式 | 位置 |
| --- | --- |
| macOS 桌面 | `~/Library/Application Support/Tangentry` |
| Windows 桌面 | `%APPDATA%\Tangentry` |
| Linux 桌面 | `~/.config/Tangentry` |
| Docker | 卷 `/data` |

> 备份这个目录即可完整迁移你的库、笔记与设置。

## 🛠 开发

### 环境要求

- Go **1.27+**（使用纯 Go 的 `modernc.org/sqlite`，无需 CGO）
- Node.js **24+** 与 npm
- 可选：`yt-dlp`、`ffmpeg`（下载与截帧）、Python 3（本机转录）

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `make desktop` | 构建前端并以开发模式启动桌面应用（[MyGo](https://github.com/egoist/mygo)） |
| `make dev-local` | 启动本机浏览器开发环境，直接使用 macOS 桌面版数据（仅绑定 `127.0.0.1`，免登录） |
| `make server` | 构建 `build/tangentry-server` 无界面服务端 |
| `make build` | 打包当前平台桌面应用；`PLATFORMS=windows/amd64,...` 交叉打包 |
| `make desktop-build-all` | 打包全部平台（macOS 运行时需在 Apple Silicon 上构建） |
| `make docker` | 构建本地 Docker 镜像 |
| `make test` | 全部测试（`make test-unit` + `make test-e2e`） |
| `make check-race` | `go vet` + 竞态检测 |

前端单独开发：

```bash
cd src/web
npm ci
npm run dev        # Vite 开发服务器（http://127.0.0.1:5173）
```

### 测试

测试分层：**单元测试覆盖细节，少量 E2E 覆盖最重要的用户流程**。

```bash
make test-unit    # Vitest 前端单元测试 + go test（会先构建 src/web/dist）
make test-e2e     # Playwright 关键流程（首次运行前：cd src/web && npx playwright install chromium）
```

端到端测试使用 [`src/web/tests/server`](src/web/tests/server/main.go) 启动 **真实服务 + 隔离的 SQLite + 显式平台夹具**，不会访问任何外部平台。

## 🗂 项目结构

```text
Tangentry/
├── .github/                # 仅 tag 发布时运行的 CI/CD
├── Dockerfile              # Docker 多阶段构建
├── docker-compose.yml      # Docker Hub 镜像运行配置
├── docs/                   # 架构说明、截图与第三方许可证
└── src/                    # 应用源码（Go、React、打包工具）
    ├── cmd/                # 桌面应用与无界面服务端入口
    ├── internal/            # 领域、适配器、HTTP 与运行时服务
    ├── web/                # React 19 + Vite 前端
    └── tools/              # 桌面打包与本机转录工具
```

详细的分层规则与依赖方向见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 🔒 隐私与安全

- **本地优先**：所有内容、笔记、历史都存储在本机 SQLite 中，Tangentry 没有任何遥测或云端账号。
- **凭据隔离**：平台 Cookie 与 API Key 只保存在数据目录，不会下发给浏览器端，也不会自动读取浏览器 Cookie。
- **网络边界**：抓取公开网页时拒绝访问内网 / 本机地址（防 SSRF）。
- **外部服务**：只有当你主动配置 AI 或云端转录时，相关文本/音频才会发送给你选择的服务商。

发现安全问题？请参阅 [SECURITY.md](SECURITY.md)，不要直接公开提交 Issue。

## ❓ 常见问题

<details>
<summary><b>YouTube / B站 视频无法解析或下载？</b></summary>

平台接口经常变化。先在「设置 → 工具」更新 yt-dlp；B站高清晰度和部分内容需要登录。
</details>

<details>
<summary><b>转录很慢？</b></summary>

本机转录速度取决于 CPU / GPU 与模型大小。可以换更小的模型，或在设置中改用云端转录（Groq 等免费额度通常足够个人使用）。
</details>

<details>
<summary><b>macOS 提示“已损坏，无法打开”？</b></summary>

未经公证的构建会被 Gatekeeper 拦截，可执行：`xattr -dr com.apple.quarantine /Applications/Tangentry.app`
</details>

<details>
<summary><b>如何迁移到另一台电脑？</b></summary>

关闭应用后复制整个 [数据目录](#%EF%B8%8F-配置) 到新机器对应位置即可。
</details>

## 🗺 路线图

- [ ] 发布签名并公证的 macOS / Windows 安装包
- [ ] 英文界面（i18n）
- [ ] 更多平台适配
- [ ] 笔记双向同步到 Obsidian / Logseq

欢迎在 [Issues](https://github.com/mu-zi-lee/Tangentry/issues) 提出建议。

## 🤝 贡献

欢迎 Issue 与 Pull Request！开始之前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 🙏 致谢

- [MyGo](https://github.com/egoist/mygo) —— Go 原生桌面应用框架
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) 与 [FFmpeg](https://ffmpeg.org/) —— 媒体获取与处理
- [go-readability](https://codeberg.org/readeck/go-readability) —— 网页正文提取（[MIT](docs/licenses/go-readability-v2-MIT.txt)）
- [gofeed](https://github.com/mmcdole/gofeed)、[modernc.org/sqlite](https://gitlab.com/cznic/sqlite)、[OpenCC](https://github.com/longbridgeapp/opencc)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)、[faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [PDF.js](https://mozilla.github.io/pdf.js/)、[Lucide](https://lucide.dev/)、[Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk)、[Inter](https://github.com/rsms/inter)、[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)、[霞鹜文楷屏幕阅读版](https://github.com/lxgw/LxgwWenKai-Screen)、[思源黑体 / Noto Sans CJK](https://github.com/notofonts/noto-cjk)（均为 OFL 1.1；许可证文本见 `docs/licenses/`）
- [Linux DO](https://linux.do)

## Star History

<a href="https://www.star-history.com/?repos=mu-zi-lee%2Ftangentry&type=date&logscale=&releases=&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=mu-zi-lee/tangentry&type=timeline&theme=dark&logscale&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=mu-zi-lee/tangentry&type=timeline&logscale&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=mu-zi-lee/tangentry&type=timeline&logscale&legend=bottom-right" />
 </picture>
</a>

## ⚖️ 免责声明

Tangentry 仅供个人学习与研究使用。通过本工具获取的内容版权归原平台及作者所有，请遵守各平台的服务条款，不要用于批量抓取、再分发或任何商业用途。

## 📄 许可证

[MIT](LICENSE) © 2026 木子不是木子狸
