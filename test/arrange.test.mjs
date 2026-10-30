import assert from 'node:assert/strict';
import test from 'node:test';
/** 跨 vm realm 比较：先把结果归一化成当前 realm 的普通数据。 */
const eq = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

import { createStorage, loadClient } from './harness.mjs';

const KEY = 'dsh.entry-organizer.v1';
const LEGACY_KEY = 'dsh.entry-arrange.v1';

function internals(options) {
  const { api } = loadClient(options);
  return api.__internals;
}

test('arrangeList 保留已有相对顺序，并把新项追加在末尾', () => {
  const { arrangeList } = internals();
  eq(arrangeList(['a', 'b'], ['b', 'c']), ['b', 'c']);
  eq(arrangeList(['b', 'a', 'c'], ['a', 'b', 'c']), ['b', 'a', 'c']);
  eq(arrangeList([], ['x', 'y']), ['x', 'y']);
  eq(arrangeList(['gone', 'a'], ['a']), ['a']);
  eq(arrangeList(['a', 'a', 'b'], ['a', 'b']), ['a', 'b']);
});

test('moveRelative 在目标前/后插入，目标缺失时保持原样', () => {
  const { moveRelative } = internals();
  eq(moveRelative(['a', 'b', 'c'], 'c', 'a', false), ['c', 'a', 'b']);
  eq(moveRelative(['a', 'b', 'c'], 'a', 'c', true), ['b', 'c', 'a']);
  eq(moveRelative(['a', 'b', 'c'], 'a', 'c', false), ['b', 'a', 'c']);
  eq(moveRelative(['a', 'b'], 'a', 'b', false), ['a', 'b']);
  eq(moveRelative(['a'], 'a', 'missing', false), ['a']);
});

test('viewIdFor 稳定、带 ea- 前缀且不同 label 不同 id', () => {
  const { viewIdFor } = internals();
  const first = viewIdFor('阅读');
  assert.equal(first, viewIdFor('阅读'));
  assert.equal(viewIdFor('market'), viewIdFor('market'));
  assert.match(first, /^ea-[0-9a-z]+$/);
  assert.notEqual(viewIdFor('阅读'), viewIdFor('market'));
  assert.notEqual(viewIdFor('a'), viewIdFor('b'));
});

test('labelText 支持字符串、函数与异常降级', () => {
  const { labelText } = internals();
  assert.equal(labelText('阅读'), '阅读');
  assert.equal(labelText(() => '翻译'), '翻译');
  assert.equal(labelText(() => { throw new Error('boom'); }), null);
  assert.equal(labelText({ locale: 'zh', key: 'x' }), null);
  assert.equal(labelText(undefined), null);
  assert.equal(labelText(42), null);
});

test('无存储时状态为空', () => {
  const { controller } = internals();
  eq(controller.state.sidebarOrder, []);
  eq(controller.state.moved, []);
  eq(controller.state.tabOrder, []);
});

test('从合法存储恢复顺序与搬移集合', () => {
  const storage = createStorage({
    [KEY]: JSON.stringify({
      v: 1,
      sidebarOrder: ['市场', '洞察'],
      tabOrder: ['阅读', '洞察'],
      moved: [{ label: '洞察', id: 'dsh-context' }],
    }),
  });
  const { controller } = internals({ storage });
  eq(controller.state.sidebarOrder, ['市场', '洞察']);
  eq(controller.state.tabOrder, ['阅读', '洞察']);
  eq(controller.state.moved, [{ label: '洞察', id: 'dsh-context' }]);
});

test('损坏或异构的存储被安静忽略', () => {
  for (const raw of ['not json', '[]', '{"moved":"x","sidebarOrder":5}', '{"moved":[null,{"label":2},{"label":"ok"}]}']) {
    const { controller } = internals({ storage: createStorage({ [KEY]: raw }) });
    assert.ok(Array.isArray(controller.state.moved), raw);
    assert.ok(Array.isArray(controller.state.sidebarOrder), raw);
    assert.ok(controller.state.moved.every(entry => typeof entry.label === 'string'), raw);
  }
});

test('旧键 dsh.entry-arrange.v1 的状态迁移到新键', () => {
  const legacy = JSON.stringify({
    v: 1,
    sidebarOrder: ['市场', '洞察'],
    moved: [{ label: '洞察', id: 'dsh-context' }],
    tabOrder: ['阅读'],
  });
  const storage = createStorage({ [LEGACY_KEY]: legacy });
  const { controller } = internals({ storage });
  eq(controller.state.sidebarOrder, ['市场', '洞察']);
  eq(controller.state.tabOrder, ['阅读']);
  eq(controller.state.moved, [{ label: '洞察', id: 'dsh-context' }]);
  const written = JSON.parse(storage.map.get(KEY));
  eq(written.sidebarOrder, ['市场', '洞察']);
  eq(written.moved, [{ label: '洞察', id: 'dsh-context' }]);
});

test('新键优先于旧键，旧键不再回写', () => {
  const storage = createStorage({
    [KEY]: JSON.stringify({ v: 1, sidebarOrder: ['新'], tabOrder: [], moved: [] }),
    [LEGACY_KEY]: JSON.stringify({ v: 1, sidebarOrder: ['旧'], tabOrder: [], moved: [] }),
  });
  const { controller } = internals({ storage });
  eq(controller.state.sidebarOrder, ['新']);
  eq(JSON.parse(storage.map.get(KEY)).sidebarOrder, ['新']);
});
