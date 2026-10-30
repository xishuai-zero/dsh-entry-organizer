/**
 * dsh-entry-organizer — browser half.
 *
 * 目标（来自用户简报）：
 *   1. 侧栏「工作区」以上、「新会话」以下那块插件条目区可以像文件夹一样自由拖拽排序；
 *   2. 顶部会话标签行也可以自由排序；
 *   3. 侧栏条目可以「搬」到顶部标签行，按标签样式渲染成一个真实标签，点它打开该面板；
 *      也可以从标签行「搬回」侧栏，恢复成原来的行样式。
 *
 * 实现边界（都是和官方契约对齐后的选择）：
 *   - 排序不重排 React 管理的 DOM 节点，只给条目写 CSS `order`：
 *     侧栏行容器 `.panelList` 与标签行容器 `.viewTabs` 都是 flex column/row，
 *     `order` 是纯视觉重排，官方状态（选中态 / pin 状态 / 溢出分组）一律不动。
 *   - 跨区不重建别人的组件（渲染器只允许在声明 slot 的条目里渲染子 slot），
 *     而是用 `ctx.slots.register({ name: 'conversation.view', ... })` 动态注册一个
 *     真实 View 标签；点该标签时组件挂载，先 `openView('chat')` 把视图状态切回对话，
 *     再用 `ctx.layout.selectPanel(id)` 打开面板 —— 和点侧栏行完全同一条官方链路。
 *   - 回程入口：被搬走的面板处于打开状态时，`shell.overlay` 里浮出一个「返回对话」按钮，
 *     点击走 `ctx.layout.selectPanel(null)`。
 *   - 状态（顺序 + 搬移集合）存 localStorage，重启后仍在；插件重载不会丢。
 *
 * 手写 ModuleLoader bundle：无构建步骤，除 shell 提供的 `react` 外无依赖。
 */
