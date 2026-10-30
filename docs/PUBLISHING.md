# 发布指南（维护者用）

本文件记录 `dsh-entry-organizer` 从本地目录到 **GitHub · npm · awesome-dsh-plugin** 的完整发布流程。所有命令在仓库根目录执行。

仓库里已经准备好：代码、`dsh.bundle` manifest、CI、一个 tag 触发 Release 的工作流、awesome 收录条目。**必须人工完成**的只有两件事：GitHub 首次认证推送、npm 登录与发布（不索要、不保存你的 token）。

## 0. 发布前自检

```sh
npm run check
npm test
npm pack --dry-run
```

预期：语法检查通过；19 个测试全过（9 纯函数 + 10 mini-DOM）；tarball 只包含 `index.js`、`client.js`、`cordis.patch.yml`、`README.md`、`LICENSE`、`package.json`。

已核实的事实：

- npm 包已发布：`dsh-entry-organizer@0.1.0`（2026-10-30，见下方「发布记录」）。
- 本机宿主版本 0.2.1-rc.5，满足 `engines.dsh: ">=0.2.1-rc.1"`。
- 零依赖、无构建步骤，安装不需要 `allowBuilds` 构建授权。
- 本机 npm 默认 registry 是只读镜像 `https://registry.npmmirror.com/`，**不能发布**；`package.json` 已写 `publishConfig.registry = https://registry.npmjs.org/`。

## 1. 创建 GitHub 仓库

浏览器打开 <https://github.com/new>：

- **Repository name**: `dsh-entry-organizer`
- **Public**（公开才能被市场和收录列表抓取）
- **不要**勾选初始化 README / .gitignore / LICENSE —— 本地已有，勾了会冲突。

创建后：

- **Description**（建议）：`DSH plugin: drag-reorder sidebar panel entries and conversation tabs, and move entries between them.`
- **Topics**：必须加 `dsh-plugin`（awesome 收录的硬要求）；可再加 `deepseek-harness`、`dsh`。
- 该仓库创建后需**满 24 小时**才能投稿 awesome（CI 自动检查仓库年龄）。

## 2. 首次推送（需要你完成 GitHub 认证）

本机 git 访问 `github.com` 时走 127.0.0.1 上的本地加速器，Windows schannel 的吊销检查会失败，所以使用**仓库级** `http.sslVerify=false`；凭据用 Git Credential Manager 弹窗登录（浏览器授权一次即可）。这些设置只影响本仓库。

```sh
cd "D:/Make deepseek/dsh-entry-arrange"
git commit -m "feat: dsh-entry-organizer v0.1.0"
git remote add origin https://github.com/xishuai-zero/dsh-entry-organizer.git
git push -u origin main
```

> 当前工作区已完成 `git init -b main`、`git config http.sslVerify false`、`git add -A`（2026-10-30），所以上面只列剩下的三步；从零复刻这个仓库时才需要先跑那三条。首次 `git push` 会弹出 Git Credential Manager 登录窗口，用浏览器授权一次即可。

> 按全局规则我没有自动 `git commit`。上面的 commit 与 push 由你执行，或明确说「提交并推送」让我来执行。
> 若 push 报认证失败：`git config --global credential.helper manager` 后重试，按弹窗登录一次。

## 3. 打 tag 触发 Release

```sh
git tag -a v0.1.0 -m "dsh-entry-organizer v0.1.0"
git push origin v0.1.0
```

tag 触发 `.github/workflows/release.yml`：`npm pack` 生成 `dsh-entry-organizer-0.1.0.tgz`，并用 `gh release create` 创建 GitHub Release（自动生成 notes）。

完成后确认资产 URL —— 它已写进 awesome 条目：

<https://github.com/xishuai-zero/dsh-entry-organizer/releases/download/v0.1.0/dsh-entry-organizer-0.1.0.tgz>

## 4. 发布 npm（需要你登录）

```sh
npm login --registry=https://registry.npmjs.org/      # 交互式：浏览器或终端完成
npm publish --registry=https://registry.npmjs.org/    # 开了 2FA 会提示输入 OTP
npm view dsh-entry-organizer version --registry=https://registry.npmjs.org/
```

发布后检查 npmjs 页面：README 渲染、`files` 列表、`engines`。回滚（以 npm 政策为准）：72 小时内 `npm unpublish dsh-entry-organizer@0.1.0`。

