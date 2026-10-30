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

    function loadState() {
      const state = emptyState()
      let migrated = false
      try {
        let raw = window.localStorage?.getItem(STORAGE_KEY)
        if (typeof raw !== 'string' || raw === '') {
          const legacy = window.localStorage?.getItem(LEGACY_STORAGE_KEY)
          if (typeof legacy !== 'string' || legacy === '') return state
          raw = legacy
          migrated = true
        }
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return state
        state.sidebarOrder = sanitizeList(parsed.sidebarOrder)
        state.tabOrder = sanitizeList(parsed.tabOrder)
        const moved = Array.isArray(parsed.moved) ? parsed.moved : []
        const seen = new Set()
        for (const entry of moved) {
          if (!entry || typeof entry !== 'object') continue
          const label = typeof entry.label === 'string' ? entry.label : ''
          if (label === '' || seen.has(label)) continue
          seen.add(label)
          state.moved.push({ label, id: typeof entry.id === 'string' ? entry.id : null })
        }
        if (migrated) saveState(state)
        return state
      } catch {
        return emptyState()
      }
    }

    function saveState(state) {
      try {
        window.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
          v: 1,
          sidebarOrder: state.sidebarOrder,
          moved: state.moved.map(entry => ({ label: entry.label, id: entry.id ?? null })),
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

      function isMoved(label) {
        return state.moved.some(entry => entry.label === label)
      }

      function movedEntry(label) {
        return state.moved.find(entry => entry.label === label) ?? null
      }

      function save() {
        saveState(state)
        publish()
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
        return function Launcher() {
          useEffect(() => { void launch(label) }, [label])
          return null
        }
      }

      async function launch(label) {
        const entry = movedEntry(label)
        if (!entry) return
        // 先把视图状态切回对话，避免下次打开会话又落回这个启动器。
        if (typeof launchSwitcher === 'function') {
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

      function moreButton() {
        const rows = sidebarRows()
        const nav = rows[0]?.parentElement
        if (!nav) return null
        for (const child of nav.children ?? []) {
          if (child.tagName === 'BUTTON' && child.getAttribute?.('aria-haspopup')) return child
        }
        return null
      }

      // ── reconcile：把存储顺序写回 DOM ─────────────────────────────────────

      function ensurePlaceholder(nav, afterOrder) {
        if (!nav) return null
        if (!placeholder) {
          placeholder = document.createElement('div')
          placeholder.className = 'ea-placeholder'
          placeholder.setAttribute('data-ea-placeholder', '1')
          placeholder.textContent = t('dropHere')
        }
        if (placeholder.parentElement !== nav) nav.appendChild(placeholder)
        placeholder.style.order = String(afterOrder)
        placeholder.setAttribute('data-ea-show', state.moved.length > 0 || dragging !== null ? '1' : '0')
        return placeholder
      }

      function reconcile() {
        if (!mounted) return
        try {
          const rows = sidebarRows()
          const labels = rows.map(rowLabel).filter(label => label !== '')
          const visible = labels.filter(label => !isMoved(label))
          state.sidebarOrder = arrangeList(state.sidebarOrder, visible)

          let visibleIndex = 0
          for (let index = 0; index < rows.length; index++) {
            const row = rows[index]
            const label = labels[index]
            if (label === undefined) continue
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
            const at = state.sidebarOrder.indexOf(label)
            row.style.order = String(at >= 0 ? at + 1 : visibleIndex + 1)
            row.setAttribute('data-ea-draggable', '1')
            row.setAttribute('draggable', 'true')
            row.classList?.add('ea-draggable')
            visibleIndex++
          }

          const nav = rows[0]?.parentElement ?? null
          if (nav) {
            const more = moreButton()
            if (more) more.style.order = '10000'
            ensurePlaceholder(nav, visibleIndex + 1)
          }

          // 顶部标签：第 0 个是官方固定的「对话」，其余按 tabOrder 视觉重排。
          // 裁剪时要把「已注册但还没渲染出来的 view（含刚注册的启动器、被收进更多菜单的标签）」
          // 也算进已知集合，否则刚搬过去的条目会在渲染前被裁掉、位置丢失。
          const tabs = tabButtons()
          const labels2 = tabs.map(tabLabel)
          const chatLabel = labels2[0] ?? ''
          const known = viewEntries().map(entry => entry.label).filter(label => label !== null && label !== '')
          const knownAll = new Set([...labels2.slice(1), ...known, ...state.moved.map(entry => entry.label)])
          knownAll.delete(chatLabel)
          const rest = [...knownAll].filter(label => label !== '')
          state.tabOrder = arrangeList(state.tabOrder, rest)
          for (let index = 0; index < tabs.length; index++) {
            const tab = tabs[index]
            const label = labels2[index] ?? ''
            if (label === '') continue
            if (index === 0) {
              tab.style.order = '0'
              tab.removeAttribute('draggable')
              tab.removeAttribute('data-ea-tab')
              continue
            }
            const at = state.tabOrder.indexOf(label)
            tab.style.order = String(at >= 0 ? at + 1 : 500 + index)
            tab.setAttribute('data-ea-tab', '1')
            tab.setAttribute('data-ea-label', label)
            tab.setAttribute('data-ea-draggable', '1')
            tab.setAttribute('draggable', 'true')
            tab.classList?.add('ea-draggable')
          }

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

      function schedule() {
        if (scheduled) return
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          reconcile()
        })
      }

      // ── 拖拽 ───────────────────────────────────────────────────────────────

      function clearMarkers() {
        for (const el of document.querySelectorAll('.ea-drop-before,.ea-drop-after,.ea-tab-drop-before,.ea-tab-drop-after,.ea-drop-strip')) {
          el.classList.remove('ea-drop-before', 'ea-drop-after', 'ea-tab-drop-before', 'ea-tab-drop-after', 'ea-drop-strip')
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
        dragging = { kind: row ? 'row' : 'tab', label }
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
              hovered.classList?.add(relativeAfterX(hovered, event) ? 'ea-tab-drop-after' : 'ea-tab-drop-before')
            } else {
              strip.classList?.add('ea-drop-strip')
            }
            return
          }
          const hoveredTab = target.closest?.('button[data-ea-tab="1"]')
          if (hoveredTab && isDraggableTab(hoveredTab)) {
            event.preventDefault()
            hoveredTab.classList?.add(relativeAfterX(hoveredTab, event) ? 'ea-tab-drop-after' : 'ea-tab-drop-before')
          }
          return
        }
        const row = target?.closest?.('button[data-ea-row="1"]')
        if (row) {
          if (dragging.kind === 'row') {
            event.preventDefault()
            row.classList?.add(relativeAfter(row, event) ? 'ea-drop-after' : 'ea-drop-before')
            return
          }
          if (movedEntry(dragging.label)) {
            event.preventDefault()
            row.classList?.add(relativeAfter(row, event) ? 'ea-drop-after' : 'ea-drop-before')
          }
          return
        }
        if (target === placeholder || target?.closest?.('[data-ea-placeholder="1"]')) {
          if (dragging.kind === 'tab' && movedEntry(dragging.label)) {
            event.preventDefault()
            placeholder?.classList.add('ea-drop-strip')
          }
        }
      }

      function reorderSidebar(label, target, after) {
        const visible = state.sidebarOrder.filter(item => !isMoved(item))
        state.sidebarOrder = moveRelative(visible, label, target, after)
        save()
        reconcile()
      }

      function reorderTabs(label, target, after) {
        state.tabOrder = moveRelative(state.tabOrder, label, target, after)
        save()
        reconcile()
      }

      function moveToTabs(label, target, after) {
        const entry = { label, id: panelIdFor(label) }
        state.sidebarOrder = state.sidebarOrder.filter(item => item !== label)
        state.moved = state.moved.concat([entry])
        const rest = state.tabOrder.filter(item => item !== label)
        if (target && rest.includes(target)) {
          state.tabOrder = moveRelative(rest, label, target, after)
        } else {
          state.tabOrder = rest.concat([label])
        }
        syncLaunchers()
        save()
        reconcile()
      }

      function moveToSidebar(label, target, after) {
        const entry = movedEntry(label)
        if (!entry) return
        state.moved = state.moved.filter(item => item.label !== label)
        state.tabOrder = state.tabOrder.filter(item => item !== label)
        const visible = state.sidebarOrder.filter(item => item !== label && !isMoved(item))
        state.sidebarOrder = target && visible.includes(target)
          ? moveRelative(visible, label, target, after)
          : visible.concat([label])
        disposeLauncher(label)
        save()
        reconcile()
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
            const hoveredLabel = hovered ? tabLabel(hovered) : null
            moveToTabs(dragging.label, hoveredLabel, hovered ? relativeAfterX(hovered, event) : false)
          } else if (hoveredTab && isDraggableTab(hoveredTab)) {
            reorderTabs(dragging.label, tabLabel(hoveredTab), relativeAfterX(hoveredTab, event))
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
        // 视图状态切回对话：ctx 上没有公开的 conversation 控制器，直接点官方的「对话」标签。
        launchSwitcher = () => {
          const tabs = tabButtons()
          if (tabs.length > 0) tabs[0].click()
        }
      }

      function startViewSlot() {
        return ctx.slots.inject('conversation.view', () => {
          viewSlotReady = true
          syncLaunchers()
        })
      }

      // 浮标贴主内容区左上角：侧栏宽度变化（收起、拖拽手柄）时跟着走。
      function chipInset() {
        let frame = document.querySelector('[data-slot="sidebar"]')
        while (frame && !(frame.style && frame.style.gridTemplateColumns)) frame = frame.parentElement
        let left = 16
        if (frame) {
          try {
            const first = String(getComputedStyle(frame).gridTemplateColumns || '').split(' ')[0] ?? ''
            const width = Number.parseFloat(first)
            if (Number.isFinite(width) && width > 0) left = Math.round(width) + 12
          } catch { /* 布局不可测量时退回默认值 */ }
        }
        return left
      }

      function startDom() {
        reconcile()
        try {
          observer = new MutationObserver(() => schedule())
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-label', 'aria-current', 'data-sidebar-collapsed'],
          })
        } catch (error) {
          recordError(error)
        }
        window.addEventListener?.('resize', schedule)
        document.addEventListener('dragstart', onDragStart, true)
        document.addEventListener('dragover', onDragOver, true)
        document.addEventListener('drop', onDrop, true)
        document.addEventListener('dragend', onDragEnd, true)
        schedule()
        return () => {
          observer?.disconnect()
          observer = null
          window.removeEventListener?.('resize', schedule)
          document.removeEventListener('dragstart', onDragStart, true)
          document.removeEventListener('dragover', onDragOver, true)
          document.removeEventListener('drop', onDrop, true)
          document.removeEventListener('dragend', onDragEnd, true)
          placeholder?.remove()
          placeholder = null
          for (const label of [...launchers.keys()]) disposeLauncher(label)
          mounted = false
        }
      }

      // ── 供设置页使用 ───────────────────────────────────────────────────────

      function settingsSnapshot() {
        return {
          sidebarRows: sidebarRows().length,
          tabLabels: Math.max(0, tabButtons().length - 1),
          moved: state.moved.map(entry => entry.label),
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
        reconcile()
      }

      // 标签行容量有限，搬入的标签一旦被截断进「...」菜单就没有可拖的 DOM 节点；
      // 这个方法是那种状态下的唯一可视化逃生口：全部还原到侧栏末尾。
      function restoreAll() {
        if (state.moved.length === 0) return
        const labels = state.moved.map(entry => entry.label)
        state.moved = []
        state.tabOrder = state.tabOrder.filter(item => !labels.includes(item))
        state.sidebarOrder = state.sidebarOrder.concat(labels.filter(label => !state.sidebarOrder.includes(label)))
        save()
        reconcile()
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
        startViewSlot,
        startDom,
        reconcile,
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
      const rows = snap.moved.map(label => h('li', { key: label, className: 'ea-item' },
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
        h('h3', { className: 'ea-subtitle' }, t('movedCount')),
        snap.moved.length === 0
          ? h('p', { className: 'ea-empty' }, t('movedEmpty'))
          : h('ul', { className: 'ea-list' }, rows),
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
    exports.name = 'entry-organizer'
    exports.__internals = { arrangeList, moveRelative, viewIdFor, labelText, createController, controller }
    return module.exports
  },
})