window.__ModuleLoader__.load({
  id: 'dsh-entry-organizer',
  factory: require => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React

    const NS = 'plugin.entryOrganizer'
    const STORAGE_KEY = 'dsh.entry-organizer.v1'
    // 存储版本 v2：排序键从「显示文案」换成「p:<panel id> / ~<label>」稳定 key。
    // 面板改名、语言切换都不会再丢位置；旧 v1 存档在拿到真实条目 id 后原地升级。
    const STORE_VERSION = 2
    // v0.1.0 之前的插件名是 dsh-entry-arrange：旧键只读一次，用于迁移本机已经保存的顺序。
    const LEGACY_STORAGE_KEY = 'dsh.entry-arrange.v1'
    const FALLBACK_ERROR_LIMIT = 240

    const DICT = {
      zh: {
        title: '入口编排',
        hint: '拖拽侧栏插件条目可以自由排序；把条目拖到顶部标签行会「搬」成一个标签，点它打开该面板，拖回侧栏即恢复为行。顺序与搬移状态保存在本机，重启后仍生效。',
        back: '返回对话',
        backHint: '当前打开的页面是从顶部标签打开的，点这里回到对话',
        reset: '恢复默认',
        resetHint: '清空所有顺序与搬移，回到官方默认排列',
        resetConfirm: '已恢复默认排列。',
        sidebarRows: '侧栏条目',
        tabLabels: '顶部标签',
        movedCount: '已搬到顶部',
        movedEmpty: '还没有搬移的条目。',
        moveBack: '移回侧栏',
        moveUp: '上移',
        moveDown: '下移',
        orderSection: '侧栏顺序（键盘 / 触屏等效操作）',
        tabSection: '顶部标签顺序',
        orderHint: '不想拖拽时用这里的 ↑ / ↓：每次调一格，和拖拽效果等价，键盘、触屏、读屏都能操作。',
        diagnostics: '诊断信息',
        errLabel: '最近一次错误',
        noError: '无',
        emptyNote: '侧栏里没有可拖拽的插件条目。',
        dropHere: '拖到这里，搬回侧栏',
        restoreAll: '把搬入的标签全部移回侧栏',
        overflowHint: '标签行放不下时，搬入的标签会被收进「...」菜单；用菜单里的「把搬入的标签全部移回侧栏」，或本页每一项的「移回侧栏」，都能恢复。',
      },
      en: {
        title: 'Entry organizer',
        hint: 'Drag sidebar plugin rows to reorder them freely; drag a row onto the conversation tab strip to move it there as a real tab. Click the tab to open its panel, drag it back to restore the row. Order and moves persist locally across restarts.',
        back: 'Back to chat',
        backHint: 'The open page was launched from a moved tab; click to return to the conversation',
        reset: 'Reset to default',
        resetHint: 'Forget every order and move, back to the official arrangement',
        resetConfirm: 'Default arrangement restored.',
        sidebarRows: 'Sidebar rows',
        tabLabels: 'Conversation tabs',
        movedCount: 'Moved to tabs',
        movedEmpty: 'Nothing has been moved yet.',
        moveBack: 'Move back',
        moveUp: 'Up',
        moveDown: 'Down',
        orderSection: 'Sidebar order (keyboard / touch equivalent)',
        tabSection: 'Tab order',
        orderHint: 'No dragging needed: use the ↑ / ↓ buttons to move one slot at a time — the same result as dragging, operable with keyboard, touch and screen readers.',
        diagnostics: 'Diagnostics',
        errLabel: 'Last error',
        noError: 'none',
        emptyNote: 'No draggable plugin rows in the sidebar.',
        dropHere: 'Drop here to move back',
        restoreAll: 'Move all moved tabs back',
        overflowHint: 'When the tab strip runs out of room, moved entries collapse into the "..." menu. Use "Move all moved tabs back" there, or the per-row buttons on this page, to restore them.',
      },
    }

    const CSS = `
.ea-draggable { cursor: grab; }
.ea-draggable:active { cursor: grabbing; }
.ea-dragging { opacity: 0.45; }
.ea-drop-before { box-shadow: inset 0 2px 0 var(--dsw-alias-state-business-primary); }
.ea-drop-after { box-shadow: inset 0 -2px 0 var(--dsw-alias-state-business-primary); }
/* 顶部标签是横向排列，插入提示必须画竖线，否则会被误读成上下插入。 */
.ea-tab-drop-before { box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary); }
.ea-tab-drop-after { box-shadow: inset -2px 0 0 var(--dsw-alias-state-business-primary); }
.ea-drop-strip { box-shadow: inset 0 -2px 0 var(--dsw-alias-state-business-primary); }
/* 「...」菜单里的逃生口：菜单自身不提供样式契约，这里只补最低限度的可读排版。 */
.ea-menu-row {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: var(--dsw-radius-md, 6px);
  background: 0 0;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  text-align: start;
  cursor: pointer;
}
.ea-menu-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14)); }
.ea-placeholder {
  display: none;
  box-sizing: border-box;
  min-height: 34px;
  margin-block: 2px;
  border: 1px dashed var(--dsw-alias-border-l3, var(--dsw-alias-border-l4));
  border-radius: var(--dsw-radius-md);
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  background: transparent;
  user-select: none;
}
.ea-placeholder[data-ea-show="1"] { display: flex; }
.ea-placeholder.ea-drop-strip { box-shadow: none; border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); }
.ea-chip {
  position: fixed;
  inset-block-start: 52px;
  inset-inline-start: 16px;
  z-index: 45;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-l2, var(--dsw-alias-bg-l1, transparent));
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}
.ea-chip:hover { border-color: var(--dsw-alias-state-business-primary); }
.ea-page { display: flex; flex-direction: column; gap: 12px; padding: 2px 0 24px; color: var(--dsw-alias-label-primary); }
.ea-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.ea-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.ea-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.ea-stat { flex: 1 1 120px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; }
.ea-stat-label { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.ea-stat-value { font-size: 16px; line-height: 22px; font-weight: 600; }
.ea-subtitle { margin: 4px 0 0; font-size: 13px; line-height: 20px; font-weight: 600; }
.ea-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ea-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; font-size: 13px; line-height: 18px; }
.ea-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ea-item button, .ea-actions button {
  flex: none;
  font-size: 12px;
  line-height: 16px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l4);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.ea-item button:hover, .ea-actions button:hover { border-color: var(--dsw-alias-state-business-primary); }
.ea-actions { display: flex; gap: 8px; align-items: center; }
.ea-empty { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.ea-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); word-break: break-all; }
.ea-subtitle { margin: 16px 0 6px; font-size: 13px; font-weight: 600; }
.ea-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ea-actions button:disabled { opacity: 0.45; cursor: default; }
.ea-actions button + button { margin-inline-start: 6px; }
`

    // ── pure helpers（tests 走 exports.__internals 直接调用）───────────────────

    /** 保留 stored 中仍然存在的项（相对顺序不变），再把新出现的项按 present 顺序追加。 */
    function arrangeList(stored, present) {
      const seen = new Set()
      const kept = []
      for (const item of stored) {
        if (!present.includes(item) || seen.has(item)) continue
        seen.add(item)
        kept.push(item)
      }
      for (const item of present) {
        if (seen.has(item)) continue
        seen.add(item)
        kept.push(item)
      }
      return kept
    }

    /** 把 item 从 list 里取出，插到 target 前/后；target 不存在或等于 item 时按「保持原位」处理。 */
    function moveRelative(list, item, target, after) {
      if (item === target) return list.slice()
      const rest = list.filter(entry => entry !== item)
      if (!rest.includes(target)) {
        // 目标不在列表里：本来就在的项保持原位，新项追加到末尾
        return list.includes(item) ? list.slice() : rest.concat([item])
      }
      const at = rest.indexOf(target) + (after ? 1 : 0)
      rest.splice(at, 0, item)
      return rest
    }

    /** 由 label 得到稳定的 view id（FNV-1a base36），同一 label 重启后仍得到同一 id。 */
    function viewIdFor(label) {
      let hash = 0x811c9dc5
      for (let index = 0; index < label.length; index++) {
        hash ^= label.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193) >>> 0
      }
      return 'ea-' + hash.toString(36)
    }

    /** slot 的 label 可能是字符串，也可能是取当前 locale 文案的函数（如 dsh-context）。 */
    function labelText(label) {
      if (typeof label === 'string') return label
      if (typeof label === 'function') {
        try {
          const value = label()
          return typeof value === 'string' ? value : null
        } catch {
          return null
        }
      }
      return null
    }

    // ── persistence ──────────────────────────────────────────────────────────

    function emptyState() {
      return { sidebarOrder: [], moved: [], tabOrder: [] }
    }

    function sanitizeList(value) {
      return Array.isArray(value) ? value.filter(entry => typeof entry === 'string' && entry !== '') : []
    }

    /**
     * 排序键：拿到条目 id 时用 `p:<id>` / `v:<id>`；拿不到 id（v1 遗留、条目尚未注册）时用
     * `~<label>` 兜底。id 才是稳定身份——显示文案会随语言、插件重命名而变。
     */
    function keyFromId(kind, id) {
      return typeof id === 'string' && id !== '' ? kind + ':' + id : null
    }

    function legacyLabelKey(label) {
      return '~' + label
    }

    function isStableKey(entry) {
      return entry.startsWith('p:') || entry.startsWith('v:') || entry.startsWith('~')
    }

    /** 搬移项的统一 key：优先 panel id，其次显示文案。 */
    function movedKey(entry) {
      if (!entry || typeof entry !== 'object') return ''
      return keyFromId('p', entry.id) ?? legacyLabelKey(typeof entry.label === 'string' ? entry.label : '')
    }

    function normalizeMoved(value) {
      const out = []
      const seen = new Set()
      for (const raw of Array.isArray(value) ? value : []) {
        if (!raw || typeof raw !== 'object') continue
        const label = typeof raw.label === 'string' ? raw.label : ''
        const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : null
        if (id === null && label === '') continue
        const key = movedKey({ id, label })
        if (key === '' || seen.has(key)) continue
        seen.add(key)
        out.push({ id, label })
      }
      return out
    }

    function loadState() {
      const state = emptyState()
      let migrated = false
      try {
        let raw = window.localStorage?.getItem(STORAGE_KEY)
        if (typeof raw !== 'string' || raw === '') {
          const legacyRaw = window.localStorage?.getItem(LEGACY_STORAGE_KEY)
          if (typeof legacyRaw !== 'string' || legacyRaw === '') return state
          raw = legacyRaw
          migrated = true
        }
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return state
        // v1 的 sidebarOrder / tabOrder 里存的是显示文案：先包成 `~label`，等条目注册后再升级。
        const normalizeOrder = value => sanitizeList(value).map(entry => (isStableKey(entry) ? entry : legacyLabelKey(entry)))
        state.sidebarOrder = normalizeOrder(parsed.sidebarOrder)
        state.tabOrder = normalizeOrder(parsed.tabOrder)
        state.moved = normalizeMoved(parsed.moved)
        if (migrated || parsed.v !== STORE_VERSION) {
          migrated = true
          saveState(state)
        }
        return state
      } catch {
        return emptyState()
      }
    }

    function saveState(state) {
      try {
        window.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
          v: STORE_VERSION,
          sidebarOrder: state.sidebarOrder,
          moved: state.moved.map(entry => ({ id: entry.id ?? null, label: entry.label ?? '' })),
          tabOrder: state.tabOrder,
        }))
      } catch {
        // 存储不可用时静默降级为「仅本次会话有效」，由诊断信息暴露
      }
    }

    // ── controller ───────────────────────────────────────────────────────────

    function createController() {
      const state = loadState()
      const listeners = new Set()
      let ctx = null
      let viewSlotReady = false
      let dragging = null
      let scheduled = false
      let observer = null
      let placeholder = null
      let lastError = null
      let chip = false
      let mounted = false
      const launchers = new Map()
      // 挂载后的宽限期：这期间面板插件可能还没 apply 完，registry 不完整，
      // 不能据此判定搬移项是幽灵（回归：重启后搬移标签消失）。
      let mountedAt = 0
      let pruneGraceMs = 2500

      const t = key => {
        const bag = ctx?.locale?.bind ? ctx.locale.bind(NS) : null
        try {
          return bag ? bag(key) : (DICT.zh[key] ?? key)
        } catch {
          return DICT.zh[key] ?? key
        }
      }

      function publish() {
        for (const listener of [...listeners]) {
          try { listener() } catch { /* 单个订阅者异常不影响其它渲染 */ }
        }
      }

      function subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }

      function recordError(error) {
        const text = String(error?.message ?? error)
        lastError = text.length > FALLBACK_ERROR_LIMIT ? text.slice(0, FALLBACK_ERROR_LIMIT) + '…' : text
        try { console.warn('[dsh-entry-organizer]', error) } catch { /* 忽略 */ }
      }

      // ── 身份：优先 panel id，文案只用于和 DOM 对账 ─────────────────────────

      function panelKeyFor(label) {
        const id = panelEntries().find(entry => entry.label === label)?.id ?? null
        return keyFromId('p', id) ?? legacyLabelKey(label)
      }

      function viewKeyFor(label) {
        const entry = viewEntries().find(item => item.label === label)
        // 已搬进标签行的侧栏条目由插件自己注册启动器（id 是确定性的 viewIdFor(label)），
        // 注册时点可能还没落到 entriesOfSlot 里，这里直接按同一算法算键，避免键先退化成 `~label`。
        const id = entry?.id ?? (isMoved(label) ? viewIdFor(label) : null)
        return keyFromId('v', id) ?? legacyLabelKey(label)
      }

      function isMoved(label) {
        return movedEntry(label) !== null
      }

      function isMovedKey(key) {
        return state.moved.some(entry => movedKey(entry) === key)
      }

      function movedEntry(label) {
        const key = panelKeyFor(label)
        const exact = state.moved.find(entry => movedKey(entry) === key)
        if (exact) return exact
        // v1 遗留：存档只有文案、没有 id，等 upgraded 之后走上面的 exact 分支
        if (key.startsWith('~')) return null
        return state.moved.find(entry => entry.label === label) ?? null
      }

      function save() {
        saveState(state)
        // 设置页按 DOM 里的 style.order 展示顺序：必须先把状态写回 DOM，再通知订阅者，
        // 否则第一次点 ↑/↓ 时列表拿到的还是上一轮顺序（回归：第一次点不动、第二次才对）。
        reconcile()
        publish()
      }

      // v1 存档里排序键是显示文案；拿到真实条目 id 后一次性升级成稳定 key（面板改名不丢位置）。
      function upgradeKeys() {
        let changed = false
        const upgrade = (list, toKey) => list.map(entry => {
          if (!entry.startsWith('~')) return entry
          const next = toKey(entry.slice(1))
          if (next !== entry) changed = true
          return next
        })
        state.sidebarOrder = upgrade(state.sidebarOrder, panelKeyFor)
        state.tabOrder = upgrade(state.tabOrder, viewKeyFor)
        if (changed) saveState(state)
      }

      // 注册表里已经没有的搬移项会留下点不开的「幽灵标签」，但启动时本插件可能先于
      // 搬移项所属的面板插件 apply（registry 里暂时没有它）：直接按当前 registry 判幽灵
      // 会把用户的合法搬移永久删掉。因此只清理「本会话见过、随后又消失」的 id，
      // 从未见过的先保留等它注册；v1 无 id 的遗留项改为按文案唯一命中回填 id。
      function pruneMoved() {
        const panels = panelEntries()
        if (panels.length === 0) return
        const byLabel = new Map()
        for (const entry of panels) {
          if (typeof entry.id !== 'string' || entry.id === '') continue
          const list = byLabel.get(entry.label) ?? []
          list.push(entry.id)
          byLabel.set(entry.label, list)
        }
        let changed = false
        for (const entry of state.moved) {
          if (entry.id !== null) continue
          const matches = byLabel.get(entry.label) ?? []
          if (matches.length === 1) {
            entry.id = matches[0]
            changed = true
          }
        }
        if (Date.now() - mountedAt >= pruneGraceMs) {
          const ids = new Set(panels.map(entry => entry.id).filter(id => typeof id === 'string' && id !== ''))
          const labels = new Set(panels.map(entry => entry.label).filter(label => typeof label === 'string' && label !== ''))
          const kept = state.moved.filter(entry => {
            // 没有 id 的 v1 遗留项无法可靠判断，保留（等后续回填）
            if (entry.id === null) return true
            return ids.has(entry.id) || labels.has(entry.label)
          })
          if (kept.length !== state.moved.length) {
            state.moved = kept
            changed = true
            for (const label of [...launchers.keys()]) {
              if (!isMoved(label)) disposeLauncher(label)
            }
          }
        }
        if (changed) {
          saveState(state)
          publish()
        }
      }

      // 其他窗口/标签页改了同一份存储时，把内存状态同步过来（storage 事件只在别的窗口触发）。
      function reloadFromStorage() {
        const next = loadState()
        state.sidebarOrder = next.sidebarOrder
        state.tabOrder = next.tabOrder
        state.moved = next.moved
        syncLaunchers()
        publish()
      }

      function swapKey(list, from, delta) {
        const at = list.indexOf(from)
        const to = at + delta
        if (at < 0 || to < 0 || to >= list.length) return null
        const next = list.slice()
        next.splice(at, 1)
        next.splice(to, 0, from)
        return next
      }

      function visiblePanelKeys() {
        const keys = []
        for (const row of sidebarRows()) {
          const label = rowLabel(row)
          if (label === '' || isMoved(label)) continue
          const key = panelKeyFor(label)
          if (!keys.includes(key)) keys.push(key)
        }
        return keys
      }

      // 键盘 / 触屏等效操作：设置页的 ↑/↓，不依赖拖拽。
      function nudgeSidebar(label, delta) {
        state.sidebarOrder = arrangeList(state.sidebarOrder, visiblePanelKeys())
        const next = swapKey(state.sidebarOrder, panelKeyFor(label), delta)
        if (!next) return
        state.sidebarOrder = next
        save()
      }

      function nudgeTab(label, delta, nth = 0) {
        const keys = tabRecords().filter(record => record.index > 0).map(record => record.key).filter(key => key !== '')
        state.tabOrder = arrangeList(state.tabOrder, keys)
        const next = swapKey(state.tabOrder, tabKeyForLabel(label, nth), delta)
        if (!next) return
        state.tabOrder = next
        save()
      }

      // 侧栏 / 标签行的 slot 条目快照：id + 当前 locale 文案
      function panelEntries() {
        try {
          const entries = ctx?.slots?.entriesOfSlot('sidebar.panellist') ?? []
          return entries.map(entry => ({ id: entry.options?.id, label: labelText(entry.options?.label) }))
        } catch {
          return []
        }
      }

      function viewEntries() {
        try {
          const entries = ctx?.slots?.entriesOfSlot('conversation.view') ?? []
          return entries.map(entry => ({ id: entry.options?.id, label: labelText(entry.options?.label) }))
        } catch {
          return []
        }
      }

      function panelIdFor(label) {
        const known = panelEntries().find(entry => entry.label === label)
        return known?.id ?? movedEntry(label)?.id ?? null
      }

      // ── 启动器标签（真实 conversation.view）────────────────────────────────

      function makeLauncher(label) {
        return function Launcher(props) {
          useEffect(() => { void launch(label, props) }, [label])
          return null
        }
      }

      async function launch(label, props) {
        const entry = movedEntry(label)
        if (!entry) return
        // conversation.view 的选中态由宿主 conversation store 持久化：点搬入标签后要先把当前视图
        // 切回「对话」，否则打开面板后用户点「返回对话」，宿主会以这个启动器视图重新挂载 →
        // 启动器再次打开面板，形成打不开对话的死循环。
        const openView = props?.openView ?? props?.setView ?? null
        let switched = false
        if (typeof openView === 'function') {
          try {
            openView('chat')
            switched = true
          } catch (error) {
            recordError(error)
          }
        }
        // 拿不到 openView 时退回点固定首位「对话」标签（会走宿主的 selectView('chat') 复位）。
        if (!switched && typeof launchSwitcher === 'function' && tabButtons().length > 0) {
          try { launchSwitcher() } catch (error) { recordError(error) }
        }
        const id = panelIdFor(label)
        if (id !== null && ctx?.layout?.selectPanel) {
          try { ctx.layout.selectPanel(id) } catch (error) { recordError(error) }
        } else {
          const row = findRowByLabel(label)
          if (row) {
            try { row.click() } catch (error) { recordError(error) }
          }
        }
        chip = true
        publish()
      }

      function ensureLauncher(entry) {
        if (!viewSlotReady) return
        if (launchers.has(entry.label)) return
        if (!ctx?.slots?.register) return
        const label = entry.label
        const id = viewIdFor(label)
        try {
          const dispose = ctx.effect(() => ctx.slots.register({
            name: 'conversation.view',
            id,
            // 官方 viewTabs() 走 slots.entries() 的插入顺序，order 不影响标签排序，这里保持推后注册即可。
            order: 900 + state.moved.findIndex(item => item.label === label),
            label,
            locale: NS,
          }, makeLauncher(label)), `entry-organizer: launcher ${id}`)
          launchers.set(label, dispose)
        } catch (error) {
          recordError(error)
        }
      }

      function disposeLauncher(label) {
        const dispose = launchers.get(label)
        if (!dispose) return
        launchers.delete(label)
        try { dispose() } catch (error) { recordError(error) }
      }

      function syncLaunchers() {
        for (const entry of state.moved) ensureLauncher(entry)
        for (const label of [...launchers.keys()]) {
          if (!isMoved(label)) disposeLauncher(label)
        }
      }

      // ── DOM 定位 ───────────────────────────────────────────────────────────

      function sidebarRows() {
        const rows = []
        const anchors = document.querySelectorAll('[data-slot="sidebar.panellist"]')
        for (const anchor of anchors) {
          const row = anchor.closest?.('button')
          if (row && !rows.includes(row)) rows.push(row)
        }
        if (rows.length === 0) {
          // 兜底：没有 glyph slot 锚点时按 nav 里的行按钮识别
          const navs = document.querySelectorAll('nav')
          for (const nav of navs) {
            for (const child of nav.children ?? []) {
              if (child.tagName !== 'BUTTON') continue
              if (!child.getAttribute?.('aria-label')) continue
              if (child.getAttribute?.('aria-haspopup')) continue // 「更多」按钮不是行
              rows.push(child)
            }
            if (rows.length > 0) break
          }
        }
        return rows
      }

      function rowLabel(row) {
        return row.getAttribute?.('aria-label') || (row.textContent ?? '').trim()
      }

      function findRowByLabel(label) {
        for (const row of sidebarRows()) {
          if (rowLabel(row) === label) return row
        }
        return null
      }

      function tabRow() {
        return document.querySelector('[data-conversation-tabs]')
      }

      function tabButtons() {
        const strip = tabRow()
        if (!strip) return []
        return [...strip.querySelectorAll('button[role="tab"]')]
      }

      function tabLabel(button) {
        return (button.textContent ?? '').trim()
      }

      // 宿主里存在「不同 id、同一文案」的视图（dsh-context 的「上下文」和 billion-context 的
      // `bili-context` 都叫「上下文」）。只按文案反查 id 会让两行共用同一个排序键；
      // 这里按同名出现的次序把 DOM 标签映射回 slot 条目 id，得到互不相同的稳定键。
      function tabRecords() {
        const buttons = tabButtons()
        const idsByLabel = new Map()
        for (const entry of viewEntries()) {
          const list = idsByLabel.get(entry.label) ?? []
          list.push(entry.id)
          idsByLabel.set(entry.label, list)
        }
        const visible = new Map()
        const drafts = []
        for (let index = 0; index < buttons.length; index++) {
          const label = tabLabel(buttons[index])
          const nth = visible.get(label) ?? 0
          visible.set(label, nth + 1)
          drafts.push({ button: buttons[index], index, label, nth })
        }
        return drafts.map(draft => {
          const ids = idsByLabel.get(draft.label) ?? []
          // 同名视图里有条目没渲染出来时（被隐藏/进溢出菜单），按可见次序无法确定 id 归属；
          // 此时退回「文案 + 第几次出现」键：宁可顺序不跟随 id，也不能把两个视图写成同一个键。
          const ambiguous = ids.length > 1 && visible.get(draft.label) !== ids.length
          let id = ambiguous ? null : (ids[draft.nth] ?? null)
          if (id === null && draft.index > 0 && isMoved(draft.label)) id = viewIdFor(draft.label)
          const fallback = draft.nth === 0 ? legacyLabelKey(draft.label) : legacyLabelKey(draft.label) + '#' + draft.nth
          return { ...draft, key: keyFromId('v', id) ?? fallback }
        })
      }

      function tabKeyForLabel(label, nth = 0) {
        const record = tabRecords().find(item => item.label === label && item.nth === nth)
        return record?.key ?? viewKeyFor(label)
      }

      function moreButton() {
        const rows = sidebarRows()
        const nav = rows[0]?.parentElement
        if (!nav) return null
        // 真实页面里「更多」被包在 Menu 组件根节点（div.wtg9ga_moreAnchor）中，
        // aria-haspopup 按钮不是 nav 的直系子节点；flex order 只有写在直系子节点上才生效。
        for (const child of nav.children ?? []) {
          if (child.tagName === 'BUTTON' && child.getAttribute?.('aria-haspopup')) return child
          if (child.querySelector?.('button[aria-haspopup]')) return child
        }
        return null
      }

      // ── reconcile：把存储顺序写回 DOM ─────────────────────────────────────

      function ensurePlaceholder(nav, afterOrder) {
        if (!nav) return null
        // 热加载或旧实例未卸载时，页面上可能残留别人的占位框：优先接管并清掉多余节点，
        // 保证任何时刻只有一个占位框，避免侧栏出现两个虚线空位。
        if (!placeholder || placeholder.parentElement === null) {
          placeholder = document.querySelector('[data-ea-placeholder="1"]') ?? null
        }
        if (!placeholder) {
          placeholder = document.createElement('div')
          placeholder.className = 'ea-placeholder'
          placeholder.setAttribute('data-ea-placeholder', '1')
          placeholder.textContent = t('dropHere')
        }
        for (const stray of document.querySelectorAll('[data-ea-placeholder="1"]')) {
          if (stray !== placeholder) stray.remove()
        }
        if (placeholder.parentElement !== nav) nav.appendChild(placeholder)
        placeholder.style.order = String(afterOrder)
        placeholder.setAttribute('data-ea-show', state.moved.length > 0 || dragging !== null ? '1' : '0')
        return placeholder
      }

      function reconcile() {
        if (!mounted) return
        try {
          upgradeKeys()
          pruneMoved()

          const before = JSON.stringify([state.sidebarOrder, state.tabOrder])
          const rows = sidebarRows()
          // 逐行取自己的 label：任一行为空标签时不能再用「过滤后的数组下标」去对齐 rows（回归：索引错位）。
          const records = []
          for (const row of rows) {
            const label = rowLabel(row)
            if (label === '') continue
            records.push({ row, label, key: panelKeyFor(label) })
          }
          // 裁剪集合要同时包含 registry 里已注册的面板与当前 DOM 行：
          // 启动早期行可能还没渲染、或面板插件晚注册，只按 DOM 裁剪会把已存顺序清空并立即落盘
          // （回归：自定义侧栏顺序在重启后丢失）。
          const movedIds = new Set(state.moved.map(entry => entry.id).filter(id => typeof id === 'string' && id !== ''))
          const movedLabels = new Set(state.moved.map(entry => entry.label))
          const registryPanelKeys = panelEntries()
            // 已经搬去标签行的条目不该被 registry 兜底重新塞回侧栏顺序里
            .filter(entry => !movedIds.has(entry.id) && !movedLabels.has(entry.label))
            .map(entry => keyFromId('p', entry.id))
            .filter(key => typeof key === 'string' && key !== '')
          const presentKeys = new Set([
            ...records.filter(item => !isMoved(item.label)).map(item => item.key),
            ...registryPanelKeys,
          ])
          if (presentKeys.size > 0) state.sidebarOrder = arrangeList(state.sidebarOrder, [...presentKeys])

          let visibleIndex = 0
          for (const { row, label, key } of records) {
            row.setAttribute('data-ea-row', '1')
            row.setAttribute('data-ea-label', label)
            if (isMoved(label)) {
              row.style.display = 'none'
              row.style.order = ''
              row.removeAttribute('data-ea-draggable')
              row.removeAttribute('draggable')
              continue
            }
            row.style.display = ''
            const at = state.sidebarOrder.indexOf(key)
            row.style.order = String(at >= 0 ? at + 1 : visibleIndex + 1)
            row.setAttribute('data-ea-draggable', '1')
            row.setAttribute('draggable', 'true')
            row.classList?.add('ea-draggable')
            visibleIndex++
          }

          const nav = records[0]?.row?.parentElement ?? null
          if (nav) {
            // 「更多」是面板列表的最后一项，占位框要排在它之后（回归：占位框跑到「更多」上方）。
            const moreOrder = visibleIndex + 1
            const more = moreButton()
            if (more) more.style.order = String(moreOrder)
            ensurePlaceholder(nav, moreOrder + 1)
          }

          // 顶部标签：第 0 个是官方固定的「对话」，其余按 tabOrder 视觉重排。
          // 裁剪时要把「已注册但还没渲染出来的 view（含刚注册的启动器、被收进更多菜单的标签）」
          // 也算进已知集合，否则刚搬过去的条目会在渲染前被裁掉、位置丢失。
          // 键一律用 view id：同名不同 id 的视图（「上下文」）必须各占一个位置（回归：重复标签撞键）。
          const tabRecordsList = tabRecords()
          const fixedKey = tabRecordsList[0]?.key ?? null
          const keep = []
          const addTabKey = key => {
            if (key === null || key === undefined || key === '' || key === fixedKey) return
            if (!keep.includes(key)) keep.push(key)
          }
          for (const record of tabRecordsList) {
            if (record.index === 0) continue
            addTabKey(record.key)
          }
          for (const entry of viewEntries()) addTabKey(keyFromId('v', entry.id))
          for (const entry of state.moved) addTabKey(keyFromId('v', viewIdFor(entry.label)))
          if (keep.length > 0) state.tabOrder = arrangeList(state.tabOrder, keep)
          // 第一标签标记必须每轮重算并清掉旧的：标签顺序变化后旧标记会残留，把计数和判定带偏。
          for (const tab of tabButtons()) tab.removeAttribute('data-ea-fixed')
          for (const record of tabRecordsList) {
            const tab = record.button
            if (record.label === '') continue
            if (record.index === 0) {
              tab.style.order = '0'
              tab.setAttribute('data-ea-fixed', '1')
              tab.removeAttribute('draggable')
              tab.removeAttribute('data-ea-tab')
              tab.removeAttribute('data-ea-tabkey')
              continue
            }
            tab.removeAttribute('data-ea-fixed')
            const at = state.tabOrder.indexOf(record.key)
            tab.style.order = String(at >= 0 ? at + 1 : 500 + record.index)
            tab.setAttribute('data-ea-tab', '1')
            tab.setAttribute('data-ea-label', record.label)
            tab.setAttribute('data-ea-tabkey', record.key)
            tab.setAttribute('data-ea-draggable', '1')
            tab.setAttribute('draggable', 'true')
            tab.classList?.add('ea-draggable')
          }

          // 顺序变化时立即落盘：宿主没再触发 reconcile 时重启也不会丢（回归：顺序不落盘）。
          if (JSON.stringify([state.sidebarOrder, state.tabOrder]) !== before) saveState(state)

          // 「返回对话」浮标：只有当前打开的面板行是被搬走的那些行时才出现。
          let nextChip = false
          for (const row of rows) {
            if (row.getAttribute?.('aria-current') !== 'page') continue
            const label = rowLabel(row)
            if (isMoved(label)) nextChip = true
          }
          if (nextChip !== chip) {
            chip = nextChip
            publish()
          }

          syncLaunchers()
        } catch (error) {
          recordError(error)
        }
      }

      // 用 rAF 合并高频变更：拖拽/布局抖动时不再每个 mutation 立即全量 reconcile。
      function schedule() {
        if (scheduled) return
        scheduled = true
        const run = () => {
          scheduled = false
          reconcile()
        }
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run)
        else queueMicrotask(run)
      }

      // ── 拖拽 ───────────────────────────────────────────────────────────────

      // 只清理本实例加过的标记：不再每次 dragover 都做全文档查询（回归：性能热点）。
      const marked = new Set()

      function mark(element, className) {
        if (!element?.classList) return
        element.classList.add(className)
        marked.add(element)
      }

      function clearMarkers() {
        for (const element of marked) {
          element.classList?.remove('ea-drop-before', 'ea-drop-after', 'ea-tab-drop-before', 'ea-tab-drop-after', 'ea-drop-strip')
        }
        marked.clear()
      }

      // 一次性清掉旧实例可能遗留的标记类：只在启动与一次拖拽结束时执行，不在高频路径里。
      function clearStrayMarkers() {
        for (const element of document.querySelectorAll('.ea-drop-before,.ea-drop-after,.ea-tab-drop-before,.ea-tab-drop-after,.ea-drop-strip')) {
          element.classList.remove('ea-drop-before', 'ea-drop-after', 'ea-tab-drop-before', 'ea-tab-drop-after', 'ea-drop-strip')
        }
      }

      function isDraggableTab(button) {
        return button?.getAttribute?.('data-ea-tab') === '1'
      }

      function relativeAfter(element, event) {
        const rect = element.getBoundingClientRect?.()
        if (!rect || rect.height === 0) return false
        return event.clientY > rect.top + rect.height / 2
      }

      // 顶部标签是横向排列的，插入点必须按 X 中点判断，否则会出现「拖两三次才成功」。
      function relativeAfterX(element, event) {
        const rect = element.getBoundingClientRect?.()
        if (!rect || rect.width === 0) return false
        return event.clientX > rect.left + rect.width / 2
      }

      function onDragStart(event) {
        const target = event.target
        const row = target?.closest?.('button[data-ea-row="1"]')
        const tab = row ? null : target?.closest?.('button[data-ea-tab="1"]')
        if (!row && !tab) return
        const label = (row ?? tab).getAttribute('data-ea-label') ?? ''
        if (label === '') return
        dragging = {
          kind: row ? 'row' : 'tab',
          label,
          key: row ? null : (tab.getAttribute('data-ea-tabkey') ?? null),
        }
        try {
          event.dataTransfer?.setData('text/plain', label)
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        } catch { /* 部分环境不允许写 dataTransfer */ }
        ;(row ?? tab).classList?.add('ea-dragging')
        if (placeholder) placeholder.setAttribute('data-ea-show', '1')
      }

      function onDragOver(event) {
        if (!dragging) return
        clearMarkers()
        if (!placeholder) {
          const rows = sidebarRows()
          ensurePlaceholder(rows[0]?.parentElement ?? null, 9999)
        }
        if (placeholder) placeholder.setAttribute('data-ea-show', '1')
        const target = event.target
        const strip = target?.closest?.('[data-conversation-tabs]')
        if (strip) {
          if (dragging.kind === 'row') {
            event.preventDefault()
            const hovered = target.closest?.('button[role="tab"]')
            if (hovered && hovered !== target.closest('button[data-ea-row="1"]')) {
              mark(hovered, relativeAfterX(hovered, event) ? 'ea-tab-drop-after' : 'ea-tab-drop-before')
            } else {
              mark(strip, 'ea-drop-strip')
            }
            return
          }
          const hoveredTab = target.closest?.('button[data-ea-tab="1"]')
          if (hoveredTab && isDraggableTab(hoveredTab)) {
            event.preventDefault()
            mark(hoveredTab, relativeAfterX(hoveredTab, event) ? 'ea-tab-drop-after' : 'ea-tab-drop-before')
          }
          return
        }
        const row = target?.closest?.('button[data-ea-row="1"]')
        if (row) {
          if (dragging.kind === 'row') {
            event.preventDefault()
            mark(row, relativeAfter(row, event) ? 'ea-drop-after' : 'ea-drop-before')
            return
          }
          if (movedEntry(dragging.label)) {
            event.preventDefault()
            mark(row, relativeAfter(row, event) ? 'ea-drop-after' : 'ea-drop-before')
          }
          return
        }
        if (target === placeholder || target?.closest?.('[data-ea-placeholder="1"]')) {
          if (dragging.kind === 'tab' && movedEntry(dragging.label)) {
            event.preventDefault()
            mark(placeholder, 'ea-drop-strip')
          }
        }
      }

      function reorderSidebar(label, target, after) {
        const visible = state.sidebarOrder.filter(item => !isMovedKey(item))
        state.sidebarOrder = moveRelative(visible, panelKeyFor(label), panelKeyFor(target), after)
        save()
      }

      function reorderTabs(fromKey, toKey, after) {
        if (!fromKey || !toKey || fromKey === toKey) return
        state.tabOrder = moveRelative(state.tabOrder, fromKey, toKey, after)
        save()
      }

      function moveToTabs(label, targetKey, after) {
        const entry = { label, id: panelIdFor(label) }
        const key = movedKey(entry)
        const tabKey = keyFromId('v', viewIdFor(label)) ?? viewKeyFor(label)
        state.sidebarOrder = state.sidebarOrder.filter(item => item !== key)
        if (!isMovedKey(key)) state.moved = state.moved.concat([entry])
        const rest = state.tabOrder.filter(item => item !== tabKey)
        if (targetKey !== null && targetKey !== undefined && rest.includes(targetKey)) {
          state.tabOrder = moveRelative(rest, tabKey, targetKey, after)
        } else {
          state.tabOrder = rest.concat([tabKey])
        }
        syncLaunchers()
        save()
      }

      function moveToSidebar(label, target, after) {
        const entry = movedEntry(label)
        if (!entry) return
        const panelKey = panelKeyFor(label)
        state.moved = state.moved.filter(item => movedKey(item) !== movedKey(entry) && item.label !== label)
        state.tabOrder = state.tabOrder.filter(item => item !== viewKeyFor(label))
        const visible = state.sidebarOrder.filter(item => item !== panelKey && !isMovedKey(item))
        const targetKey = target === null || target === undefined ? null : panelKeyFor(target)
        state.sidebarOrder = targetKey !== null && visible.includes(targetKey)
          ? moveRelative(visible, panelKey, targetKey, after)
          : visible.concat([panelKey])
        disposeLauncher(label)
        save()
      }

      function onDrop(event) {
        if (!dragging) return
        const target = event.target
        const strip = target?.closest?.('[data-conversation-tabs]')
        if (strip) {
          event.preventDefault()
          const hovered = target.closest?.('button[role="tab"]')
          const hoveredTab = target.closest?.('button[data-ea-tab="1"]')
          if (dragging.kind === 'row') {
            const hoveredKey = hovered?.getAttribute?.('data-ea-tabkey') ?? null
            moveToTabs(dragging.label, hoveredKey, hovered ? relativeAfterX(hovered, event) : false)
          } else if (hoveredTab && isDraggableTab(hoveredTab)) {
            reorderTabs(dragging.key, hoveredTab.getAttribute?.('data-ea-tabkey') ?? null, relativeAfterX(hoveredTab, event))
          }
          finishDrag()
          return
        }
        const row = target?.closest?.('button[data-ea-row="1"]')
        if (row) {
          event.preventDefault()
          if (dragging.kind === 'row') {
            reorderSidebar(dragging.label, rowLabel(row), relativeAfter(row, event))
          } else if (movedEntry(dragging.label)) {
            moveToSidebar(dragging.label, rowLabel(row), relativeAfter(row, event))
          }
          finishDrag()
          return
        }
        if (target === placeholder || target?.closest?.('[data-ea-placeholder="1"]')) {
          event.preventDefault()
          if (dragging.kind === 'tab' && movedEntry(dragging.label)) {
            moveToSidebar(dragging.label, null, false)
          }
          finishDrag()
        }
      }

      function finishDrag() {
        const active = document.querySelector('.ea-dragging')
        active?.classList?.remove('ea-dragging')
        dragging = null
        clearMarkers()
        clearStrayMarkers()
        if (placeholder) placeholder.setAttribute('data-ea-show', state.moved.length > 0 ? '1' : '0')
        reconcile()
      }

      function onDragEnd() {
        finishDrag()
      }

      // ── 生命周期 ───────────────────────────────────────────────────────────

      let launchSwitcher = null

      function attach(context) {
        ctx = context
        mounted = true
        viewSlotReady = false
        launchers.clear()
        // 视图状态切回对话：优先走官方 layout API（不依赖标签顺序），失败再点第一个标签兜底。
        launchSwitcher = () => {
          if (ctx?.layout?.selectPanel) {
            try {
              ctx.layout.selectPanel(null)
              return
            } catch (error) {
              recordError(error)
            }
          }
          const tabs = tabButtons()
          if (tabs.length > 0) tabs[0].click()
        }
      }

      function startViewSlot() {
        return ctx.slots.inject('conversation.view', () => {
          viewSlotReady = true
          syncLaunchers()
          // 宿主契约：inject 回调应返回同步 disposer，声明卸载时用它回收本插件注册的启动器。
          return () => {
            viewSlotReady = false
            for (const label of [...launchers.keys()]) disposeLauncher(label)
          }
        })
      }

      // 浮标贴主内容区左上角：优先按侧栏实际宽度定位；测量不到时退回布局列宽，最后退回 16px。
      function chipInset() {
        const frame = document.querySelector('[data-slot="sidebar"]')
        if (frame) {
          try {
            const rect = frame.getBoundingClientRect?.()
            if (rect && rect.width > 0) return Math.round(rect.width) + 12
          } catch { /* 测量失败时继续找布局列宽 */ }
          let node = frame
          while (node) {
            let template = ''
            try {
              const computed = typeof getComputedStyle === 'function' ? getComputedStyle(node) : null
              template = String(node.style?.gridTemplateColumns || computed?.gridTemplateColumns || '')
            } catch { template = '' }
            const first = template.split(' ')[0] ?? ''
            const width = Number.parseFloat(first)
            if (Number.isFinite(width) && width > 0) return Math.round(width) + 12
            node = node.parentElement
          }
        }
        return 16
      }

      // mutation 是否可能影响侧栏/标签行：无关的会话滚动、消息追加不再触发全量 reconcile。
      function relevantMutation(record) {
        if (record.type === 'attributes') {
          // 侧栏折叠状态挂在 layout 框架上（不在 nav 祖先链里），也要能触发重算：浮标位置依赖侧栏宽度。
          if (record.target?.hasAttribute?.('data-sidebar-collapsed')) return true
          return Boolean(record.target?.closest?.('nav, [data-conversation-tabs], [data-slot="sidebar"], [data-sidebar-collapsed]'))
        }
        if (record.target?.closest?.('nav, [data-conversation-tabs]')) return true
        for (const node of [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])]) {
          if (!node || node.nodeType !== 1) continue
          if (node.matches?.('nav, button, [data-conversation-tabs], [data-slot], [data-ea-placeholder]')) return true
          if (node.querySelector?.('[data-slot="sidebar.panellist"], [data-conversation-tabs], nav')) return true
        }
        return false
      }

      // 卸载/热重载时把宿主 DOM 还原成我们接手前的样子：
      // 否则被搬走的行会一直 display:none，而对应 launcher 已经 dispose，面板不可达。
      function restoreDom() {
        try {
          for (const row of sidebarRows()) {
            row.style.order = ''
            row.style.display = ''
            row.removeAttribute('data-ea-row')
            row.removeAttribute('data-ea-label')
            row.removeAttribute('data-ea-draggable')
            row.removeAttribute('draggable')
            row.classList?.remove('ea-draggable')
          }
          for (const tab of tabButtons()) {
            tab.style.order = ''
            tab.removeAttribute('data-ea-fixed')
            tab.removeAttribute('data-ea-tab')
            tab.removeAttribute('data-ea-label')
            tab.removeAttribute('data-ea-tabkey')
            tab.removeAttribute('data-ea-draggable')
            tab.removeAttribute('draggable')
            tab.classList?.remove('ea-draggable')
          }
        } catch {
          // 宿主结构变化时忽略
        }
      }

      function startDom() {
        mountedAt = Date.now()
        upgradeKeys()
        clearStrayMarkers()
        reconcile()
        try {
          observer = new MutationObserver(records => {
            if (records.some(relevantMutation)) schedule()
          })
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-label', 'aria-current', 'data-sidebar-collapsed'],
          })
        } catch (error) {
          recordError(error)
        }
        const onResize = () => {
          schedule()
          if (chip) publish()
        }
        const onStorage = event => {
          if (event?.key !== STORAGE_KEY && event?.key !== LEGACY_STORAGE_KEY) return
          reloadFromStorage()
          schedule()
        }
        window.addEventListener?.('resize', onResize)
        window.addEventListener?.('storage', onStorage)
        document.addEventListener('dragstart', onDragStart, true)
        document.addEventListener('dragover', onDragOver, true)
        document.addEventListener('drop', onDrop, true)
        document.addEventListener('dragend', onDragEnd, true)
        schedule()
        return () => {
          observer?.disconnect()
          observer = null
          window.removeEventListener?.('resize', onResize)
          window.removeEventListener?.('storage', onStorage)
          document.removeEventListener('dragstart', onDragStart, true)
          document.removeEventListener('dragover', onDragOver, true)
          document.removeEventListener('drop', onDrop, true)
          document.removeEventListener('dragend', onDragEnd, true)
          clearMarkers()
          clearStrayMarkers()
          restoreDom()
          placeholder?.remove()
          placeholder = null
          for (const label of [...launchers.keys()]) disposeLauncher(label)
          mounted = false
        }
      }

      // ── 供设置页使用 ───────────────────────────────────────────────────────

      // 设置页要展示「当前视觉顺序」：DOM 里只有 style.order，按它排序后给出文案列表。
      function sidebarList() {
        const list = []
        for (const row of sidebarRows()) {
          const label = rowLabel(row)
          if (label === '' || isMoved(label)) continue
          const order = Number.parseInt(row.style.order, 10)
          list.push({ label, order: Number.isFinite(order) ? order : list.length + 1 })
        }
        list.sort((a, b) => a.order - b.order)
        return list.map(entry => entry.label)
      }

      function tabList() {
        const records = tabRecords().filter(record => record.index > 0 && record.label !== '')
        const counts = new Map()
        for (const record of records) counts.set(record.label, (counts.get(record.label) ?? 0) + 1)
        const list = records.map(record => {
          const order = Number.parseInt(record.button.style.order, 10)
          return {
            label: record.label,
            key: record.key,
            nth: record.nth,
            duplicate: (counts.get(record.label) ?? 0) > 1,
            order: Number.isFinite(order) ? order : 500 + record.index,
          }
        })
        list.sort((a, b) => a.order - b.order)
        return list.map(({ label, key, nth, duplicate }) => ({ label, key, nth, duplicate }))
      }

      function settingsSnapshot() {
        return {
          sidebarRows: sidebarRows().length,
          // 固定首位的「对话」不算可排序标签（回归：标签计数把不可拖的占位也算进去）。
          tabLabels: tabButtons().filter(tab => tab.getAttribute?.('data-ea-fixed') !== '1').length,
          moved: state.moved.map(entry => entry.label ?? entry.id ?? ''),
          sidebarList: sidebarList(),
          tabList: tabList(),
          sidebarOrder: state.sidebarOrder.slice(),
          tabOrder: state.tabOrder.slice(),
          lastError,
        }
      }

      function reset() {
        state.sidebarOrder = []
        state.tabOrder = []
        state.moved = []
        for (const label of [...launchers.keys()]) disposeLauncher(label)
        save()
      }

      // 标签行容量有限，搬入的标签一旦被截断进「...」菜单就没有可拖的 DOM 节点；
      // 这个方法是那种状态下的唯一可视化逃生口：全部还原到侧栏末尾。
      function restoreAll() {
        if (state.moved.length === 0) return
        const viewKeys = state.moved.map(entry => viewKeyFor(entry.label))
        const panelKeys = state.moved.map(entry => (entry.id ? keyFromId('p', entry.id) : panelKeyFor(entry.label)))
        state.moved = []
        state.tabOrder = state.tabOrder.filter(key => !viewKeys.includes(key))
        state.sidebarOrder = state.sidebarOrder.concat(panelKeys.filter(key => key !== null && !state.sidebarOrder.includes(key)))
        save()
      }

      function returnToConversation() {
        try {
          if (ctx?.layout?.selectPanel) ctx.layout.selectPanel(null)
        } catch (error) {
          recordError(error)
        }
        chip = false
        publish()
      }

      return {
        t,
        state,
        attach,
        subscribe,
        settingsSnapshot,
        reset,
        restoreAll,
        returnToConversation,
        chipInset,
        restore: label => moveToSidebar(label, null, false),
        nudgeSidebar,
        nudgeTab,
        startViewSlot,
        startDom,
        reconcile,
        // 测试用：把 prune 宽限期设为 0，避免等待 2.5s 启动窗口
        setPruneGrace(ms) { pruneGraceMs = Math.max(0, Number(ms) || 0) },
        get chip() { return chip },
        get lastError() { return lastError },
        // tests
        __reconcile: reconcile,
      }
    }

    const controller = createController()

    // ── 组件 ─────────────────────────────────────────────────────────────────

    function useController(select) {
      const latest = useRef(select)
      latest.current = select
      const [value, setValue] = useState(() => select())
      useEffect(() => controller.subscribe(() => setValue(latest.current())), [])
      return value
    }

    function ReturnChip() {
      const visible = useController(() => controller.chip)
      const t = controller.t
      if (!visible) return null
      return h('button', {
        type: 'button',
        className: 'ea-chip',
        style: { insetInlineStart: controller.chipInset() + 'px' },
        title: t('backHint'),
        onClick: () => controller.returnToConversation(),
      }, '← ' + t('back'))
    }

    function SettingsPage() {
      const t = controller.t
      const snap = useController(() => controller.settingsSnapshot())
      const [note, setNote] = useState('')
      const reset = useCallback(() => {
        controller.reset()
        setNote(t('resetConfirm'))
      }, [])

      // 拖拽之外必须还有等效操作：键盘/触屏用户（以及标签被「...」截断时）用 ↑/↓ 调整顺序。
      const stepButton = (kind, label, delta, disabled, nth = 0) => h('button', {
        type: 'button',
        disabled,
        title: t('orderHint'),
        onClick: () => {
          if (kind === 'sidebar') controller.nudgeSidebar(label, delta)
          else controller.nudgeTab(label, delta, nth)
        },
      }, delta < 0 ? '↑ ' + t('moveUp') : '↓ ' + t('moveDown'))

      // 侧栏项是纯文案；标签项带 key/nth（同名视图要靠它们区分，否则两行会互相顶替、还会撞 React key）。
      const orderRows = (kind, list) => list.map((item, index) => {
        const label = typeof item === 'string' ? item : item.label
        const nth = typeof item === 'string' ? 0 : (item.nth ?? 0)
        const unique = typeof item === 'string' ? label : item.key
        const name = typeof item !== 'string' && item.duplicate ? label + ' #' + (nth + 1) : label
        return h('li', {
          key: kind + ':' + unique + ':' + index,
          className: 'ea-item',
        },
          h('span', { className: 'ea-item-name' }, name),
          h('div', { className: 'ea-actions' },
            stepButton(kind, label, -1, index === 0, nth),
            stepButton(kind, label, 1, index === list.length - 1, nth)))
      })

      const movedRows = snap.moved.map((label, index) => h('li', {
        key: 'moved:' + index + ':' + label,
        className: 'ea-item',
      },
        h('span', { className: 'ea-item-name' }, label),
        h('button', { type: 'button', onClick: () => controller.restore(label) }, t('moveBack'))))

      return h('div', { className: 'ea-page' },
        h('h2', { className: 'ea-title' }, t('title')),
        h('p', { className: 'ea-hint' }, t('hint')),
        h('p', { className: 'ea-hint' }, t('overflowHint')),
        h('div', { className: 'ea-grid' },
          h('div', { className: 'ea-stat' },
            h('div', { className: 'ea-stat-label' }, t('sidebarRows')),
            h('div', { className: 'ea-stat-value' }, String(snap.sidebarRows))),
          h('div', { className: 'ea-stat' },
            h('div', { className: 'ea-stat-label' }, t('tabLabels')),
            h('div', { className: 'ea-stat-value' }, String(snap.tabLabels))),
          h('div', { className: 'ea-stat' },
            h('div', { className: 'ea-stat-label' }, t('movedCount')),
            h('div', { className: 'ea-stat-value' }, String(snap.moved.length)))),
        h('h3', { className: 'ea-subtitle' }, t('orderSection')),
        h('p', { className: 'ea-hint' }, t('orderHint')),
        snap.sidebarList.length === 0
          ? h('p', { className: 'ea-empty' }, t('emptyNote'))
          : h('ul', { className: 'ea-list' }, orderRows('sidebar', snap.sidebarList)),
        h('h3', { className: 'ea-subtitle' }, t('tabSection')),
        snap.tabList.length === 0
          ? h('p', { className: 'ea-empty' }, t('emptyNote'))
          : h('ul', { className: 'ea-list' }, orderRows('tab', snap.tabList)),
        h('h3', { className: 'ea-subtitle' }, t('movedCount')),
        snap.moved.length === 0
          ? h('p', { className: 'ea-empty' }, t('movedEmpty'))
          : h('ul', { className: 'ea-list' }, movedRows),
        note !== '' ? h('p', { className: 'ea-hint' }, note) : null,
        h('div', { className: 'ea-actions' },
          h('button', { type: 'button', onClick: reset }, t('reset'))),
        h('h3', { className: 'ea-subtitle' }, t('diagnostics')),
        h('p', { className: 'ea-error' }, `${t('errLabel')}: ${snap.lastError ?? t('noError')}`),
        h('p', { className: 'ea-hint' }, t('resetHint')))
    }

    // 「...」（更多视图）菜单里的恢复入口：标签行容量由官方按宽度估算，搬入的标签
    // 可能直接被截断进这个菜单；菜单项没有拖拽能力，所以必须在同一菜单里给一键还原。
    function ViewsMoreRestoreAction(props) {
      const t = props?.t ?? controller.t
      const count = useController(() => controller.state.moved.length)
      if (count === 0) return null
      return h('button', {
        type: 'button',
        className: 'ea-menu-row',
        onClick: () => controller.restoreAll(),
      }, t('restoreAll'))
    }

    // ── plugin entry ─────────────────────────────────────────────────────────

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      controller.attach(ctx)
      ctx.effect(() => ctx.locale.register(NS, DICT), 'entry-organizer: dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-entry-organizer')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'entry-organizer: styles')
      ctx.effect(() => controller.startDom(), 'entry-organizer: dom sync')
      ctx.effect(() => controller.startViewSlot(), 'entry-organizer: launcher views')
      // 官方「更多会话视图」菜单：标签行溢出时搬入的标签只存在于该菜单，必须在菜单里给还原入口。
      ctx.slots.inject('conversation.session.header.views.actions', () => ctx.slots.register({
        name: 'conversation.session.header.views.actions',
        id: 'entry-organizer-restore',
        order: -50,
        label: () => t('restoreAll'),
        locale: NS,
      }, ViewsMoreRestoreAction))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'entry-organizer-chip',
        order: 60,
        locale: NS,
      }, () => h(ReturnChip)))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'entry-organizer',
        order: 45,
        label: () => t('title'),
        locale: NS,
      }, () => h(SettingsPage)))
    }

    const module = { exports: {} }
    const exports = module.exports
    exports.apply = apply
    exports.inject = ['slots', 'locale', 'layout']
    // 与 package.json 的 name / cordis.patch.yml 的 name 保持一致，避免宿主诊断与 HMR 身份错位。
    exports.name = 'dsh-entry-organizer'
    exports.__internals = { arrangeList, moveRelative, viewIdFor, labelText, createController, controller, ReturnChip, SettingsPage, ViewsMoreRestoreAction }
    return module.exports
  },
})