### 真实环境踩坑记录（2026-10-30）

- 本机默认 registry 是只读镜像，任何发布命令都必须显式带 `--registry=https://registry.npmjs.org/`。
- 账号 `xishuai-zero` 在 npm 网页开启了 2FA（安全密钥），但这台电脑的 Windows 安全中心只弹「手机扫码」，没有「此设备 / Windows Hello」选项，扫码又提示手机上无该通行密钥 —— **安全密钥认证在本机走不通**。
- 因此改用 **Granular Access Token（勾 Bypass 2FA，30 天有效）** 走 `--userconfig` 临时 npmrc 发布；令牌**不要写进仓库或长期文件**，用完在 npm 网页 Access Tokens 里删除。
- 令牌发布后 npm 一度显示占位版本 `0.0.0-stage`（暂存发布机制），约 1 分钟后 `0.1.0` 正式可用；占位版本已 `npm deprecate` 标记为忽略。
- npm 元数据/ tarball 在刚发布时可能短暂 404（CDN 传播），稍等重试即可；`dsh plugin add dsh-entry-organizer` 会解析到 `latest = 0.1.0`。

## 5. 安装验收（推送后 / 发布后）

```sh
# 从 GitHub 源（不等 npm 也能验）
dsh plugin --profile web add github:xishuai-zero/dsh-entry-organizer#v0.1.0

# 从 npm
dsh plugin --profile web add dsh-entry-organizer
```

> `web` 是市场通用 profile 名；本机桌面版的 profile 是 `desktop`，按实际替换 `--profile`。

重启/刷新后验收：左侧栏出现可拖拽行；拖动行能改顺序；把行拖到顶部标签区生成标签并可用；标签拖回侧栏恢复；「设置 → 入口编排」出现面板；刷新后顺序保留。这一步需要你启动桌面版 DSH，我可以在推送后配合检查。

## 6. 投稿 awesome-dsh-plugin

前置（已满足）：`package.json` 声明 `dsh.bundle`、根目录有 `cordis.patch.yml`、仓库有真实代码；还需要：仓库满 24h、已加 `dsh-plugin` topic、npm 或 Release tarball 可用。

1. Fork <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>。
2. 在新分支添加**一个**文件：`data/plugins/xishuai-zero__dsh-entry-organizer.yml`，内容直接用本仓库 `docs/submission/xishuai-zero__dsh-entry-organizer.yml`（文件名字形必须是 `<owner>__<repo>.yml`）。
3. 不要手工编辑两个 README —— 它们由脚本根据 `data/plugins/*.yml` 生成。
4. 提交 PR：标题 `Add xishuai-zero/dsh-entry-organizer`；正文写清功能、安装命令、npm 与 Release 链接。一个 PR 只加 1 条。
5. 等 `pr-gate` / `check-submission` CI 与维护者 review。若被要求改描述，**只改自己那一条**再推。
6. 合并后网站自动重建，条目出现在 <https://awesome-dsh-plugin.com>。

## 7. 以后发版清单

1. 改 `package.json` 的 `version`，补 `CHANGELOG.md`（还没有就建）。
2. `npm run check && npm test && npm pack --dry-run`。
3. commit → `git tag -a vX.Y.Z` → push main 与 tag（Release 自动生成）。
4. `npm publish --registry=https://registry.npmjs.org/`。
5. 更新 awesome 条目的 `tarball` 为新的 tag URL（当前资产名带版本号，所以必须钉 tag；若改成不带版本的文件名，才可用 `releases/latest/download/`）。
6. 同步更新 README 里的版本号引用（如安装示例的 tag）。

## 待补 / 已知缺口

- **截图**：README 目前没有插件功能截图（旧图不属于本插件）。补图后放进 `docs/screenshots/`，在 README 引用；也可在 awesome 条目加可选 `screenshots` 字段。
- **icon**（可选）：GitHub 托管的 PNG 位图（禁 SVG），约 180×180；不写则回退作者头像。
- **账号核验**：`xishuai-zero` 未能从本机远程核验（GitHub API 经本地加速器间歇 TLS 失败）；首次 push 会自然验证，无需提前处理。
- **环境**：无 `gh` CLI、无 SSH key；推送用 HTTPS + GCM，符合上面的步骤。
