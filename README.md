# dsh-entry-organizer

**English** — A [DSH](https://github.com/deepseek-ai) (DeepSeek Harness) plugin: drag the plugin entries in the left sidebar into any order, drag the conversation view tabs at the top into any order, and move an entry between the two areas as a real tab. Order and moves are saved locally and survive restarts. Zero dependencies, no build step, MIT.

**中文** — DSH（DeepSeek Harness）插件「入口编排」：拖拽左侧栏的插件条目自由排序、拖拽会话顶部标签自由排序，并能把条目在侧栏与标签区之间搬移（搬过去就是真实标签）。顺序与搬移状态保存在本机，重启后保留。零依赖、无构建步骤、MIT。

> 名称消歧：「entry」在本生态里也指入场动画（如 `dsh-entry-transition`）或代理 payload（如 `dsh-entry-shaper`）。本插件的 entry 指**侧栏面板条目 / 会话视图**。

## 功能

- **侧栏条目拖拽排序**：按住左侧栏「全局面板」列表里的插件行拖动即可重排，顺序按 CSS `order` 生效，不改动官方 React 渲染结构。
- **顶部标签拖拽排序**：会话顶部「对话 / 阅读 / 轨迹 / …」标签可左右拖动重排；「对话」固定首位，不参与拖拽。
- **跨区搬移**：把侧栏行拖到顶部标签行，该行消失、顶部多出一个同名标签；点标签会用官方 `layout.selectPanel()` 打开对应面板，并出现左上角「← 返回对话」浮标。把标签拖回侧栏（或拖到侧栏空位）即还原成侧栏行，按落点决定插到上方还是下方。
- **溢出兜底**：标签行宽度放不下时，官方会把标签截断进右侧「…」菜单，那里没有可拖的 DOM 节点；插件在同一个「…」菜单里注册了「把搬入的标签全部移回侧栏」，保证任何情况下都能一键恢复。
- **键盘 / 触屏可达**：「设置 → 入口编排」把「侧栏顺序」「标签顺序」渲染成带 ↑/↓ 按钮的列表，不用拖拽也能逐项调整顺序（拖拽被截断、触屏或无鼠标时仍可操作）。
- **持久化**：顺序与搬移状态存 `localStorage` 键 `dsh.entry-organizer.v1`（v2 结构），全局一份，重启后恢复；多个窗口之间通过 `storage` 事件实时同步。
- **设置页**：「设置 → 入口编排」显示侧栏行数 / 可排序标签数 / 已搬入列表，可逐项「移回侧栏」或「恢复默认」。
- **中英双语**：跟随宿主语言；界面文案带在 `client.js` 的 `DICT` 里。

## 安装

插件通过 `dsh.bundle` manifest 声明自己可安装（浏览器半身由 `dsh.client` 声明，宿主半身由根目录 `cordis.patch.yml` 的一行 insert 挂载）。

```sh
# 1) 从 npm（推荐，预构建、免 allowBuilds 构建授权）
dsh plugin --profile web add dsh-entry-organizer

# 2) 从 GitHub 源码（按 tag 固定版本）
dsh plugin --profile web add github:xishuai-zero/dsh-entry-organizer#v0.1.1

# 3) 从 GitHub Release 的预构建 tarball
dsh plugin --profile web add https://github.com/xishuai-zero/dsh-entry-organizer/releases/download/v0.1.1/dsh-entry-organizer-0.1.1.tgz
```

已发布：npm [`dsh-entry-organizer`](https://www.npmjs.com/package/dsh-entry-organizer) · GitHub Releases [`v0.1.1`](https://github.com/xishuai-zero/dsh-entry-organizer/releases/tag/v0.1.1)。

> `web` 是市场里通用的 profile 名；桌面版等安装的 profile 名可能不同（本机桌面版为 `desktop`）。不确定时用 `dsh plugin --help` 或官方文档确认，把 `--profile web` 换成你的 profile 即可。

安装后重启 DSH（或等宿主热加载）。验证：左侧栏出现可拖拽行、设置页出现「入口编排」。卸载请用插件管理界面或参考官方文档从 profile 中移除该包。

**从旧名升级**：v0.1.0 之前的包名是 `dsh-entry-arrange`。升级到本包后，首次加载会读取旧键 `dsh.entry-arrange.v1` 并迁移到新键 `dsh.entry-organizer.v1`，已有的顺序与搬移不会丢；旧键保留不删。

**升级到 0.1.1**：存储结构从 v1 升级到 v2（排序键由「显示文案」改为稳定的 panel/view id），首次加载自动迁移并回写，不需要手动清 `localStorage`；旧结构里的顺序会被完整保留。

## 已知限制

都是宿主官方契约边界，不是实现偷懒：

1. **「…」菜单里的条目不能拖**：官方标签行把 `conversation.view` 条目按 `priority`/`order` 排序，再按可用宽度切出前 N 个（`visibleViewLimit = max(1, floor((width - 48) / 120))`）；被截断的 View 根本不生成标签 DOM，第三方拿不到节点。因此只能提供菜单内的一键还原，不能提供“从菜单里拖出来”。
2. **标签重排只对可见标签生效，且可见集合是按 `order` 排序后切前 N 个**：把 `order` 调小只能让条目更容易进入可见集，本插件不修改官方条目的排序，只调整自己启动器的 `order`。
3. **不重建别人的面板组件**：跨区只做“启动器”——标签点击走官方 `layout.selectPanel()` 打开真正的 `main` 面板。直接手写渲染别的插件的面板 Component 会丢掉它们自己的 `inject` props（渲染器把注入封装在条目内部），所以不做。
4. **不接管官方 pin**：侧栏行显隐仍由官方「更多 → 固定/取消」决定；本插件只负责顺序与搬移，两者互不覆盖。
5. **插件管理行可被拖动**：没有硬编码排除 `id === "plugins"` 的行；若希望锁死它，可后续加开关（未在本版提供）。
6. **状态只在本机**：顺序与搬移存浏览器 `localStorage`，不随账号同步、不跨设备；换浏览器或清站点数据会回到默认顺序。
7. **依赖宿主真实 DOM 契约**：见下方「宿主 DOM 契约」一节；宿主大改侧栏/标签结构时需要同步适配（代码里已为多数选择器准备了兜底）。
8. **切换界面语言后，已搬入标签的文案要等重新登记才更新**：排序与搬移按 panel id 存，不会丢；但启动器文案是搬移当时冻结的字符串，切语言后需要重新搬一次才换成新语言。

## 宿主 DOM 契约

本插件不移动、不重建官方节点，只按下面这些可观察标记工作；宿主改版导致某条失效时，插件会安静跳过对应部分（记录到设置页诊断），而不是抛错：

| 用途 | 依赖的标记 | 兜底 |
| --- | --- | --- |
| 找到侧栏面板行 | `[data-slot="sidebar.panellist"]` 的 `closest('button')` | 扫 `nav` 直系、有 `aria-label` 且无 `aria-haspopup` 的按钮 |
| 行身份 / 文案 | 行的 `aria-label`，没有时用 `textContent` | 空标签行整行跳过（不会让后续行错位） |
| 「更多」排序 | 侧栏 `nav` 直系子节点里的 `button[aria-haspopup]`，或包着它的容器 | 找不到就不改它的 order |
| 排序生效 | 侧栏 `nav` 与标签容器的 flex `order` | 只写 `style.order` |
| 标签行 | `[data-conversation-tabs]` 里的 `button[role="tab"]`，文案取 `textContent` | 找不到标签行时只做侧栏部分 |
| 当前打开的面板 | 行上的 `aria-current="page"` | 视为停在对话视图 |
| 浮标位置 | `[data-slot="sidebar"]` 的盒宽（该 outlet 为 `display:contents`，实测宽度 0），其次 `grid-template-columns` 首列 | 固定 16px |

## 兼容性

| 项 | 值 |
| --- | --- |
| 宿主 DSH | `>=0.2.1-rc.5`（`engines.dsh`；所有契约均在 0.2.1-rc.5 上实测） |
| Node.js | `>=22.19.0`（`engines.node`） |
| 运行依赖 | 无（`dependencies` 为空；React 由宿主 shell 注入） |
| 宿主声明 | `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.platform: web` |

`engines.dsh` 是市场与安装器读取的兼容性声明：不满足时安装器会给出不兼容提示，而不是装完才炸。

## 开发与测试

```sh
npm run check        # node --check index.js && node --check client.js
npm test             # node --test：10 个纯函数/存储用例 + 28 个 mini-DOM 集成与组件用例
node test/arrange.test.mjs   # 若环境禁止子进程（spawn EPERM）时直接执行测试文件
node test/dom.test.mjs
```

没有引入 jsdom：`test/harness.mjs` 自带最小 DOM（选择器、事件捕获/冒泡、`getBoundingClientRect`、内存 localStorage、MutationObserver 空实现、可派发的 `window` 事件），用 `vm` 真正执行 `client.js`，并提供 `renderTree()` 递归展开函数组件，用来测试设置页与浮标渲染。

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

- 排序只写行/标签的 `style.order`（侧栏 `nav` 与标签容器都是 flex），**不移动、不重建官方节点**；空标签行逐行跳过，避免下标错配。
- 身份用稳定 id：侧栏排序键 `p:<panel id>`、标签键 `v:<view id>`；拿不到 id 时（宿主还没注册该条目）退回 `~<label>`，之后自动升级。存储结构 v2 = `{ v: 2, sidebarOrder: [...], moved: [{ id, label }], tabOrder: [...] }`，v1 数据自动迁移。
- 搬移时通过 `ctx.slots.register({ name: 'conversation.view', id: 'ea-<hash>', label, locale }, Launcher)` 动态注册一个真实 View（注销即卸载），启动器组件只做“回对话 + 打开面板”；每次同步都会清理注册表里已消失的搬移项。
- 顺序变化在同步阶段立即写 `localStorage`；`storage` 事件让其他窗口实时重载。
- `MutationObserver` 只对影响侧栏/标签行的变更触发同步，拖拽标记精确清理（不再每个 `dragover` 全文档扫描）。
- 浮标注册在 `shell.overlay`（list slot），仅当“被搬走的面板当前可见”时显示；首次若发现热加载残留的旧占位框会接管并去重。

## 数据与隐私

不联网、不收集数据、不读文件。只写浏览器 `localStorage` 的 `dsh.entry-organizer.v1` 一个键（JSON：`{ v: 2, sidebarOrder, moved: [{ id, label }], tabOrder }`，排序键形如 `p:<panel id>` / `v:<view id>`）；迁移时只读旧键 `dsh.entry-arrange.v1`，不删除。

## License

MIT © 2026 xishuai-zero
