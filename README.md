# dsh-entry-organizer

**English** — A [DSH](https://github.com/deepseek-ai) (DeepSeek Harness) plugin: drag the plugin entries in the left sidebar into any order, drag the conversation view tabs at the top into any order, and move an entry between the two areas as a real tab. Order and moves are saved locally and survive restarts. Zero dependencies, no build step, MIT.

**中文** — DSH（DeepSeek Harness）插件「入口编排」：拖拽左侧栏的插件条目自由排序、拖拽会话顶部标签自由排序，并能把条目在侧栏与标签区之间搬移（搬过去就是真实标签）。顺序与搬移状态保存在本机，重启后保留。零依赖、无构建步骤、MIT。

> 名称消歧：「entry」在本生态里也指入场动画（如 `dsh-entry-transition`）或代理 payload（如 `dsh-entry-shaper`）。本插件的 entry 指**侧栏面板条目 / 会话视图**。

## 功能

- **侧栏条目拖拽排序**：按住左侧栏「全局面板」列表里的插件行拖动即可重排，顺序按 CSS `order` 生效，不改动官方 React 渲染结构。
- **顶部标签拖拽排序**：会话顶部「对话 / 阅读 / 轨迹 / …」标签可左右拖动重排；「对话」固定首位，不参与拖拽。
- **跨区搬移**：把侧栏行拖到顶部标签行，该行消失、顶部多出一个同名标签；点标签会用官方 `layout.selectPanel()` 打开对应面板，并出现左上角「← 返回对话」浮标。把标签拖回侧栏（或拖到侧栏空位）即还原成侧栏行，按落点决定插到上方还是下方。
- **溢出兜底**：标签行宽度放不下时，官方会把标签截断进右侧「…」菜单，那里没有可拖的 DOM 节点；插件在同一个「…」菜单里注册了「把搬入的标签全部移回侧栏」，保证任何情况下都能一键恢复。
- **持久化**：顺序与搬移状态存 `localStorage` 键 `dsh.entry-organizer.v1`，全局一份，重启后恢复。
- **设置页**：「设置 → 入口编排」显示侧栏行数 / 标签数 / 已搬入列表，可逐项「移回侧栏」或「恢复默认」。
- **中英双语**：跟随宿主语言；界面文案带在 `client.js` 的 `DICT` 里。

## 安装

插件通过 `dsh.bundle` manifest 声明自己可安装（浏览器半身由 `dsh.client` 声明，宿主半身由根目录 `cordis.patch.yml` 的一行 insert 挂载）。

```sh
# 1) 从 npm（推荐，预构建、免 allowBuilds 构建授权）
dsh plugin --profile web add dsh-entry-organizer

# 2) 从 GitHub 源码（按 tag 固定版本）
dsh plugin --profile web add github:xishuai-zero/dsh-entry-organizer#v0.1.0

# 3) 从 GitHub Release 的预构建 tarball
dsh plugin --profile web add https://github.com/xishuai-zero/dsh-entry-organizer/releases/download/v0.1.0/dsh-entry-organizer-0.1.0.tgz
```

已发布：npm [`dsh-entry-organizer`](https://www.npmjs.com/package/dsh-entry-organizer) · GitHub Releases [`v0.1.0`](https://github.com/xishuai-zero/dsh-entry-organizer/releases/tag/v0.1.0)。

> `web` 是市场里通用的 profile 名；桌面版等安装的 profile 名可能不同（本机桌面版为 `desktop`）。不确定时用 `dsh plugin --help` 或官方文档确认，把 `--profile web` 换成你的 profile 即可。

安装后重启 DSH（或等宿主热加载）。验证：左侧栏出现可拖拽行、设置页出现「入口编排」。卸载请用插件管理界面或参考官方文档从 profile 中移除该包。

**从旧名升级**：v0.1.0 之前的包名是 `dsh-entry-arrange`。升级到本包后，首次加载会读取旧键 `dsh.entry-arrange.v1` 并迁移到新键 `dsh.entry-organizer.v1`，已有的顺序与搬移不会丢；旧键保留不删。

## 已知限制

都是宿主官方契约边界，不是实现偷懒：

1. **「…」菜单里的条目不能拖**：官方标签行按“注册顺序取前 N 个”渲染（`visibleViewLimit = max(1, floor((width - 48) / 120))`），被截断的 View 根本不生成标签 DOM，第三方既拿不到节点也无法提权。因此只能提供菜单内的一键还原，不能提供“从菜单里拖出来”。
2. **标签重排只对可见标签生效**：同上，溢出标签的顺序由官方按估算宽度分组，插件无法改它的可见性。
3. **不重建别人的面板组件**：跨区只做“启动器”——标签点击走官方 `layout.selectPanel()` 打开真正的 `main` 面板。直接手写渲染别的插件的面板 Component 会丢掉它们自己的 `inject` props（渲染器把注入封装在条目内部），所以不做。
4. **不接管官方 pin**：侧栏行显隐仍由官方「更多 → 固定/取消」决定；本插件只负责顺序与搬移，两者互不覆盖。
5. **插件管理行可被拖动**：没有硬编码排除 `id === "plugins"` 的行；若希望锁死它，可后续加开关（v0.1.1 计划，不在本版）。
6. **状态只在本机**：顺序与搬移存浏览器 `localStorage`，不随账号同步、不跨设备；换浏览器或清站点数据会回到默认顺序。

## 兼容性

| 项 | 值 |
| --- | --- |
| 宿主 DSH | `>=0.2.1-rc.1`（`engines.dsh`；在 0.2.1-rc.5 上实测） |
| Node.js | `>=22.19.0`（`engines.node`） |
| 运行依赖 | 无（`dependencies` 为空；React 由宿主 shell 注入） |
| 宿主声明 | `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.platform: web` |

`engines.dsh` 是市场与安装器读取的兼容性声明：不满足时安装器会给出不兼容提示，而不是装完才炸。

## 开发与测试

```sh
npm run check        # node --check index.js && node --check client.js
npm test             # node --test：9 个纯函数用例 + 10 个 mini-DOM 集成用例
node test/arrange.test.mjs   # 若环境禁止子进程（spawn EPERM）时直接执行测试文件
node test/dom.test.mjs
```

没有引入 jsdom：`test/harness.mjs` 自带最小 DOM（选择器、事件捕获/冒泡、`getBoundingClientRect`、内存 localStorage、MutationObserver 空实现），并用 `vm` 真正执行 `client.js`。

## 结构

| 文件 | 作用 |
| --- | --- |
| `client.js` | 浏览器半身：DOM 同步、拖拽、启动器注册、浮标、设置页 |
| `index.js` | 宿主半身（空壳，只声明 name / apply；本插件无服务端状态） |
| `cordis.patch.yml` | 一行 insert，把包挂进 profile 组合 |
| `package.json` | `dsh.bundle.patch` + `dsh.client` 声明、`engines.dsh` 兼容范围 |
| `test/harness.mjs` | mini-DOM + 假 ctx + `__ModuleLoader__` 装载器 |
| `test/arrange.test.mjs` | 纯函数回归（含旧键迁移） |
| `test/dom.test.mjs` | 集成回归（横向拖拽、跨区搬移、「…」菜单还原） |
| `docs/submission/` | 投稿 awesome-dsh-plugin 的条目 YAML |
| `docs/PUBLISHING.md` | 维护者发布流程（GitHub / npm / awesome） |

## 实现要点

- 排序只写行/标签的 `style.order`（侧栏 `nav` 与标签容器都是 flex），**不移动、不重建官方节点**。
- 侧栏行以 `aria-label` 对齐官方解析后的 label；标签以 `textContent` 对齐，首个别名为「对话」的标签固定 `order: 0`。
- 搬移时通过 `ctx.slots.register({ name: 'conversation.view', id: 'ea-<hash>', label, locale }, Launcher)` 动态注册一个真实 View（注销即卸载），启动器组件只做“切回对话 + 打开面板”。
- 浮标注册在 `shell.overlay`（list slot），仅当“被搬走的面板当前可见”时显示；位置跟随侧栏宽度（读 `grid-template-columns` 第一列）。

## 数据与隐私

不联网、不收集数据、不读文件。只写浏览器 `localStorage` 的 `dsh.entry-organizer.v1` 一个键（JSON：`{ v, sidebarOrder, moved, tabOrder }`）；迁移时只读旧键 `dsh.entry-arrange.v1`，不删除。

## License

MIT © 2026 xishuai-zero
