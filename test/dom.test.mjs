import assert from 'node:assert/strict';
import test from 'node:test';
/** 跨 vm realm 比较：先把结果归一化成当前 realm 的普通数据。 */
const eq = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

import {
  FakeDocument,
  createCtx,
  createStorage,
  flush,
  loadClient,
  makeDragEvent,
  renderTree,
  textOf,
} from './harness.mjs';

const KEY = 'dsh.entry-organizer.v1';
/** v2 排序键：侧栏用 `p:<panel id>`，标签用 `v:<view id>`。 */
const P = id => 'p:' + id;
const V = id => 'v:' + id;

const PANELS = [
  { id: 'show-plugins', label: '插件管理' },
  { id: 'dsh-market', label: '市场' },
  { id: 'dsh-context', label: '洞察' },
];

const VIEWS = [
  { id: 'chat', label: '对话' },
  { id: 'read', label: '阅读' },
  { id: 'trajectory', label: '轨迹' },
];

function buildScene(options = {}) {
  const views = options.views ?? VIEWS;
  const document = new FakeDocument();

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', '全局面板');
  document.body.appendChild(nav);

  const rows = PANELS.map(panel => {
    const row = document.createElement('button');
    row.setAttribute('type', 'button');
    row.setAttribute('aria-label', panel.label);
    const glyph = document.createElement('span');
    glyph.setAttribute('data-slot', 'sidebar.panellist');
    const title = document.createElement('span');
    title.textContent = panel.label;
    row.appendChild(glyph);
    row.appendChild(title);
    nav.appendChild(row);
    return row;
  });

  const more = document.createElement('button');
  more.setAttribute('type', 'button');
  more.setAttribute('aria-label', '更多');
  more.setAttribute('aria-haspopup', 'menu');
  // 真实页面里「更多」被 Menu 组件根节点包裹，不是 nav 的直系 button；
  // wrapMore: false 用来覆盖直系 button 的兼容场景。
  let moreAnchor = more;
  if (options.wrapMore !== false) {
    moreAnchor = document.createElement('div');
    moreAnchor.className = 'more-anchor';
    moreAnchor.appendChild(more);
  }
  nav.appendChild(moreAnchor);

  const strip = document.createElement('div');
  strip.setAttribute('data-conversation-tabs', '');
  const tabs = views.map(view => {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.textContent = view.label;
    strip.appendChild(tab);
    return tab;
  });
  document.body.appendChild(strip);

  return { document, nav, rows, more, moreAnchor, strip, tabs };
}

function boot(options = {}) {
  const scene = buildScene(options);
  const storage = options.storage ?? createStorage();
  const views = options.views ?? VIEWS;
  const panels = options.panels ?? PANELS;
  const { ctx, state } = createCtx({ panels, views });
  const { api, window, observers } = loadClient({ document: scene.document, storage });
  api.apply(ctx);
  const controller = api.__internals.controller;
  return { ...scene, api, window, observers, ctx, state, storage, controller, panels };
}

function drag(target, props) {
  const event = makeDragEvent('dragstart', props);
  target.dispatchEvent(event);
  return event;
}

function hover(target, props) {
  const event = makeDragEvent('dragover', props);
  target.dispatchEvent(event);
  return event;
}

function drop(target, props) {
  const event = makeDragEvent('drop', props);
  target.dispatchEvent(event);
  return event;
}

test('apply 后：侧栏行可拖拽且按注册顺序编号，「更多」排在最后，空位隐藏', async () => {
  const scene = boot();
  await flush();

  eq(scene.controller.state.sidebarOrder, [P('show-plugins'), P('dsh-market'), P('dsh-context')]);
  for (const [index, row] of scene.rows.entries()) {
    assert.equal(row.getAttribute('data-ea-row'), '1', `row ${index} 应标记为可拖拽行`);
    assert.equal(row.getAttribute('draggable'), 'true');
    assert.equal(row.style.order, String(index + 1));
  }
  // 真实页面里「更多」被 Menu 根节点包裹：排序必须写在 nav 的直系子节点上，
  // 写在内层 button 上 flex order 不生效（回归：占位框跑到「更多」前面）。
  assert.equal(scene.moreAnchor.style.order, '4', '「更多」容器应排在面板条目之后');
  assert.equal(scene.more.style.order, undefined, '排序不应写在内层按钮上');

  const placeholder = scene.nav.querySelector('[data-ea-placeholder="1"]');
  assert.ok(placeholder, '应注入空位占位');
  assert.equal(placeholder.getAttribute('data-ea-show'), '0');
  // 占位框排在「更多」之后（回归：占位框跑到「更多」上方）。
  assert.equal(placeholder.style.order, '5');
});

