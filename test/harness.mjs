/**
 * 测试用迷你 DOM + client bundle 加载器。
 *
 * 环境里没有 jsdom（profile 无该依赖、npm 也取不到），所以这里只实现
 * client.js 真正用到的那一小撮 DOM API：属性、classList、style、textContent、
 * 选择器（tag / #id / .class / [attr] / [attr="v"] 与逗号列表）、closest、
 * 冒泡与捕获派发、MutationObserver 空实现、localStorage 内存实现。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(HERE, '..', 'client.js');

// ── 选择器 ──────────────────────────────────────────────────────────────────

function parseSelector(selector) {
  return String(selector)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      let rest = part;
      let tag = '*';
      const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
      if (tagMatch) {
        tag = tagMatch[0].toUpperCase();
        rest = rest.slice(tagMatch[0].length);
      }
      const classes = [];
      const attrs = [];
      const re = /\[([^\]=]+)(?:="([^"]*)")?\]|\.([\w-]+)/g;
      let match;
      while ((match = re.exec(rest)) !== null) {
        if (match[3]) classes.push(match[3]);
        else attrs.push({ name: match[1], value: match[2] });
      }
      return { tag, classes, attrs };
    });
}

function matchPart(element, part) {
  if (part.tag !== '*' && element.tagName !== part.tag) return false;
  for (const name of part.classes) {
    if (!element._classes.has(name)) return false;
  }
  for (const attr of part.attrs) {
    const value = element.getAttribute(attr.name);
    if (attr.value === undefined) {
      if (value === null) return false;
    } else if (value !== attr.value) {
      return false;
    }
  }
  return true;
}

// ── 元素 ────────────────────────────────────────────────────────────────────

export class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.style = {};
    this._attrs = new Map();
    this._classes = new Set();
    this._listeners = [];
    this._text = '';
    this.nodeType = 1;
  }

  get className() {
    return [...this._classes].join(' ');
  }

  set className(value) {
    this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get classList() {
    const self = this;
    return {
      add: (...names) => names.forEach(name => self._classes.add(name)),
      remove: (...names) => names.forEach(name => self._classes.delete(name)),
      contains: name => self._classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !self._classes.has(name) : Boolean(force);
        if (on) self._classes.add(name);
        else self._classes.delete(name);
        return on;
      },
    };
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value);
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null;
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value));
  }

  removeAttribute(name) {
    this._attrs.delete(name);
  }

  hasAttribute(name) {
    return this._attrs.has(name);
  }

  get dataset() {
    const self = this;
    return new Proxy({}, {
      get: (_, key) => self.getAttribute('data-' + String(key).replace(/[A-Z]/g, m => '-' + m.toLowerCase())),
      set: (_, key, value) => {
        self.setAttribute('data-' + String(key).replace(/[A-Z]/g, m => '-' + m.toLowerCase()), String(value));
        return true;
      },
    });
  }

  appendChild(child) {
    if (child.parentElement) child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    if (child.parentElement) child.remove();
    const at = this.children.indexOf(reference);
    child.parentElement = this;
    this.children.splice(at < 0 ? this.children.length : at, 0, child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    const at = this.parentElement.children.indexOf(this);
    if (at >= 0) this.parentElement.children.splice(at, 1);
    this.parentElement = null;
  }

  contains(node) {
    let cursor = node;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parentElement;
    }
    return false;
  }

  matches(selector) {
    return parseSelector(selector).some(part => matchPart(this, part));
  }

  closest(selector) {
    let cursor = this;
    while (cursor) {
      if (cursor.matches?.(selector)) return cursor;
      cursor = cursor.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const parts = parseSelector(selector);
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (parts.some(part => matchPart(child, part))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, width: 200, height: 30, bottom: 30, right: 200 };
  }

  addEventListener(type, listener, options) {
    const capture = options === true || Boolean(options?.capture);
    this._listeners.push({ type, listener, capture });
  }

  removeEventListener(type, listener) {
    this._listeners = this._listeners.filter(entry => !(entry.type === type && entry.listener === listener));
  }

  dispatchEvent(event) {
    const path = [];
    let cursor = this;
    while (cursor) {
      path.push(cursor);
      cursor = cursor.parentElement;
    }
    event.target = this;
    const fire = (node, capture) => {
      for (const entry of [...node._listeners]) {
        if (entry.type !== event.type || entry.capture !== capture) continue;
        event.currentTarget = node;
        entry.listener(event);
      }
    };
    for (const node of [...path].reverse()) fire(node, true);
    for (const node of path) fire(node, false);
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent(makeEvent('click'));
  }
}

export class FakeDocument extends FakeElement {
  constructor() {
    super('#document');
    this.nodeType = 9;
    const html = new FakeElement('html');
    this.head = new FakeElement('head');
    this.body = new FakeElement('body');
    this.appendChild(html);
    html.appendChild(this.head);
    html.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

export function makeEvent(type, props = {}) {
  const event = {
    type,
    defaultPrevented: false,
    target: null,
    currentTarget: null,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() { },
    ...props,
  };
  return event;
}

export function makeDragEvent(type, props = {}) {
  const writes = [];
  return makeEvent(type, {
    clientX: 0,
    clientY: 0,
    dataTransfer: {
      effectAllowed: 'none',
      setData: (kind, value) => writes.push([kind, value]),
      getData: () => writes.length > 0 ? writes[writes.length - 1][1] : '',
    },
    ...props,
  });
}

// ── localStorage / MutationObserver ─────────────────────────────────────────

export function createStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    localStorage: {
      getItem: key => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: key => map.delete(key),
    },
  };
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe() { }

  disconnect() { }
}

// ── client bundle 加载 ──────────────────────────────────────────────────────

const REACT_STUB = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => { }],
  useEffect: effect => {
    effect();
  },
  useRef: value => ({ current: value }),
  useCallback: fn => fn,
};

const SOURCE = readFileSync(CLIENT_PATH, 'utf8');

export function loadClient({ document, storage } = {}) {
  const doc = document ?? new FakeDocument();
  const store = storage ?? createStorage();
  let loaded = null;
  const windowStub = {
    localStorage: store.localStorage,
    __ModuleLoader__: {
      load: definition => {
        loaded = definition.factory(name => {
          if (name === 'react') return REACT_STUB;
          throw new Error('unexpected require: ' + name);
        });
      },
    },
  };
  const context = createContext({
    window: windowStub,
    document: doc,
    console,
    queueMicrotask: fn => queueMicrotask(fn),
    setTimeout,
    MutationObserver: FakeMutationObserver,
  });
  runInContext(SOURCE, context, { filename: CLIENT_PATH });
  if (!loaded) throw new Error('client bundle did not call __ModuleLoader__.load');
  return { api: loaded, document: doc, storage: store };
}

export function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ── 假 ctx ──────────────────────────────────────────────────────────────────

export function createCtx({ panels = [], views = [] } = {}) {
  const state = { registered: [], selected: [], viewSlotReady: false };

  const slots = {
    entriesOfSlot(name) {
      if (name === 'sidebar.panellist') {
        return panels.map(panel => ({ options: { id: panel.id, label: panel.label } }));
      }
      if (name === 'conversation.view') {
        return views.map(view => ({ options: { id: view.id, label: view.label } }));
      }
      return [];
    },
    register(spec, Component) {
      const record = { spec, Component };
      state.registered.push(record);
      return () => {
        const at = state.registered.indexOf(record);
        if (at >= 0) state.registered.splice(at, 1);
      };
    },
    inject(name, factory) {
      factory();
      return () => { };
    },
    subscribe() {
      return () => { };
    },
  };

  const ctx = {
    slots,
    locale: {
      register() { },
      bind: () => key => key,
      subscribe: () => () => { },
    },
    effect(fn) {
      const disposer = fn();
      return typeof disposer === 'function' ? disposer : () => { };
    },
    layout: {
      selectPanel(panelId) {
        state.selected.push(panelId);
      },
    },
    logger: { debug() { }, warn() { } },
  };

  return { ctx, state };
}
