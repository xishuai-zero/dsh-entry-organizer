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
} from './harness.mjs';

const KEY = 'dsh.entry-organizer.v1';

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

function buildScene() {
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
  nav.appendChild(more);

  const strip = document.createElement('div');
  strip.setAttribute('data-conversation-tabs', '');
  const tabs = VIEWS.map(view => {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.textContent = view.label;
    strip.appendChild(tab);
    return tab;
  });
  document.body.appendChild(strip);

  return { document, nav, rows, more, strip, tabs };
}

function boot(options = {}) {
  const scene = buildScene();
  const storage = options.storage ?? createStorage();
  const { ctx, state } = createCtx({ panels: PANELS, views: VIEWS });
  const { api } = loadClient({ document: scene.document, storage });
  api.apply(ctx);
  const controller = api.__internals.controller;
  return { ...scene, api, ctx, state, storage, controller };
}

function drag(target, props) {
  target.dispatchEvent(makeDragEvent('dragstart', props));
}

function hover(target, props) {
  target.dispatchEvent(makeDragEvent('dragover', props));
}

function drop(target, props) {
  target.dispatchEvent(makeDragEvent('drop', props));
}

test('apply 后：侧栏行可拖拽且按注册顺序编号，「更多」排在最后，空位隐藏', async () => {
  const scene = boot();
  await flush();

  eq(scene.controller.state.sidebarOrder, ['插件管理', '市场', '洞察']);
  for (const [index, row] of scene.rows.entries()) {
    assert.equal(row.getAttribute('data-ea-row'), '1', `row ${index} 应标记为可拖拽行`);
    assert.equal(row.getAttribute('draggable'), 'true');
    assert.equal(row.style.order, String(index + 1));
  }
  assert.equal(scene.more.style.order, '10000');

  const placeholder = scene.nav.querySelector('[data-ea-placeholder="1"]');
  assert.ok(placeholder, '应注入空位占位');
  assert.equal(placeholder.getAttribute('data-ea-show'), '0');
  assert.equal(placeholder.style.order, '4');
});

test('apply 后：标签行除「对话」外可排序，「对话」固定首位且不可拖拽', async () => {
  const scene = boot();
  await flush();

  eq(scene.controller.state.tabOrder, ['阅读', '轨迹']);
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
  eq(scene.controller.state.tabOrder, ['轨迹', '阅读']);
  assert.equal(scene.tabs[2].style.order, '1');
  assert.equal(scene.tabs[1].style.order, '2');

  // 往左拖：落点在「轨迹」左半边 → 插到它前面，顺序复原
  drag(scene.tabs[1], { clientX: 150 });
  hover(scene.tabs[2], { clientX: 20 });
  drop(scene.tabs[2], { clientX: 20 });
  eq(scene.controller.state.tabOrder, ['阅读', '轨迹']);
  assert.equal(scene.tabs[1].style.order, '1');
  assert.equal(scene.tabs[2].style.order, '2');
});

test('行内拖拽：把「洞察」拖到「插件管理」上方后顺序与 order 同步更新', async () => {
  const scene = boot();
  await flush();

  drag(scene.rows[2], { clientY: 10 });
  hover(scene.rows[0], { clientY: 5 });
  drop(scene.rows[0], { clientY: 5 });

  eq(scene.controller.state.sidebarOrder, ['洞察', '插件管理', '市场']);
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

  eq(scene.controller.state.moved, [{ label: '市场', id: 'dsh-market' }]);
  eq(scene.controller.state.sidebarOrder, ['插件管理', '洞察']);
  eq(scene.controller.state.tabOrder, ['阅读', '轨迹', '市场']);
  assert.equal(scene.rows[1].style.display, 'none');

  const launcher = scene.state.registered.find(record => record.spec.name === 'conversation.view');
  assert.ok(launcher, '应注册一个 conversation.view 启动器');
  assert.equal(launcher.spec.label, '市场');
  assert.match(launcher.spec.id, /^ea-[0-9a-z]+$/);
  assert.equal(launcher.spec.locale, 'plugin.entryOrganizer');

  const placeholder = scene.nav.querySelector('[data-ea-placeholder="1"]');
  assert.equal(placeholder.getAttribute('data-ea-show'), '1');

  const saved = JSON.parse(scene.storage.map.get(KEY));
  assert.equal(saved.v, 1);
  eq(saved.moved, [{ label: '市场', id: 'dsh-market' }]);

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

  eq(scene.state.selected, ['dsh-market']);
  assert.equal(scene.controller.chip, true);

  // 面板打开后官方行带 aria-current="page"，但该行已被搬走 → 浮标保持可见
  scene.rows[1].setAttribute('aria-current', 'page');
  scene.controller.__reconcile();
  assert.equal(scene.controller.chip, true);

  scene.controller.returnToConversation();
  eq(scene.state.selected, ['dsh-market', null]);
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
  eq(scene.controller.state.sidebarOrder, ['插件管理', '市场', '洞察']);
  assert.equal(scene.rows[1].style.order, '2');
  assert.equal(
    scene.state.registered.some(record => record.spec.name === 'conversation.view'),
    false,
    '搬回后启动器视图应被注销',
  );
  eq(scene.controller.state.tabOrder, ['阅读', '轨迹']);
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

  eq(scene.controller.state.sidebarOrder, ['插件管理', '市场', '洞察']);
  eq(scene.controller.state.moved, []);
  eq(scene.controller.state.tabOrder, ['阅读', '轨迹']);
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

  eq(second.controller.state.moved, [{ label: '市场', id: 'dsh-market' }]);
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
  eq(scene.controller.state.sidebarOrder, ['插件管理', '洞察', '市场']);
  assert.equal(scene.rows[1].style.display, '');
  assert.equal(
    scene.state.registered.some(record => record.spec.name === 'conversation.view'),
    false,
    '还原后应注销启动器',
  );
  const saved = JSON.parse(scene.storage.map.get(KEY));
  eq(saved.moved, []);
});