test('apply 后：标签行除「对话」外可排序，「对话」固定首位且不可拖拽', async () => {
  const scene = boot();
  await flush();

  eq(scene.controller.state.tabOrder, [V('read'), V('trajectory')]);
  assert.equal(scene.tabs[0].style.order, '0');
  assert.equal(scene.tabs[0].getAttribute('draggable'), null);
  assert.equal(scene.tabs[0].getAttribute('data-ea-tab'), null);
  assert.equal(scene.tabs[1].style.order, '1');
  assert.equal(scene.tabs[2].style.order, '2');
  assert.equal(scene.tabs[1].getAttribute('data-ea-tab'), '1');
  assert.equal(scene.tabs[1].getAttribute('data-ea-label'), '阅读');
});

test('顶部标签横向拖拽：按 X 中点决定前插还是后插（回归：拖两三次才生效）', async () => {
  const scene = boot();
  await flush();

  // 往右拖：落点在「轨迹」右半边 → 插到它后面
  drag(scene.tabs[1], { clientX: 10 });
  hover(scene.tabs[2], { clientX: 150 });
  drop(scene.tabs[2], { clientX: 150 });
  eq(scene.controller.state.tabOrder, [V('trajectory'), V('read')]);
  assert.equal(scene.tabs[2].style.order, '1');
  assert.equal(scene.tabs[1].style.order, '2');

  // 往左拖：落点在「轨迹」左半边 → 插到它前面，顺序复原
  drag(scene.tabs[1], { clientX: 150 });
  hover(scene.tabs[2], { clientX: 20 });
  drop(scene.tabs[2], { clientX: 20 });
  eq(scene.controller.state.tabOrder, [V('read'), V('trajectory')]);
  assert.equal(scene.tabs[1].style.order, '1');
  assert.equal(scene.tabs[2].style.order, '2');
});

test('行内拖拽：把「洞察」拖到「插件管理」上方后顺序与 order 同步更新', async () => {
  const scene = boot();
  await flush();

  drag(scene.rows[2], { clientY: 10 });
  hover(scene.rows[0], { clientY: 5 });
  drop(scene.rows[0], { clientY: 5 });

  eq(scene.controller.state.sidebarOrder, [P('dsh-context'), P('show-plugins'), P('dsh-market')]);
  assert.equal(scene.rows[2].style.order, '1');
  assert.equal(scene.rows[0].style.order, '2');
  assert.equal(scene.rows[1].style.order, '3');
});

test('把侧栏行搬到标签行：行隐藏、注册真实 conversation.view、状态落盘', async () => {
  const scene = boot();
  await flush();

  drag(scene.rows[1], { clientY: 10 });
  hover(scene.strip, { clientY: 10 });
  drop(scene.strip, { clientY: 10 });

  eq(scene.controller.state.moved, [{ id: 'dsh-market', label: '市场' }]);
  eq(scene.controller.state.sidebarOrder, [P('show-plugins'), P('dsh-context')]);
  eq(scene.controller.state.tabOrder.slice(0, 2), [V('read'), V('trajectory')]);
  assert.match(scene.controller.state.tabOrder[2], /^v:/, '启动器标签的排序键应有稳定前缀');
  assert.equal(scene.rows[1].style.display, 'none');

  const launcher = scene.state.registered.find(record => record.spec.name === 'conversation.view');
  assert.ok(launcher, '应注册一个 conversation.view 启动器');
  assert.equal(launcher.spec.label, '市场');
  assert.match(launcher.spec.id, /^ea-[0-9a-z]+$/);
  assert.equal(launcher.spec.locale, 'plugin.entryOrganizer');

  const placeholder = scene.nav.querySelector('[data-ea-placeholder="1"]');
  assert.equal(placeholder.getAttribute('data-ea-show'), '1');

  const saved = JSON.parse(scene.storage.map.get(KEY));
  assert.equal(saved.v, 2);
  eq(saved.moved, [{ id: 'dsh-market', label: '市场' }]);

  // 官方把启动器渲染成真实标签后，reconcile 会给它同样的拖拽标记与排序。
  const launcherTab = scene.document.createElement('button');
  launcherTab.setAttribute('role', 'tab');
  launcherTab.textContent = '市场';
  scene.strip.appendChild(launcherTab);
  scene.controller.__reconcile();

  assert.equal(launcherTab.getAttribute('data-ea-tab'), '1');
  assert.equal(launcherTab.getAttribute('data-ea-label'), '市场');
  assert.equal(launcherTab.style.order, '3');
});

