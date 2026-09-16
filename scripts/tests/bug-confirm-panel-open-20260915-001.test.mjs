// BUG-20260915-001：通过真实打开/加载入口验证消息节点尚未生成的首次打开。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const fragment = source.slice(source.indexOf('function setConfirmPanelView('), source.indexOf('function renderConfirmForm('));
function setup(api) {
  const nodes = new Map();
  function element(id, hidden = false) {
    const classes = new Set(hidden ? ['hidden'] : []);
    const el = { textContent: '', classList: {
      add: x => classes.add(x), remove: x => classes.delete(x),
      contains: x => classes.has(x),
      toggle: (x, on) => on ? classes.add(x) : classes.delete(x),
    } };
    nodes.set(`#${id}`, el);
    return el;
  }
  // 仅创建真实初始 HTML 中已有的节点，不替尚未渲染的消息节点兜底。
  for (const id of ['confirmPanel', 'confirmPanelLoading', 'confirmPanelError', 'confirmPanelErrorText', 'confirmForm']) {
    assert.ok(html.includes(`id="${id}"`));
    element(id, id !== 'confirmPanelLoading');
  }
  assert.ok(!html.includes('id="confirmPanelMsg"'));
  const calls = [];
  const context = vm.createContext({
    $: id => nodes.get(id) || null,
    document: { activeElement: null },
    confirmSide: { seq: 0, open: false },
    state: { confirms: { detail: new Map() } },
    api: async url => { calls.push(url); return api(url); },
    renderConfirmForm: d => { element('confirmPanelMsg'); nodes.get('#confirmForm').textContent = d.itemId; },
  });
  vm.runInContext(fragment, context);
  return { context, nodes, calls, run: code => vm.runInContext(code, context), hidden: id => nodes.get(`#${id}`).classList.contains('hidden') };
}

test('首次打开发出详情请求，加载结束后呈现表单；关闭重开清除旧消息', async () => {
  const h = setup(() => ({ itemId: 'BUG-1' }));
  await h.run('openConfirmPanel("BUG-1")');
  assert.deepEqual(h.calls, ['/api/confirms/BUG-1']);
  assert.equal(h.hidden('confirmPanelLoading'), true);
  assert.equal(h.hidden('confirmForm'), false);
  h.run('confirmPanelMsg("旧错误", true); closeConfirmPanel()');
  assert.equal(h.hidden('confirmPanel'), true);
  await h.run('openConfirmPanel("BUG-1")');
  assert.equal(h.calls.length, 2);
  assert.equal(h.nodes.get('#confirmPanelMsg').textContent, '');
  assert.equal(h.hidden('confirmForm'), false);
});

test('首次请求失败显示错误并退出加载，重试成功显示表单', async () => {
  let attempts = 0;
  const h = setup(() => { if (++attempts === 1) throw new Error('服务不可用'); return { itemId: 'BUG-1' }; });
  await h.run('openConfirmPanel("BUG-1")');
  assert.equal(h.hidden('confirmPanelLoading'), true);
  assert.equal(h.hidden('confirmPanelError'), false);
  assert.match(h.nodes.get('#confirmPanelErrorText').textContent, /服务不可用/);
  await h.run('loadConfirmDetail()');
  assert.equal(h.hidden('confirmPanelError'), true);
  assert.equal(h.hidden('confirmForm'), false);
});

test('关闭后的迟到响应不重开表单或覆盖当前状态', async () => {
  let resolve;
  const h = setup(() => new Promise(r => { resolve = r; }));
  const pending = h.run('openConfirmPanel("BUG-1")');
  assert.equal(h.calls.length, 1);
  h.run('closeConfirmPanel()');
  resolve({ itemId: 'BUG-1' });
  await pending;
  assert.equal(h.hidden('confirmPanel'), true);
  assert.equal(h.context.state.confirms.detail.size, 0);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); }
}
process.exitCode = failed ? 1 : 0;
