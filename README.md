<div align="center">

# Remote SSH Manager

**Servers, terminals, files and an AI copilot — all in one window.**

A cross-platform SSH management desktop app built with Tauri v2, React and TypeScript.
Organize connections in a tree, open multi-tab terminals, transfer files over SFTP,
and let a bring-your-own-key AI assistant read your terminal output and
operate your servers — always with your explicit approval.

[Features](#features) · [Getting Started](#getting-started) · [Security](#security) · [Roadmap](#roadmap) · [中文文档](#中文文档)

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-orange)](https://v2.tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)](#)
[![GitHub stars](https://img.shields.io/github/stars/UlanqabBadGuy/Remote-Server-Manager?style=flat&logo=github)](https://github.com/UlanqabBadGuy/Remote-Server-Manager/stargazers)
[![GitHub release](https://img.shields.io/github/v/release/UlanqabBadGuy/Remote-Server-Manager?logo=github)](https://github.com/UlanqabBadGuy/Remote-Server-Manager/releases)

</div>

---

## Features

<table>
<tr>
<td width="50%">

### Server Management
- Password / key-file authentication
- Secrets stored in the **OS credential manager**, never in plain text
- Nested groups, tree view, right-click menus
- Quick Connect for one-off sessions
- JSON import / export for backup & migration

### Terminal & Files
- Multi-tab terminals powered by **xterm.js**
- Copy / paste, clickable links, auto-resize
- SFTP file browser with upload / download
- Select terminal output → send to AI in one click

</td>
<td width="50%">

### AI Copilot (BYOK)
- OpenAI / Anthropic / Google / DeepSeek / any OpenAI-compatible endpoint
- Dynamic model list fetched from your endpoints
- Multi-session chats with auto titles
- Streaming + collapsible **thinking display**
- Markdown rendering with code highlighting

### Agent Mode
- AI runs commands, reads files, lists directories on the connected server
- **Every tool call requires your approval** before execution
- Terminal references attached as context tags

</td>
</tr>
</table>

---

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Desktop  | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| Terminal | xterm.js |
| State    | Zustand |
| Markdown | react-markdown + remark-gfm + react-syntax-highlighter |
| Secrets  | OS credential manager (Windows Credential Manager / macOS Keychain / Linux Secret Service) |

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)
- Platform toolchains:
  - **Windows**: MSVC Build Tools + WebView2 (preinstalled on Windows 10/11)
  - **Linux**: `webkit2gtk` and related dev packages
  - **macOS**: Xcode command line tools

### Run in development

```bash
npm install
npm run tauri dev
```

### Build installers

```bash
npm run tauri build
```

Installers are generated under `src-tauri/target/release/bundle/`
(`.msi` / `.nsis` on Windows, `.deb` / `.rpm` / AppImage on Linux, `.dmg` on macOS).

To produce updater signature files (`.sig`), provide your signing key:

```bash
# PowerShell (Windows)
$env:TAURI_SIGNING_PRIVATE_KEY="path/to/private.key"; npx tauri build

# bash (Linux / macOS)
TAURI_SIGNING_PRIVATE_KEY=path/to/private.key npx tauri build
```

> Keep the updater **private key offline and secret**. The public key in `tauri.conf.json` is safe to publish.

---

## Automatic Updates

The app checks `latest.json` published on GitHub Releases at startup.
When a new version is available, an update banner appears and the user can install it in place.

Release checklist:
1. Bump `version` in `src-tauri/tauri.conf.json`
2. Build with the signing key (see above)
3. Create a GitHub Release and upload the installer(s) plus an updated `latest.json`
   (new version, `.sig` signature, download URL)

---

## Security

- SSH passwords / key passphrases live **only** in the OS credential manager.
- The AI assistant **never** sees stored credentials. It can only:
  - receive terminal text you explicitly select and send, and
  - execute tool calls (run command / read file / list directory) on an already-authenticated
    SSH session, **after you approve each call**.
- Treat AI approvals like typing the command yourself: review before approving.

---

## Roadmap

- SSH config file (`~/.ssh/config`) import
- Command snippets & quick actions
- Port forwarding UI
- Session logging & replay
- i18n (English / Chinese)

Contributions and feature requests are welcome — open an issue or a pull request.

---

## Project Structure

```
src/
  components/     React UI (sidebar, terminal, file browser, AI sidebar, tour, updater)
  store/          Zustand stores (app state, AI state, toasts)
src-tauri/
  src/            Rust backend (SSH, SFTP, keychain)
  tauri.conf.json Tauri configuration (incl. updater public key)
assets/           Logo & screenshots
```

---

## License

Distributed under the [MIT License](LICENSE).

---

## 中文文档

<div align="center">

**服务器、终端、文件、AI 副驾 —— 一窗搞定。**

基于 Tauri v2 + React + TypeScript 的跨平台 SSH 管理桌面应用。

</div>

### 功能特性

- **连接管理**：密码 / 密钥认证；密码仅存于系统凭据管理器；多层嵌套分组树；快速连接；JSON 导入导出
- **终端与文件**：xterm.js 多标签终端；SFTP 文件浏览器；选中文本一键发送给 AI
- **AI 助手（自带 Key）**：OpenAI / Anthropic / Google / DeepSeek / 任意兼容接口；动态模型列表；多会话自动标题；流式输出 + 思考过程展示；Markdown 渲染
- **Agent 模式**：AI 可在已连接服务器上执行命令、读文件、列目录，每次调用均需用户确认
- **体验**：三栏可拖拽布局；深浅主题；新手引导；GitHub Releases 自动更新

### 开始使用

```bash
npm install
npm run tauri dev     # 开发模式
npm run tauri build   # 打包安装程序
```

### 安全说明

- SSH 密码仅保存在操作系统凭据管理器中，不以明文存储
- AI 无法获取任何已保存凭据；所有工具调用必须经过用户确认才会执行

### 许可

基于 [MIT 许可证](LICENSE) 开源。
