# Agent Note: 基于 web profile 的 Electron 桌面客户端

Status: implemented

[English](2026-08-14-electron-desktop-client.md) | 中文

## 问题

`dsh` 是本地 harness，其交互界面是浏览器 UI：`dsh --profile web` 启动 web bundle，通过 loopback HTTP 提供构建好的前端，用户在系统浏览器中打开。桌面客户端应让 macOS/Windows/Linux 用户获得可安装的原生应用，带托盘、菜单、deep link 与自动更新——但既不复制 harness，也不重写前端。方案是「桥接而非重写」：Electron 主进程就是 Node，整个插件树本来就设计为单进程运行，因此桌面外壳可以在进程内启动完全相同的 `web` profile，并将 `BrowserWindow` 指向服务地址。

难点在模块解析。CLI 通过 Node 内部 `ModuleLoader`（`loader.internal`）解析 Cordis 插件行：每个插件 specifier 都以 profile 目录的 `baseUrl` 为基准导入，扁平回退目录 `$DSH_HOME/profiles/node_modules`（由 `healProfilesModuleFallback` 维护）提供完整依赖闭包。Electron 主进程无法走这条路——`node-addon-require-builtin`（loader 访问 `internal/modules/esm/loader` 所需）与 Electron 的 V8 realm 不兼容——因此 `loader.internal` 为 undefined，插件行退化为从 bundle 位置解析的普通 `import(name)`，而 bundle 的 `node_modules` 只有直接依赖。传递依赖插件包（`dsh-llm`、`dsh-session` 等）解析失败。

## 决策

**新增 `apps/electron`（`@deepseek-ai/dsh-electron`，private）作为产品装配件**，与 `apps/cli`、`apps/web` 同级。它依赖 CLI 发布的同一批 workspace 包（`dsh-base`、`dsh-web-app` 及 web profile 完整闭包），因此 profile 目录 `$DSH_HOME/profiles/web` 是共享的：凭据、设置、用户 patch 对两个界面同时生效。主进程以 `--host 127.0.0.1 --port 0`（OS 分配端口）启动 `web` profile，桌面会话不会与并发的 `dsh web` 冲突。`BrowserWindow` 加载 `http://127.0.0.1:{port}`——即浏览器标签页得到的同一页面，由 harness 自身的 `frontend-static` 提供——开启 `contextIsolation: true`，通过 `window.__DSH_ELECTRON__` 暴露窄 preload 桥。前端零改动。

**`resolve-hooks.ts` 通过 Node 的 `registerHooks`（Node 24；Electron 43 内置 Node 24）恢复闭包。** resolve hook 将每个 `@deepseek-ai/*` specifier 映射到安装依赖图的 BFS 结果——与 `healProfilesModuleFallback` 链接的闭包相同——直接返回解析出的包入口 URL，而非写符号链接。hook 必须同时处理子路径 specifier，因为 Node 24 的 CJS `require.resolve` 会经过 registerHooks：harness 包探测 `${pkg}/package.json`（typert-loader、client-modules）时会到达 hook；以 `package.json` 结尾的子路径解析到 manifest 本身，不存在的返回 `undefined`，让调用方既有的「非 contributor」降级路径运行（即 CLI 上 `require.resolve` 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` 的同一判定）。

**两个 Electron realm 限制以降级而非失败告终。** Cordis HMR 服务需要 `--expose-internals`；桌面启动跳过配置热重载并给出警告（修改在重启后生效），CLI 保留其热重载契约。Node 24 的 `require(esm)` 拒绝仍在被并行动态 import 加载的模块（`ERR_REQUIRE_ESM_RACE_CONDITION`），而 loader 的并行插件扇出会触发它；`startServer` 在启动前串行预热 `cosmokit`/`schemastery`/`cordis`，使 CJS→ESM require 路径永不竞争。

**桌面扩展保持薄且标准。** `menu.ts`（原生角色 + 新建会话）、`tray.ts`（template 图标、显示/退出）、`deeplink.ts`（`dsh://` 协议、second-instance 路由）、`updater.ts`（electron-updater，仅打包构建）。打包用 `electron-vite`（仅 main + preload——无 renderer bundle，dist 由 harness 提供）加 `electron-builder`，native 模块走 `asarUnpack`。`pnpm-workspace.yaml` 放行 `electron`/`electron-winstaller` 构建脚本；`tsconfig.host.json` 与 `knip.json` 登记新 app。

## 备选方案

**在桌面主进程复用 `apps/cli` 的 `runProfile`。** 否决：CLI 只打包单个 `bin.js`，不导出库面，启动胶水终究要作为新的共享包发布。桌面 app 改为直接组合同一批原语（`boot`、`composeEntries`、`loadProfile`、`loadOptionalPatches`、`watchUserPatches`）——胶水归 app 所有，与各装配件自持 launcher 的做法一致。

**将 `dsh` CLI 作为子进程派生。** 否决：应用内多一个 Node 运行时更重，托盘/菜单/deep-link 协调更复杂，还失去退出时的进程内树清理。

**把共享的 profile 组合胶水提取进 `dsh-app-boot`。** 暂缓：`apps/cli/src/profile-boot.ts` 的 `composeProfile`/`prepareProfile` 是 app 胶水，合并是单独的清理工作，会触碰 CLI 的启动路径；桌面 app 目前镜像组合顺序（bundle → 用户层 → home 层 → telemetry 开关 → shipped agent-preset root），并注明后续变更可提取。

**用 `electron-vite` 的 renderer 构建替代 harness dist。** 否决：桥接的意义就在于 web profile 拥有前端；第二条构建管线会分叉 UI。有意省略 renderer 配置。

## 后果

桌面构建（`apps/electron`）现在在进程内启动共享的 `web` profile，并通过 OS 分配的 loopback 端口提供既有前端，因此凭据、设置和用户 patch 在 CLI 与桌面两个界面间完全一致。Electron realm 失去配置热重载（`cordis.patch.yml` 的修改在冷重启后生效），换来托盘/菜单/deep link/自动更新外壳；插件依赖闭包通过 `registerHooks` 而非内部 loader 解析，核心 ESM 模块串行预热以避免 Node 24 的 `require(esm)` 竞态。打包覆盖三个平台，签名在证书就绪前保持关闭；发布通道是独立的 `electron-v*` tag，npm dsh 序列不受影响。`apps/cli/src/profile-boot.ts` 的组合胶水在 `apps/electron/src/main/server.ts` 中仍有重复；后续变更可能将其提取到 `dsh-app-boot`。
