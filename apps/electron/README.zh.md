# `@deepseek-ai/dsh-electron`

[English](README.md) | 中文

DeepSeek Harness 桌面客户端：基于 `web` profile 的 Electron 外壳。主进程启动与 `dsh web` 完全相同的 Cordis 插件树——同一个 `$DSH_HOME/profiles/web`、同一批插件、同一份被服务的前端——`BrowserWindow` 加载 loopback URL。不重写任何 harness 代码，也不打包 renderer：窗口拿到的是浏览器标签页看到的同一页面。

## 为什么可行

`dsh` 是构建在 vendored Cordis 微内核上的「一切皆插件」体系，而 Electron 主进程本身就是 Node，因此整个插件树可以在其中原样运行。桌面应用只是传输外壳：启动 → 服务 → 把窗口指过去。关于本方案桥接的两个 Electron realm 限制（依赖闭包解析与 `require(esm)` 竞态）以及它们为何降级而非失败，见 [Agent Note](../../.agents/notes/implemented/feature/2026-08-14-electron-desktop-client.md)。

## 目录结构

| 路径 | 职责 |
|---|---|
| [`src/main/index.ts`](src/main/index.ts) | 窗口生命周期、单实例锁、IPC 窗口控制 |
| [`src/main/server.ts`](src/main/server.ts) | 在进程内以 OS 分配端口启动 `web` profile |
| [`src/main/resolve-hooks.ts`](src/main/resolve-hooks.ts) | 用 `registerHooks` resolve hook 恢复插件依赖闭包 |
| [`src/main/menu.ts`](src/main/menu.ts) | 原生应用菜单 |
| [`src/main/tray.ts`](src/main/tray.ts) | 系统托盘（显示/退出） |
| [`src/main/deeplink.ts`](src/main/deeplink.ts) | `dsh://` 协议注册与 second-instance 路由 |
| [`src/main/updater.ts`](src/main/updater.ts) | electron-updater 集成（仅打包构建） |
| [`src/preload/index.ts`](src/preload/index.ts) | `window.__DSH_ELECTRON__` 下的窄 `contextBridge` 面 |
| [`electron-builder.yml`](electron-builder.yml) | macOS/Windows/Linux 打包目标 |

## 开发

在仓库根目录构建一次 workspace 库与 web dist，然后运行：

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-electron run dev
```

应用与 CLI 共享 profile 和凭据：`dsh web`（或 `$DSH_HOME`）下配置的任何内容在这里立即可见。窗口加载被服务的前端；从 View 菜单打开 DevTools。

## 打包

```sh
pnpm --filter @deepseek-ai/dsh-electron run package        # current platform
pnpm --filter @deepseek-ai/dsh-electron run package:mac   # dmg + zip (x64, arm64)
pnpm --filter @deepseek-ai/dsh-electron run package:win   # nsis + portable
pnpm --filter @deepseek-ai/dsh-electron run package:linux # AppImage + deb
```

产物在 `apps/electron/release/`。代码签名与公证在证书就绪前保持关闭；未签名构建需要手动信任步骤才能安装。自动更新读取 `publish` 配置（GitHub Releases），且只在打包构建中检查。

## 测试

```sh
pnpm vitest run apps/electron/tests
```