test('点击启动器标签走官方链路：切回对话 + selectPanel 打开对应面板 + 出现返回浮标', async () => {
  const scene = boot();
  await flush();

  drag(scene.rows[1], { clientY: 10 });
  hover(scene.strip, { clientY: 10 });
  drop(scene.strip, { clientY: 10 });

  const launcher = scene.state.registered.find(record => record.spec.name === 'conversation.view');
  launcher.Component();

  // 打开面板前先把会话视图复位到「对话」：假 ctx 把这一步记成 selectPanel(null)，随后才打开目标面板。
  eq(scene.state.selected, [null, 'dsh-market']);
  assert.equal(scene.controller.chip, true);

  // 面板打开后官方行带 aria-current="page"，但该行已被搬走 → 浮标保持可见
  scene.rows[1].setAttribute('aria-current', 'page');
  scene.controller.__reconcile();
  assert.equal(scene.controller.chip, true);

  scene.controller.returnToConversation();
  eq(scene.state.selected, [null, 'dsh-market', null]);
  assert.equal(scene.controller.chip, false);
});

test('把启动器标签搬回侧栏：行恢复显示、启动器注销、顺序落到目标位置', async () => {
  const scene = boot();
  await flush();

  drag(scene.rows[1], { clientY: 10 });
  hover(scene.strip, { clientY: 10 });
  drop(scene.strip, { clientY: 10 });

  const launcherTab = scene.document.createElement('button');
  launcherTab.setAttribute('role', 'tab');
  launcherTab.textContent = '市场';
  scene.strip.appendChild(launcherTab);
  scene.controller.__reconcile();

  drag(launcherTab, { clientY: 10 });
  hover(scene.rows[0], { clientY: 25 });
  drop(scene.rows[0], { clientY: 25 });

  // 官方会随启动器注销一起卸载该标签；同步 DOM 后再核对最终状态
  launcherTab.remove();
  scene.controller.__reconcile();

  eq(scene.controller.state.moved, []);
  assert.equal(scene.rows[1].style.display, '');
  eq(scene.controller.state.sidebarOrder, [P('show-plugins'), P('dsh-market'), P('dsh-context')]);
  assert.equal(scene.rows[1].style.order, '2');
  assert.equal(
    scene.state.registered.some(record => record.spec.name === 'conversation.view'),
    false,
    '搬回后启动器视图应被注销',
  );
  eq(scene.controller.state.tabOrder, [V('read'), V('trajectory')]);
});

test('设置页恢复默认：顺序与搬移清空并重新落盘', async () => {
  const scene = boot();
  await flush();

  drag(scene.rows[2], { clientY: 10 });
  hover(scene.rows[0], { clientY: 5 });
  drop(scene.rows[0], { clientY: 5 });
  drag(scene.rows[1], { clientY: 10 });
  hover(scene.strip, { clientY: 10 });
  drop(scene.strip, { clientY: 10 });

  scene.controller.reset();

  eq(scene.controller.state.sidebarOrder, [P('show-plugins'), P('dsh-market'), P('dsh-context')]);
  eq(scene.controller.state.moved, []);
  eq(scene.controller.state.tabOrder, [V('read'), V('trajectory')]);
  assert.equal(scene.rows[1].style.display, '');
  const saved = JSON.parse(scene.storage.map.get(KEY));
  eq(saved.moved, []);
});

