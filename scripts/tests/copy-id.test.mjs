#!/usr/bin/env node
// REQ-20260906-006：通过实际卡片/详情渲染与按钮事件验证显式复制入口。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 只模拟本次交互用到的 DOM：复制按钮、单号、冒泡和临时文本域。
function element() {
  const cache = new Map(), classes = new Set();
  return {
    innerHTML: '', textContent: '', dataset: {}, listeners: {}, disabled: false, children: [], style: {},
    classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle() {} },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelectorAll(selector) {
      if (selector !== '[data-copy-id]') return [];
      return [...this.innerHTML.matchAll(/<button\b([^>]*data-copy-id="([^"]+)"[^>]*)>([^<]*)<\/button>/g)].map((m) => {
        if (!cache.has(m[2])) {
          const button = element();
          button.dataset.copyId = m[2]; button.textContent = m[3]; button.parent = this; button.attributes = m[1];
          button.title = /title="([^"]*)"/.exec(m[1])?.[1] || ''; // BUG-20260910-007：图标复制按钮反馈回写 title
          // BUG-20260910-007：按 class 属性初始化 classList（copyId 据此识别 icon-act 图标按钮）
          for (const c of (/class="([^"]*)"/.exec(m[1])?.[1] || '').split(/\s+/).filter(Boolean)) button.classList.add(c);
          cache.set(m[2], button);
        }
        return cache.get(m[2]);
      });
    },
    querySelector(selector) {
      if (selector === '[data-copy-id]') return this.querySelectorAll(selector)[0] || null;
      if (!cache.has(selector)) {
        const node = element(); node.parent = this;
        if (selector === '.cid') node.textContent = this.innerHTML.match(/<span class="cid(?: link)?"[^>]*>([^<]+)/)?.[1] || '';
        cache.set(selector, node);
      }
      return cache.get(selector);
    },
    appendChild(child) { child.parent = this; this.children.push(child); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
    select() {}, setAttribute() {}, removeAttribute() {},
    click() {
      if (this.disabled) return { stopped: false, result: Promise.resolve() };
      const event = { stopped: false, currentTarget: this, target: this, stopPropagation() { this.stopped = true; } };
      const result = this.listeners.click?.(event);
      if (!event.stopped && this.parent) this.parent.listeners.click?.(event);
      return { stopped: event.stopped, result };
    },
  };
}
function setup(writeText = async () => {}, fallback = () => false) {
  const document = element(); document.body = element(); document.createElement = element; document.execCommand = fallback;
  const copied = [], notices = [], opened = [], timers = [];
  const sandbox = { document, console, URLSearchParams,
    navigator: { clipboard: { writeText: async id => { copied.push(id); return writeText(id); } } },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} }, window: { addEventListener() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox);
  const run = s => vm.runInContext(s, sandbox), state = run('state');
  sandbox.notice = s => notices.push(s); sandbox.open = id => opened.push(id);
  run('toast=notice; openDrawer=open; syncAcceptance=()=>{}; batchSettingsHtml=()=>""; bindBatchSettings=()=>{};');
  const item = { id: 'REQ-20990101-001', type: 'requirement', status: 'in-progress', title: '需求', docs: [], bugs: [] };
  state.board = { items: [item] }; state.drawer.item = item; state.drawer.id = item.id;
  sandbox.testItem = item;
  const card = run('reqRowEl(testItem)');
  return { sandbox, document, state, run, item, card, copied, notices, opened, timers };
}
function button(h) {
  const b = h.card.querySelector('[data-copy-id]');
  assert.ok(b, '卡片应有独立复制按钮');
  return b;
}

