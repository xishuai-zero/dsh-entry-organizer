# 发布指南（维护者用）

本文件记录 `dsh-entry-organizer` 从本地目录到 **GitHub · npm · awesome-dsh-plugin** 的完整发布流程。所有命令在仓库根目录执行。

## 0. 发布前自检

```sh
npm run check
npm test
npm pack --dry-run
```

预期：语法检查通过；**38 个测试全过**（10 纯函数/存储 + 28 mini-DOM 集成与组件）；tarball 只包含 `index.js`、`client.js`、`cordis.patch.yml`、`README.md`、`LICENSE`、`package.json`。

已核实的事实：

- npm 包已发布 `0.1.1`（2026-10-30），`dist-tags.latest` 指向 `0.1.1`；`0.1.0` 仍可安装。
- 本机宿主版本 0.2.1-rc.5，满足 `engines.dsh: ">=0.2.1-rc.5"`。
- 零依赖、无构建步骤，安装不需要 `allowBuilds` 构建授权。
- `package.json` 的 `publishConfig.registry` 已固定为官方 registry；若 npm CLI 的全局 registry 被镜像覆盖，发布时仍要显式带 `--registry=https://registry.npmjs.org/`（镜像只读，不能发布）。

## 1. 创建 GitHub 仓库

浏览器打开 <https://github.com/new>：

- **Repository name**: `dsh-entry-organizer`
- **Public**（公开才能被市场和收录列表抓取）
- **不要**勾选初始化 README / .gitignore / LICENSE —— 本地已有，勾了会冲突。

创建后：

- **Description**（建议）：`DSH plugin: drag-reorder sidebar panel entries and conversation tabs, and move entries between them.`
- **Topics**：必须加 `dsh-plugin`（awesome 收录的硬要求）；可再加 `deepseek-harness`、`dsh`。
- 该仓库创建后需**满 24 小时**才能投稿 awesome（CI 自动检查仓库年龄）。

## 2. 首次推送（需要 GitHub 认证）

本地还没有仓库时先初始化，然后提交并推送：

```sh
git init -b main
git add -A
git commit -m "feat: dsh-entry-organizer v0.1.1"
git remote add origin https://github.com/xishuai-zero/dsh-entry-organizer.git
git push -u origin main
```

- 凭据用 Git Credential Manager 登录一次（浏览器授权即可）；若提示缺少 helper：`git config credential.helper manager`。
- 网络提示：如果访问 `github.com` 需要本地代理/加速器（自签证书会导致 schannel 吊销检查失败），可在**本仓库**临时设置 `git config http.sslVerify false`。这只影响当前仓库，**不要写进全局配置，也不要把任何证书/凭据设置提交进仓库**。
- 我默认不自动 `git commit`；需要时明确说「提交并推送」。

## 3. 打 tag 触发 Release

```sh
git tag -a v0.1.1 -m "dsh-entry-organizer v0.1.1"
git push origin v0.1.1
```

`.github/workflows/release.yml` 会先校验 **tag 与 `package.json` 版本一致**、跑 `npm run check` 与 `npm test`，然后 `npm pack` 并用 `gh release create` 创建 GitHub Release。任何一步失败都不会产出资产。

完成后确认资产 URL —— 它已写进 awesome 条目：

<https://github.com/xishuai-zero/dsh-entry-organizer/releases/download/v0.1.1/dsh-entry-organizer-0.1.1.tgz>

## 4. 发布 npm

> **发布顺序**：README 与 awesome 条目的安装命令分别依赖 npm 包和 GitHub Release 资产，建议一次做完：`push main` → 打 tag（Release 产出 tarball）→ `npm publish`。全部完成后再确认 README 的「已发布」一行与 awesome 的 tarball 链接都能打开；若 npm 发布失败，README 的那一行必须改回「发布中」。

```sh
npm login --registry=https://registry.npmjs.org/
npm publish --registry=https://registry.npmjs.org/
npm view dsh-entry-organizer version --registry=https://registry.npmjs.org/
```

注意：

- npm 要求发布时账号启用 **2FA**，或使用勾选「Bypass 2FA」的 **Granular Access Token**。令牌只用于发布，用完立即在 npm 网页 `Access Tokens` 里删除；**不要写进仓库、README 或任何长期文件**。
- 若本机安全密钥（WebAuthn）弹窗不可用（例如只提供手机扫码），可在网页临时生成 bypass 令牌，配一个**临时** `--userconfig` 文件发布，随后删除该文件。
- 新包首次发布可能先出现占位版本 `0.0.0-stage`（暂存发布机制），正式版本通常 1 分钟内可用；占位版本可用 `npm deprecate` 标记忽略。
- 刚发布时元数据/tarball 可能短暂 404（CDN 传播），稍等重试。
- 回滚以 npm 政策为准：72 小时内可 `npm unpublish <pkg>@<version>`。