test('重启后从存储恢复：搬走的行仍隐藏，启动器仍会重新注册', async () => {
  const storage = createStorage();
  const first = boot({ storage });
  await flush();
  drag(first.rows[1], { clientY: 10 });
  hover(first.strip, { clientY: 10 });
  drop(first.strip, { clientY: 10 });

  const second = boot({ storage });
  await flush();

  eq(second.controller.state.moved, [{ id: 'dsh-market', label: '市场' }]);
  assert.equal(second.rows[1].style.display, 'none');
  assert.ok(
    second.state.registered.some(record => record.spec.name === 'conversation.view' && record.spec.label === '市场'),
    '重启后应重新注册启动器标签',
  );

  const launcherTab = second.document.createElement('button');
  launcherTab.setAttribute('role', 'tab');
  launcherTab.textContent = '市场';
  second.strip.appendChild(launcherTab);
  second.controller.__reconcile();
  assert.equal(launcherTab.style.order, '3');
});

test('「...」菜单提供一键还原：搬入的标签被截断后仍能全部移回侧栏', async () => {
  const scene = boot();
  await flush();

  const action = scene.state.registered.find(record => record.spec.id === 'entry-organizer-restore');
  assert.ok(action, '应在「更多会话视图」菜单里注册还原入口');
  assert.equal(action.spec.name, 'conversation.session.header.views.actions');

  drag(scene.rows[1], { clientY: 10 });
  hover(scene.strip, { clientY: 10 });
  drop(scene.strip, { clientY: 10 });
  assert.ok(scene.state.registered.some(record => record.spec.name === 'conversation.view'));

  // 官方渲染出启动器标签；随后标签行容量不足，它被截断进「...」菜单（从标签行移除）。
  const launcherTab = scene.document.createElement('button');
  launcherTab.setAttribute('role', 'tab');
  launcherTab.textContent = '市场';
  scene.strip.appendChild(launcherTab);
  scene.controller.__reconcile();
  launcherTab.remove();
  scene.controller.__reconcile();

  const node = action.Component();
  assert.ok(node, '有搬移项时菜单入口应渲染');
  node.props.onClick();

  eq(scene.controller.state.moved, []);
  eq(scene.controller.state.sidebarOrder, [P('show-plugins'), P('dsh-context'), P('dsh-market')]);
  assert.equal(scene.rows[1].style.display, '');
  assert.equal(
    scene.state.registered.some(record => record.spec.name === 'conversation.view'),
    false,
    '还原后应注销启动器',
  );
  const saved = JSON.parse(scene.storage.map.get(KEY));
  eq(saved.moved, []);
});

test('「更多」是 nav 直系按钮时同样排到最后（兼容旧结构）', async () => {
  const scene = boot({ wrapMore: false });
  await flush();

  assert.equal(scene.more.style.order, '4');
  assert.equal(scene.nav.querySelector('[data-ea-placeholder="1"]').style.order, '5');
});

test('页面残留的陌生占位框会被接管并去重，侧栏只保留一个（回归：出现两个虚线空位）', async () => {
  const scene = buildScene();
  // 模拟热加载/旧实例未卸载留下的两个孤儿占位框。
  for (let index = 0; index < 2; index++) {
    const stray = scene.document.createElement('div');
    stray.className = 'ea-placeholder';
    stray.setAttribute('data-ea-placeholder', '1');
    stray.textContent = '拖到这里，搬回侧栏';
    scene.nav.appendChild(stray);
  }

  const storage = createStorage();
  const { ctx } = createCtx({ panels: PANELS, views: VIEWS });
  const { api } = loadClient({ document: scene.document, storage });
  api.apply(ctx);
  await flush();

  const placeholders = scene.document.querySelectorAll('[data-ea-placeholder="1"]');
  assert.equal(placeholders.length, 1, '任何时刻只应存在一个占位框');
  assert.ok(scene.nav.contains(placeholders[0]), '保留下来的占位框应挂在侧栏 nav 内');
  assert.equal(placeholders[0].getAttribute('data-ea-show'), '0');
  assert.equal(placeholders[0].style.order, '5');
});

test('首标签标记每轮重算：旧的 data-ea-fixed 不会被残留（回归：标签计数偏小）', async () => {
  const scene = boot();
  await flush();

  // 模拟上一轮误标：把「不可拖拽」标记留在第二个标签上。
  scene.tabs[1].setAttribute('data-ea-fixed', '1');
  scene.controller.reconcile();
  await flush();

  assert.equal(scene.tabs[0].getAttribute('data-ea-fixed'), '1');
  assert.ok(!scene.tabs[1].getAttribute('data-ea-fixed'), '第二轮标签不应保留固定标记');
  assert.ok(!scene.tabs[2].getAttribute('data-ea-fixed'), '第三轮标签不应保留固定标记');
  assert.equal(scene.controller.settingsSnapshot().tabLabels, 2);
});

