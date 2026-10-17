# 这个仓库是什么

从 [`juicesharp/rpiv-mono`](https://github.com/juicesharp/rpiv-mono) 的
`packages/rpiv-todo` 独立出来的个人 fork：上游仍在那边的 monorepo 里开发同一个包，
本仓库只承载「我的定制 + 便于单独安装/单独发版」。

包名沿用上游的 `@juicesharp/rpiv-todo`：pi 对 git 源用**仓库 URL** 认身份，
同名不会与 npm 上的包串味，也让测试、`files` 清单、文档链接保持零改动。

- `origin` = 本仓库（唯一 push 目标）。
- 上游参照物仍留在 `D:/GitHub/rpiv-mono/packages/rpiv-todo`（只读对照，不再从那里安装）。

## 本机安装方式

```powershell
pi install git:github.com/fenlyin0420/pi-todo
```

pi 会把仓库 clone 到 `~/.pi/agent/git/github.com/fenlyin0420/pi-todo` 并装运行时依赖
（`@juicesharp/rpiv-config`），**开发就直接在这个 clone 里改**（与 pi-ask /
pi-computer-use 等仓库同一套流程），改完 push，再 `pi update --extensions`。

没有构建步骤：`package.json` 的 `pi.extensions` 指向 `./index.ts`，pi 用 jiti 直接加载 TS；
改完源码要重启对应的 pi 进程才生效。

## 与上游的差异

| 类型 | 内容 | 落点 | 为什么 / 注意事项 |
|---|---|---|---|
| 纯新增 | 未完成清单回灌到本次请求（状态回灌 + 节流器） | `reminder.ts`、`index.ts` 三处接线、`config.ts` 两个选项、`docs/configuration.md` | 上游 `todo` 工具的结果只有一行摘要，overlay 是 TUI 组件——模型读不到完整清单，长会话必然漂移 |
| 提取适配 | `@juicesharp/rpiv-test-utils` 内置 | `test-utils/`（`index/pi/session/theme/manifest` + `workflow-types.ts` 类型垫片） | 上游该包 `private: true` 且未发布；`vitest` 用别名把这个 specifier 指过来，测试文件保持与上游一字不差 |
| 提取适配 | `manifest.ts` 补 Windows 分隔符归一化 + `SKIP_DIRS` 增加 `test`/`test-utils`、`SKIP_FILES` 增加 `vitest.config.ts` | `test-utils/manifest.ts` | 上游 `walkProductionTs()` 用 `relative()` 生成 `state\store.ts`（反斜杠），与 `files` 里的 `state/store.ts` 永远对不上——上游在 Windows 上必然失败（Linux CI 看不出来） |
| 提取适配 | `overrides` 把 `@earendil-works/pi-{codemode,mcp,agent-core}`、`chord` 钉在 `1.1.0` | `package.json` | 不钉会解析到 pi-codemode 1.3.0，`todo.codemode-replay.test.ts` 报 `MCP_TYPESCRIPT_PREAMBLE` 不存在。运行时这几个由 pi 宿主提供，`overrides` 只影响本地测试环境 |
| 元数据 | `repository` / `homepage` / `bugs` / `pi.image` 指向本仓库 | `package.json`、`README.md` | — |

版本号与上游对齐（当前 `2.13.9`），定制改动不单独占版本，方便一眼看出这棵树枝在哪个上游发布上。

## 同步上游

```powershell
cd D:\GitHub\rpiv-mono
git fetch upstream
git log --oneline main..upstream/main -- packages/rpiv-todo   # 先看上游动了什么

# 把上游包目录导出到临时目录，再与本仓库逐文件比
$tmp = "$env:TEMP\upstream-rpiv-todo"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
mkdir $tmp | Out-Null
git archive upstream/main packages/rpiv-todo | tar -x -C $tmp --strip-components=2
robocopy $tmp . /L /NJH /NJS /NP /E /XD node_modules docs  # /L 只列差异，去掉即复制
```

判定原则：

- 上游改动落在**我们没有碰过**的文件 → 直接覆盖。
- 落在 `index.ts` / `config.ts` / `package.json` → 手工合；这三处定制区域很小
  （`index.ts` 三处各 1–2 行，`config.ts` 两个选项，`package.json` 的 `files` 加一行 `reminder.ts` 与 `overrides`）。
- 上游新增/改名的测试文件 → 连同 `test-utils/` 是否有新增导出一起看；若新导出落在
  未内置的模块（`concurrent-host`/`contract`/`exec`/`fetch`/`fs`/`spawn`/`stdout`），
  按需把这些文件补进 `test-utils/`，`index.ts` 相应的 `export *` 一起加。

## 验证

```powershell
npm install
npm run check        # tsc + biome + vitest
```

当前基线：**278 tests / 23 files 全绿**（含上游在 Windows 上必失败的那条 ship-manifest，
本地已修）、`tsc --noEmit` 干净、`biome check` 干净。