t('C1 卡片有可见原生按钮，单号本身不再复制', async () => {
  const h = setup(), b = button(h);
  // BUG-20260910-007：列表行复制按钮图标化（⧉ 图标 + title 悬停提示）
  assert.equal(b.textContent, '⧉');
  assert.match(b.attributes, /type="button"/);
  assert.match(b.attributes, /aria-label="复制单号 REQ-20990101-001"/);
  assert.match(b.attributes, /title="复制单号 REQ-20990101-001"/);
  assert.doesNotMatch(h.card.innerHTML, /class="cid link"|点击复制单号/);
  h.card.querySelector('.cid').click();
  assert.equal(h.copied.length, 0, '单号点击不能调用剪贴板');
  assert.deepEqual(h.opened, [h.item.id], '卡片正常打开行为保留');
});

t('C2 卡片复制正确且不冒泡，反馈只改按钮并恢复', async () => {
  const h = setup(), b = button(h);
  const click = b.click(); await click.result;
  assert.equal(click.stopped, true);
  assert.deepEqual(h.copied, [h.item.id]);
  assert.deepEqual(h.opened, []);
  assert.equal(h.card.querySelector('.cid').textContent, h.item.id);
  // BUG-20260910-007：图标位反馈换 ✓ + 就近 title，不放大段中文回工具行
  assert.equal(b.textContent, '✓');
  assert.equal(b.title, '已复制 REQ-20990101-001');
  assert.equal(b.disabled, true);
  h.timers.shift()();
  assert.equal(b.textContent, '⧉');
  assert.equal(b.title, '复制单号 REQ-20990101-001');
  assert.equal(b.disabled, false);
});

t('C3 详情和下属 Bug 分别复制各自单号，不触发详情导航', async () => {
  const h = setup();
  const bug = { id: 'BUG-20990101-002', title: 'Bug', status: 'accepted' };
  h.item.bugs = [bug]; h.item.bugCount = 1; h.item.openBugCount = 1;
  h.run('renderDrawer()');
  const drawer = h.document.querySelector('#drawer'), buttons = drawer.querySelectorAll('[data-copy-id]');
  assert.equal(buttons.length, 2, '详情标题和下属 Bug 均需要按钮');
  for (const b of buttons) { const click = b.click(); await click.result; assert.equal(click.stopped, true); }
  assert.deepEqual(h.copied, [h.item.id, bug.id]);
  assert.deepEqual(h.opened, []);
  assert.doesNotMatch(drawer.innerHTML, /点击复制单号/);
});

t('C4 异步等待和成功反馈期间不能重复提交', async () => {
  let resolve;
  const h = setup(() => new Promise(r => { resolve = r; })), b = button(h);
  const first = b.click(); b.click();
  assert.equal(h.copied.length, 1, 'Clipboard 未返回时也须防重入');
  resolve(); await first.result; b.click();
  assert.equal(h.copied.length, 1, '反馈期间不得重复复制');
  h.timers.shift()(); const retry = b.click(); resolve(); await retry.result;
  assert.equal(h.copied.length, 2, '反馈恢复后可再次复制');
});

t('C5 Clipboard 拒绝时降级复制，临时文本域被清理', async () => {
  const h = setup(async () => { throw new Error('denied'); }, () => true), b = button(h);
  await b.click().result;
  // BUG-20260910-007：图标按钮反馈为 ✓ 图标位
  assert.equal(b.textContent, '✓');
  assert.equal(h.document.body.children.length, 0);
  assert.deepEqual(h.notices, []);
});

t('C6 两种复制方式都失败时清理临时节点、提示并恢复可点击', async () => {
  const h = setup(async () => { throw new Error('denied'); }, () => { throw new Error('copy failed'); }), b = button(h);
  await b.click().result;
  assert.equal(b.textContent, '⧉'); assert.equal(b.disabled, false);
  assert.equal(h.document.body.children.length, 0, '降级异常也必须移除临时文本域');
  assert.match(h.notices[0], /手动框选/);
  await b.click().result; assert.equal(h.copied.length, 2, '失败后可以重试');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.stack}`); }
}
process.exitCode = failed ? 1 : 0;