## 5. 安装验收（推送后 / 发布后）

```sh
# 从 GitHub 源（不等 npm 也能验）
dsh plugin --profile web add github:xishuai-zero/dsh-entry-organizer#v0.1.1

# 从 npm
dsh plugin --profile web add dsh-entry-organizer
```

> `web` 是市场通用 profile 名；本机桌面版的 profile 是 `desktop`，按实际替换 `--profile`。

重启/刷新后验收：

1. 左侧栏出现可拖拽行；拖动行能改顺序；把行拖到顶部标签区生成标签并可用；标签拖回侧栏恢复。
2. 「设置 → 入口编排」出现面板，能用 ↑/↓ 调整侧栏顺序与标签顺序（键盘/触屏等效路径）。
3. 刷新后顺序保留；开两个窗口改顺序，另一个窗口会实时同步。
4. 侧栏只出现一个「拖到这里，搬回侧栏」占位框，且位置紧挨在面板条目区之后、工作区之前。

## 6. 投稿 awesome-dsh-plugin

前置（已满足）：`package.json` 声明 `dsh.bundle`、根目录有 `cordis.patch.yml`、仓库有真实代码；还需要：仓库满 24h、已加 `dsh-plugin` topic、npm 或 Release tarball 可用。

1. Fork <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>。
2. 在新分支添加**一个**文件：`data/plugins/xishuai-zero__dsh-entry-organizer.yml`，内容直接用本仓库 `docs/submission/xishuai-zero__dsh-entry-organizer.yml`（文件名必须是 `<owner>__<repo>.yml`）。
3. 不要手工编辑两个 README —— 它们由脚本根据 `data/plugins/*.yml` 生成。
4. 提交 PR：标题 `Add xishuai-zero/dsh-entry-organizer`；正文写清功能、安装命令、npm 与 Release 链接。一个 PR 只加 1 条。
5. 等 `pr-gate` / `check-submission` CI 与维护者 review。若被要求改描述，**只改自己那一条**再推。
6. 合并后网站自动重建，条目出现在 <https://awesome-dsh-plugin.com>。

## 7. 以后发版清单

1. 改 `package.json` 的 `version`，补 `CHANGELOG.md`。
2. `npm run check && npm test && npm pack --dry-run`。
3. commit → `git tag -a vX.Y.Z` → push main 与 tag（Release 自动生成，工作流里已含版本一致性与测试门禁）。
4. `npm publish --registry=https://registry.npmjs.org/`。
5. 更新 awesome 条目的 `tarball` 为新的 tag URL（资产名带版本号，所以必须钉 tag；若改成不带版本的文件名，才可用 `releases/latest/download/`）。
6. 同步更新 README 里的版本号引用（安装示例的 tag 与 tarball 链接）。

## 发布记录

| 版本 | 日期 | npm | GitHub Release |
| --- | --- | --- | --- |
| 0.1.0 | 2026-10-30 | ✅ `dsh-entry-organizer@0.1.0` | ✅ `v0.1.0` |
| 0.1.1 | 2026-10-30 | ✅ `dsh-entry-organizer@0.1.1` | ✅ `v0.1.1` |

三条产物指纹一致（2026-10-30 核验）：本地 `npm pack`、npm registry tarball、GitHub Release 资产 sha256 均为 `c3aaaf9201ae67555e2867da3845b7ee71bd7f9dd9aa960ac674333565926561`（25,860 B）。

## 待补 / 已知缺口

- **截图**：README 目前没有插件功能截图（早期的侧栏图属于其它插件）。补图后放进 `docs/screenshots/`，在 README 引用；也可在 awesome 条目加可选 `screenshots` 字段。
- **icon**（可选）：GitHub 托管的 PNG 位图（禁 SVG），约 180×180；不写则回退作者头像。
- **账号核验**：`xishuai-zero` 已由 2026-10-30 的推送与 Release 间接验证（首次 push 时 GCM 认证成功）。
- **环境**：无 `gh` CLI、无 SSH key；推送用 HTTPS + GCM，符合上面的步骤。
- **awesome 投稿**：YAML 已备（`docs/submission/`），需等仓库创建满 24h（北京时间 2026-10-31 11:29 后）再开 PR。
- **npm 令牌**：本次发布用 30 天有效的 bypass-2FA Granular Token（2026-11-29 到期），发布完成后应在 npm → Access Tokens 及时删除。