test('空标签行不会让后续行排序错位（回归：过滤后下标错配 rows）', async () => {
  const scene = boot();
  await flush();

  // 宿主某些面板行没有 aria-label、内部也没有文本：label 为空的行必须整行跳过，
  // 而不是让后面每一行的 order 都整体前移一位。
  const ghost = scene.document.createElement('button');
  ghost.setAttribute('type', 'button');
  const glyph = scene.document.createElement('span');
  glyph.setAttribute('data-slot', 'sidebar.panellist');
  ghost.appendChild(glyph);
  scene.nav.appendChild(ghost);

  scene.controller.__reconcile();

  eq(scene.controller.state.sidebarOrder, [P('show-plugins'), P('dsh-market'), P('dsh-context')]);
  assert.equal(scene.rows[0].style.order, '1');
  assert.equal(scene.rows[1].style.order, '2');
  assert.equal(scene.rows[2].style.order, '3');
  assert.equal(ghost.getAttribute('data-ea-row'), null, '空标签行不应被当作可拖拽行');
});

test('注册表里已不存在的搬移项会被清理，不再产生幽灵启动器（回归）', async () => {
  const storage = createStorage({
    [KEY]: JSON.stringify({
      v: 2,
      sidebarOrder: [],
      tabOrder: [],
      moved: [{ id: 'gone', label: '幽灵面板' }],
    }),
  });
  const scene = boot({ storage });
  await flush();
  // 启动宽限期内不判幽灵；模拟时间过去后应清掉。
  scene.controller.setPruneGrace(0);
  scene.controller.__reconcile();

  eq(scene.controller.state.moved, []);
  assert.equal(
    scene.state.registered.some(record => record.spec.name === 'conversation.view'),
    false,
    '不存在的面板不应注册启动器',
  );
  eq(JSON.parse(scene.storage.map.get(KEY)).moved, []);
});

test('拖拽后的顺序立即落盘，不依赖宿主再次触发同步（回归：顺序不落盘）', async () => {
  const scene = boot();
  await flush();

  drag(scene.rows[2], { clientY: 10 });
  hover(scene.rows[0], { clientY: 5 });
  drop(scene.rows[0], { clientY: 5 });

  const saved = JSON.parse(scene.storage.map.get(KEY));
  assert.equal(saved.v, 2);
  eq(saved.sidebarOrder, [P('dsh-context'), P('show-plugins'), P('dsh-market')]);
});

test('设置页 ↑/↓ 等效操作能调整顺序并落盘（键盘/触屏可达）', async () => {
  const scene = boot();
  await flush();

  scene.controller.nudgeSidebar('洞察', -1);
  eq(scene.controller.state.sidebarOrder, [P('show-plugins'), P('dsh-context'), P('dsh-market')]);
  assert.equal(scene.rows[2].style.order, '2');
  assert.equal(scene.rows[1].style.order, '3');

  scene.controller.nudgeTab('轨迹', -1);
  eq(scene.controller.state.tabOrder, [V('trajectory'), V('read')]);
  eq(JSON.parse(scene.storage.map.get(KEY)).tabOrder, [V('trajectory'), V('read')]);
});

test('其他窗口改动存储时实时重载（回归：多窗口不同步）', async () => {
  const scene = boot();
  await flush();

  scene.storage.localStorage.setItem(KEY, JSON.stringify({
    v: 2,
    sidebarOrder: [P('dsh-context'), P('show-plugins'), P('dsh-market')],
    tabOrder: [V('trajectory'), V('read')],
    moved: [],
  }));
  scene.window.dispatchEvent({ type: 'storage', key: KEY });
  await flush();

  eq(scene.controller.state.sidebarOrder, [P('dsh-context'), P('show-plugins'), P('dsh-market')]);
  eq(scene.controller.state.tabOrder, [V('trajectory'), V('read')]);
  assert.equal(scene.rows[2].style.order, '1');
  assert.equal(scene.rows[0].style.order, '2');
});

