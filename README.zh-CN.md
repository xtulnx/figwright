<div align="center">

<br />

<picture><source media="(prefers-color-scheme: dark)" srcset="./.github/assets/logo-full-dark.svg"><source media="(prefers-color-scheme: light)" srcset="./.github/assets/logo-full-light.svg"><img alt="Figwright" src="./.github/assets/logo-full-light.svg" width="499" height="150"></picture>

<br />

面向 AI 编程助手的免费双向 Figma MCP 服务。<br />
通过 Figma 插件读写设计稿，无需付费 Dev Mode 席位。

[English](./README.md) · **简体中文**

[简介](#简介) · [安装与连接](#安装与连接) · [技能](#技能) · [工具](#工具) · [插件界面](#插件界面) · [页面备份与恢复](#页面备份与恢复) · [常见问题](#常见问题) · [参与贡献](#参与贡献)

[![npm](https://img.shields.io/npm/v/@figwright/mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/@figwright/mcp)
[![CI](https://github.com/awdr74100/figwright/actions/workflows/ci.yml/badge.svg)](https://github.com/awdr74100/figwright/actions/workflows/ci.yml)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

</div>

## 简介

Figwright 使用本地 WebSocket 将 **MCP 服务端**与 **Figma 插件**连接，让 Claude Code、Cursor、Codex 等支持 MCP 的 AI 助手读取和编辑 Figma 设计稿。

- **从设计到代码**：读取选中设计的布局、文字、变量和组件信息，结合项目实际使用的框架、样式方案及已有组件生成代码。
- **从代码或描述到设计**：直接在画布中创建和编辑 Frame、文字、自动布局、样式、变量、组件及完整页面。

<p align="center">
  <img alt="AI 读取 Figma 选中区域，复用项目中的组件、颜色变量和图标生成页面" src="./.github/assets/figma-to-code.webp" width="820">
</p>

<p align="center">
  <img alt="AI 通过 Figwright 工具逐步在 Figma 画布中创建页面" src="./.github/assets/code-to-figma.webp" width="820">
</p>

主要特点：

- **免费使用**：通过插件调用 Figma Plugin API，无需付费 Dev Mode 席位；Figma 本身的套餐限制仍然适用。
- **双向操作**：当前分支提供 **138 个 MCP 工具**，覆盖设计读取、画布编辑和设计与代码的关联。
- **适配现有项目**：识别实际技术栈，优先复用组件、设计变量和图标。
- **多文件协作**：不同 MCP 客户端可以分别绑定自己的 Figma 文件。
- **可扩展**：读写工作流以可安装的技能提供，也可以按项目需要修改。
- **插件独立备份**：无需运行 AI 或 MCP 服务，即可在插件中导出当前页面或恢复已有归档，详见[页面备份与恢复](#页面备份与恢复)。

## 安装与连接

使用 MCP 自动化需要 MCP 客户端、Node.js 和 Figma。**当前源码的运行要求为 Node.js `^24.11.0 || >=26.0.0`**；本仓库开发环境使用 `.node-version` 指定的版本和 `package.json` 指定的 pnpm。导入开发插件需要 Figma 桌面端。

以下 `@latest` 配置运行的是 npm 已发布版本；本分支新增的备份功能请按下文的[本地源码运行](#本地源码运行)操作，发布版本不一定包含这些功能。

### 1. 配置 MCP 服务端

以 Claude Code 的 `.mcp.json` 为例，其他客户端请使用相应的 MCP 配置入口：

```json
{
  "mcpServers": {
    "figwright": {
      "command": "npx",
      "args": ["-y", "@figwright/mcp@latest"]
    }
  }
}
```

`npx` 会下载并运行已发布的服务端，无需全局安装。

### 2. 安装 Figma 插件

插件通过开发插件方式导入：

1. 从 [GitHub 最新 Release](https://github.com/awdr74100/figwright/releases/latest) 下载插件 zip 并解压。
2. 在 Figma 桌面端依次选择 **Menu → Plugins → Development → Import plugin from manifest…**。
3. 选择解压目录中的 `manifest.json`。

### 3. 建立连接

打开设计文件，运行 **Plugins → Development → Figwright**。插件会自动连接本机服务端，显示 **Connected／已连接** 后，可以让 AI 调用 `ping` 确认。

使用过程中保持插件运行。仅使用插件的独立备份功能时，不需要 MCP 连接成功。

### 4. 安装技能（可选）

```bash
npx skills add awdr74100/figwright/skills
```

技能帮助 AI 选择合适的工具并遵循设计读取或构建工作流。

### 5. 开始使用

选中 Figma 中的 Frame，向 AI 发出指令：

> 将当前 Figma 选中区域实现为 React 组件，复用项目中的组件和设计变量。

也可以反向操作：

> 根据这份需求，在 Figma 中创建一个价格方案区域。

### 本地源码运行

若要使用本分支的页面备份、恢复及中英文界面，请从项目根目录构建：

```bash
pnpm install --frozen-lockfile
pnpm build
```

在 Figma 桌面端导入本项目的 `packages/plugin/manifest.json`。如果之前已导入同一目录，只需关闭并重新运行 Figwright；其他目录中的发布版插件不会随本项目构建自动更新。

本地 MCP 配置示例：

```json
{
  "mcpServers": {
    "figwright": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/figwright/packages/mcp/dist/index.mjs"]
    }
  }
}
```

将两个路径替换为实际的绝对路径。修改服务端或 shared 后，需要重新构建并重启 MCP 连接，因为运行的是 `dist`，不是 TypeScript 源码。仅使用插件独立备份时不必配置 MCP。

### 更新

服务端和插件通过不同途径更新，需要同时检查：

1. **重启服务端**：使用 `@latest` 配置时，已有会话不会自动切换到新构建。在 Claude Code 中运行 `/mcp`，选择 figwright 并重新连接；其他客户端请重启相应连接或客户端。本地构建也需要重启连接。
2. **替换插件文件**：将新版 `manifest.json` 与 `dist` 放回原来导入的插件目录，然后关闭并重新运行插件，无需重复导入同一路径。
3. **更新技能**：运行 `npx skills update`，新启动的 AI 会话会使用更新后的技能。

使用项目依赖或全局安装时，先执行 `npm i -D @figwright/mcp@latest` 或 `npm i -g @figwright/mcp@latest`，再重启服务端。

插件的 **Debug／调试** 标签会并列显示插件与服务端版本。版本差异影响工具可靠性时，面板和工具返回值会提示更新。

## 技能

| 技能                                             | 用途                                                       |
| ------------------------------------------------ | ---------------------------------------------------------- |
| [figma-codegen](./skills/figma-codegen/SKILL.md) | 依据 Figma 选区和项目技术栈生成代码，复用已有组件。        |
| [figma-build](./skills/figma-build/SKILL.md)     | 根据代码或描述构建设计，优先使用文件中的组件、样式和变量。 |

可一次安装两个技能，也可只安装其中一个：

```bash
npx skills add awdr74100/figwright/skills
npx skills add https://github.com/awdr74100/figwright/tree/main/skills/figma-codegen
```

技能本身不包含 MCP 工具；使用它们需要已连接的 Figwright 服务端和插件。

## 工具

当前分支的 138 个 MCP 工具主要分为三类：

- **读取**：选区、文档、节点、样式、变量、组件、字体、原型交互、动画状态、截图、原始图片资源，以及 PDF、动画视频导出等。
- **写入**：Frame、文字、形状、矢量、自动布局、对齐、效果、图片、样式、变量、组件、页面、原型和 Motion 动画等；`batch` 可将支持回滚的多项操作组成批次。
- **设计与代码关联**：`get_design_context` 提供去重的设计上下文，`component_map`、`token_map`、`icon_map` 将设计与代码库关联，`design_diff` 对比设计基线以定位改动。

另外，`list_files` 和 `use_file` 用于多文件路由；`backup_design`、`inspect_backup` 和 `restore_backup` 提供实验性备份、校验与恢复。工具数量和参数以客户端连接后实际列出的目录为准。

## 插件界面

插件支持**简体中文和 English**，默认跟随浏览器/系统语言，也可通过顶部语言菜单即时切换。本地存储可用时会记住选择；否则偏好只在本次会话生效。语言切换不会改写设计名称、归档或原始诊断数据。

- **Activity／活动**：查看工具调用、耗时、错误及实际发送给模型的数据；可定位调用涉及的节点。
- **Context／上下文**：查看当前文件、页面、编辑器和选中节点。
- **Backup／备份**：直接备份当前页面、选择归档、检查覆盖限制并恢复到新页面。
- **Debug／调试**：查看连接、版本、调用统计和诊断信息。诊断包可能包含设计内容，分享前请检查。

<p align="center">
  <img alt="Figwright 插件的调用记录、数据详情和调试界面" src="./.github/assets/plugin-panel.png" width="820">
</p>

插件适配 Figma 的浅色和深色主题：

<p align="center">
  <img alt="插件的浅色与深色主题" src="./.github/assets/plugin-theme.png" width="616">
</p>

拖动右下角可调整窗口大小。点击顶部的 **Run in background／后台运行** 可隐藏面板并保持连接，重新运行插件即可显示；Figma 自带的关闭按钮则会终止插件与连接。Dev Mode 的 Inspect 面板由 Figma 管理，不提供这些窗口控制。

<p align="center">
  <img alt="插件窗口大小调整与后台运行入口" src="./.github/assets/plugin-window.png" width="602">
</p>

## 页面备份与恢复

**这是一项有明确覆盖限制的实验性能力，尚不能保证任意设计稿完整恢复。** 它使用自定义 `.figwright-backup` 文件，不依赖官方 `.fig` 格式。

### 无需 AI 或 MCP 的插件操作

1. 在 Figma Design 中打开需要备份的页面，运行本地构建的 Figwright 并进入 **备份** 标签。
2. 点击 **备份当前页面**，等待完成，再点击 **下载 .figwright-backup 文件**。出现下载按钮表示归档已生成，仍需确认文件已保存到本机。
3. 恢复时选择归档文件，插件会校验容器、哈希、长度、节点树和图片引用。
4. 选择归档中的页面，检查覆盖限制。存在已知缺项时，需要主动勾选允许部分恢复。
5. 点击 **恢复到新页面**。现有页面保留，恢复内容写入新页面；任务支持进度、状态检查、取消及报告复制。执行期间保持插件打开。

导出后的橙色覆盖提示不等于导出失败，可以展开查看原因。当前快照始终记录三条通用说明：跨文件完整恢复尚未验证；未包含动画定义及外部库发布身份；Figma 不提供原子读取事务，捕获一致性无法保证。具体设计中发现的其他问题会额外列出。

### 支持范围与限制

支持常见图层、混合文字、原始图片、可达变量与样式定义及绑定，以及支持范围内的普通本地组件和原生实例。复杂嵌套实例、变体、组件属性、视频、动画等尚未完整覆盖；部分恢复可能丢失属性或组件语义，不能将外观接近视为完整恢复。

插件导出当前 page；MCP 可选择单页或全部页面。归档恢复可选择其中的页面。缺字体会在创建页面前拒绝，不自动替换字体。恢复长任务不会阻塞其他写操作，但与同时执行的写入共享撤销步骤，应避免同时编辑恢复内容。

完整用法和边界见：

- [备份与恢复使用说明](./BACKUP_USAGE.md)
- [能力范围及验证证据](./BACKUP_CAPABILITIES.md)
- [开发计划](./BACKUP_RESTORE_PLAN.md)

## 工作原理

```text
MCP 客户端（Claude Code / Cursor / Codex 等）
    │ stdio
    ▼
@figwright/mcp 服务进程
    │ 多个进程选举一个 leader，其余 follower 转发调用
    │ 127.0.0.1:3055，本地 WebSocket，msgpack 二进制协议
    ▼
Figwright 插件
    ├─ Vue 面板：连接、调用记录、独立备份界面
    └─ sandbox：通过 Figma Plugin API 读取与编辑画布
```

默认按用户最近活动的文件路由；客户端通过 `use_file` 绑定后，调用固定发送到该文件。连接恢复、leader 切换、写入幂等和长读取协作让步用于提高稳定性。

独立备份通过面板与 sandbox 的内部消息运行，不经过 MCP 或 WebSocket relay。

Figwright 优先提供准确的设计上下文，让模型按项目实际情况生成代码，而不是使用固定编译模板。

## 安全与数据流向

Figwright 的服务进程和 relay 在本机运行，relay 使用 `127.0.0.1:3055`。请求经过 Host、Origin 及相应 HTTP 媒体类型检查，降低恶意网页访问本地服务的风险。插件通过 Figma 公开 Plugin API 操作设计内容。

**本地 relay 不代表模型不会收到设计数据**：使用 AI 工作流时，工具返回的设计上下文会交给 MCP 客户端及其使用的模型服务。独立插件备份流程不把备份内容发送给 AI 或 relay。分享诊断包前也应检查其中的设计信息。

写入工具会修改 Figma 文件，导出工具可能写入本机路径。请通过 MCP 客户端的工具审批机制审查 AI 行为，避免执行来自设计内容或其他不可信来源的指令。威胁模型及漏洞反馈方式见 [SECURITY.md](./SECURITY.md)。

## 常见问题

### 服务端无法启动，提示 command not found 或 Connection closed？

MCP 客户端通常直接启动配置中的命令，不会加载交互式 shell 配置。使用 fnm、nvm、asdf、volta、mise 等版本管理器时，客户端可能找不到 Node 或 npx。

- 在终端运行 `which npx` 或 `which node`，将实际绝对路径填入 MCP 配置。
- 客户端支持时，通过该服务的 `env.PATH` 配置 Node 所在目录。
- `@latest` 启动会访问 npm registry；代理、网络或 npm 配置问题可能导致握手前退出。

需要避免每次联网解析时，可将服务端安装为项目依赖，然后去掉配置中的 `@latest`：

```bash
pnpm add -D @figwright/mcp
```

```json
{
  "mcpServers": {
    "figwright": {
      "command": "npx",
      "args": ["-y", "@figwright/mcp"]
    }
  }
}
```

也可全局安装 `npm i -g @figwright/mcp`，用 `which figwright-mcp` 得到的绝对路径作为 `command`。

### 插件一直等待连接？

检查 MCP 客户端是否运行且已配置 Figwright、插件是否在同一台机器上运行，以及安全软件是否阻止本地回环连接。独立备份不需要该连接，直接进入 **备份** 标签即可。

### 如何确认插件和服务端版本匹配？

查看 **调试** 标签中的两个版本。旧插件可能忽略新参数并报告成功，版本提示出现时应同时更新插件和服务端，不能仅依靠“已连接”判断功能完整。

### 需要付费 Figma 或 Dev Mode 吗？

不需要付费 Dev Mode 席位，免费套餐即可使用插件，但页面数量等 Figma 自身限制仍然生效。

### 支持 Dev Mode 和 FigJam 吗？

- **Figma Design**：主要支持的编辑器；备份与恢复仅支持此编辑器。
- **Dev Mode**：支持读取和部分导出，节点、页面、变量和样式写入均被 Figma 禁止。
- **FigJam**：支持 Frame、分区、形状和文字；不支持组件、变量、样式及 Motion。

`get_metadata` 返回 `editorType` 和 `mode`，与编辑器能力有关的错误会提供相应说明。

### 多个 AI 可以同时使用插件吗？

可以。多个 MCP 服务进程共享 leader 的插件连接。若各自在不同文件工作，应先通过 `list_files` 查询会话，再使用 `use_file` 绑定文件：

```text
use_file({ fileName: "Marketing Site" })
```

不同文件重名时使用 `list_files` 返回的 `sessionId`。通过 `use_file({ release: true })` 解除绑定。

绑定属于 MCP 服务进程，一个客户端内的子代理共享绑定。让不同 AI 分别使用文件时，应使用独立客户端或独立终端会话。未绑定时，调用跟随最近活动文件，切换 Figma 标签可能改变调用目标。

## 参与贡献

架构、目录、技术栈及开发约定见 [AGENTS.md](./AGENTS.md)，贡献与 PR 流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

从仓库根目录运行检查；构建后再运行测试，确保覆盖依赖 `dist` 的端到端测试：

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm knip
pnpm build
pnpm test
```

提交格式为 `type(scope): subject`，scope 使用仓库约定的范围。

## 名称由来

`-wright` 在英语中表示制作者或工匠，例如 playwright（剧作家）、shipwright（造船者）。Figwright 的名字也呼应 [Playwright](https://playwright.dev)：Playwright 驱动浏览器，Figwright 驱动 Figma，既读取画布，也创建和修改设计。

## 许可证

[MIT](./LICENSE) © Roya