test('设置页把顺序与搬移都渲染成可操作列表（组件渲染回归）', async () => {
  const scene = boot();
  await flush();

  drag(scene.rows[1], { clientY: 10 });
  hover(scene.strip, { clientY: 10 });
  drop(scene.strip, { clientY: 10 });

  const view = renderTree(scene.api.__internals.SettingsPage);
  assert.equal(view.type, 'div');
  assert.equal(view.props.className, 'ea-page');

  const buttons = [];
  const walk = node => {
    if (node === null || node === undefined || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.type === 'button') buttons.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(view);
  assert.ok(buttons.length >= 3, '应渲染 ↑/↓ 与「移回侧栏」按钮');
  assert.ok(buttons.every(button => typeof button.props.onClick === 'function'), '按钮都应有可执行操作');
  assert.ok(textOf(view).includes('orderHint'), '应渲染键盘/触屏操作提示');
});

test('浮标组件只在打开被搬走的面板时渲染（组件渲染回归）', async () => {
  const scene = boot();
  await flush();

  assert.equal(renderTree(scene.api.__internals.ReturnChip), null, '初始不显示浮标');

  drag(scene.rows[1], { clientY: 10 });
  hover(scene.strip, { clientY: 10 });
  drop(scene.strip, { clientY: 10 });
  const launcher = scene.state.registered.find(record => record.spec.name === 'conversation.view');
  launcher.Component();

  const chip = renderTree(scene.api.__internals.ReturnChip);
  assert.ok(chip, '打开被搬走的面板后应显示浮标');
  assert.equal(chip.props.className, 'ea-chip');
  assert.ok(typeof chip.props.onClick === 'function');
  // 浮标横向定位必须落到像素值上（回归：chipInset 读不到侧栏宽度时会 NaN/空串）。
  assert.match(String(chip.props.style?.insetInlineStart ?? ''), /^\d+px$/, '浮标应带像素定位');
});

test('同名不同 id 的标签各占一个位置，不会互相顶替（回归：重复「上下文」）', async () => {
  // 真实宿主里 dsh-context 与 billion-context 都注册了文案为「上下文」的 conversation.view，
  // 但 id 分别是 context / bili-context：只按文案反查 id 会让两行共用一个排序键。
  const views = [
    { id: 'chat', label: '对话' },
    { id: 'read', label: '阅读' },
    { id: 'context', label: '上下文' },
    { id: 'bili-context', label: '上下文' },
  ];
  const scene = boot({ views });
  await flush();

  assert.equal(scene.tabs[2].getAttribute('data-ea-tabkey'), V('context'));
  assert.equal(scene.tabs[3].getAttribute('data-ea-tabkey'), V('bili-context'));
  assert.notEqual(scene.tabs[2].style.order, scene.tabs[3].style.order, '两行必须各占一个顺序');

  const labels = scene.controller.settingsSnapshot().tabList.map(item => item.label);
  eq(labels, ['阅读', '上下文', '上下文']);

  // 只上移第一行「上下文」：它换到阅读前面，另一个「上下文」保持原位，标签数量不变。
  scene.controller.nudgeTab('上下文', -1, 0);
  await flush();
  eq(scene.controller.state.tabOrder, [V('context'), V('read'), V('bili-context')]);
  assert.equal(scene.tabs.length, 4, '上移不应凭空多出标签');
});

test('启动时面板插件还没注册完，合法搬移不会被当幽灵删掉（回归：重启后搬移消失）', async () => {
  const storage = createStorage({
    [KEY]: JSON.stringify({
      v: 2,
      sidebarOrder: [],
      tabOrder: [],
      moved: [{ id: 'dsh-market', label: '市场' }],
    }),
  });
  // registry 里暂时只有另外两个面板（模拟面板插件比本插件晚 apply）
  const panels = PANELS.filter(panel => panel.id !== 'dsh-market');
  const scene = boot({ storage, panels });
  await flush();

  eq(scene.controller.state.moved, [{ id: 'dsh-market', label: '市场' }], '启动宽限期内不能删搬移');
  eq(JSON.parse(scene.storage.map.get(KEY)).moved, [{ id: 'dsh-market', label: '市场' }]);

  // 面板稍后注册：搬移项仍保留，并补注册启动器
  panels.push(PANELS.find(panel => panel.id === 'dsh-market'));
  scene.controller.__reconcile();
  await flush();
  eq(scene.controller.state.moved, [{ id: 'dsh-market', label: '市场' }]);
  assert.equal(
    scene.state.registered.some(record => record.spec.name === 'conversation.view'),
    true,
    '面板晚注册后应补注册启动器',
  );
});

test('侧栏行暂时从 DOM 消失时，不会把已存侧栏顺序裁掉并落盘（回归：顺序丢失）', async () => {
  const storage = createStorage({
    [KEY]: JSON.stringify({
      v: 2,
      sidebarOrder: [P('dsh-context'), P('show-plugins'), P('dsh-market')],
      tabOrder: [],
      moved: [],
    }),
  });
  const scene = boot({ storage });
  await flush();

  // 宿主重渲染 / 侧栏收起：行暂时从 DOM 消失
  for (const row of scene.rows) row.remove();
  scene.controller.setPruneGrace(0);
  scene.controller.__reconcile();

  eq(scene.controller.state.sidebarOrder, [P('dsh-context'), P('show-plugins'), P('dsh-market')]);
  eq(JSON.parse(scene.storage.map.get(KEY)).sidebarOrder, [P('dsh-context'), P('show-plugins'), P('dsh-market')]);
});

test('dragover 会阻止默认行为，否则浏览器不会派发 drop（回归：preventDefault 删掉也能假绿）', async () => {
  const scene = boot();
  await flush();

  drag(scene.rows[2], { clientY: 10 });
  const over = hover(scene.rows[0], { clientY: 5 });
  assert.equal(over.defaultPrevented, true, 'dragover 必须 preventDefault');

  drop(scene.rows[0], { clientY: 5 });
  assert.equal(scene.rows[2].style.order, '1', '拖到第一行上方后应排到最前');
});

test('同步接线：MutationObserver 挂在 body 上并按属性过滤', async () => {
  const scene = boot();
  await flush();
  assert.equal(scene.observers.length, 1, '应创建且只创建一个 MutationObserver');
  const observer = scene.observers[0];
  assert.equal(observer.target, scene.document.body);
  assert.equal(observer.options?.childList, true);
  assert.equal(observer.options?.subtree, true);
  assert.ok(observer.options?.attributeFilter?.includes('aria-label'), '应过滤标签文案变化');
  assert.ok(observer.options?.attributeFilter?.includes('data-sidebar-collapsed'), '应过滤侧栏折叠变化');
  assert.equal(observer.disconnected, false);
});

test('useController 订阅在 publish 时触发，取消订阅后不再收到通知', async () => {
  const scene = boot();
  await flush();
  const seen = [];
  const off = scene.controller.subscribe(() => seen.push(1));
  scene.controller.nudgeSidebar('洞察', -1);
  const count = seen.length;
  assert.ok(count > 0, 'publish 应通知订阅者');
  off();
  scene.controller.nudgeSidebar('洞察', 1);
  assert.equal(seen.length, count, '取消订阅后不应再收到通知');
});

test('conversation.view 的 inject 回调返回 disposer，卸载时注销启动器', async () => {
  const scene = boot();
  await flush();
  drag(scene.rows[1], { clientY: 10 });
  hover(scene.strip, { clientY: 10 });
  drop(scene.strip, { clientY: 10 });

  const entry = scene.state.injections.find(item => item.name === 'conversation.view');
  assert.ok(entry, '应声明 conversation.view 的注入');
  assert.equal(typeof entry.disposer, 'function', 'inject 回调必须返回同步 disposer');
  assert.equal(
    scene.state.registered.some(record => record.spec.name === 'conversation.view'),
    true,
  );
  entry.disposer();
  assert.equal(
    scene.state.registered.some(record => record.spec.name === 'conversation.view'),
    false,
    'disposer 应注销启动器',
  );
});

test('打开搬入标签前先把会话视图复位到「对话」（回归：返回对话又立刻重开面板）', async () => {
  const scene = boot();
  await flush();
  drag(scene.rows[1], { clientY: 10 });
  hover(scene.strip, { clientY: 10 });
  drop(scene.strip, { clientY: 10 });

  const launcher = scene.state.registered.find(record => record.spec.name === 'conversation.view');
  const openView = [];
  launcher.Component({ openView: viewId => openView.push(viewId) });
  await flush();

  eq(openView, ['chat']);
  eq(scene.state.selected, ['dsh-market']);
});
