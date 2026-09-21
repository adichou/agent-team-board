// 聚合区缓存失效回归：运行生产渲染函数，验证清空/错误恢复和正常轮询剪枝。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
function setup(kind) {
  const name = kind === 'holds' ? 'renderHolds' : 'renderConfirmArea';
  const fn = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(fn, `应找到生产函数 ${name}`);
  const classes = new Set(['hidden']);
  let html = '', writes = 0;
  const area = {
    dataset: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v) },
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; writes++; },
    replaceChildren() { html = ''; writes++; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const item = { itemId: 'REQ-20260921-001', state: 'waiting', unanswered: 1, total: 1, questions: [{ answer: '' }] };
  const data = { items: [item] };
  const state = { view: 'status', board: { initialized: true }, [kind]: { data, sig: '', error: '', expanded: new Set(), answeredOpen: new Map() } };
  const ctx = vm.createContext({ state, $: () => area, esc: String, holdCardHtml: () => '<button data-hold-answer>补决策</button>', confirmCardHtml: () => '<button data-confirm-panel>查看并确认</button>' });
  vm.runInContext(fn, ctx);
  const render = () => vm.runInContext(`${name}()`, ctx);
  const visible = () => {
    assert.equal(classes.has('hidden'), false, `${name} 应恢复可见`);
    assert.match(html, /data-(hold-answer|confirm-panel)/, `${name} 应恢复操作入口`);
    assert.doesNotMatch(html, /role="alert"/, `${name} 不应残留错误条`);
  };
  return { state, area, data, render, visible, writes: () => writes };
}

for (const kind of ['holds', 'confirms']) {
  test(`${kind} 首次渲染与相同数据轮询保持 DOM`, () => {
    const h = setup(kind);
    h.render(); h.visible();
    const before = h.writes();
    h.render();
    assert.equal(h.writes(), before, '相同签名不能重绘，以免打断交互');
  });
  test(`${kind} 清单清空后恢复相同数据`, () => {
    const h = setup(kind);
    h.render();
    h.state[kind].data = { items: [] }; h.render();
    assert.equal(h.area.innerHTML, '', '空清单应清空内容');
    h.state[kind].data = h.data; h.render(); h.visible();
  });
  test(`${kind} 错误恢复后相同数据重新显示入口`, () => {
    const h = setup(kind);
    h.render();
    h.state[kind].error = '网络故障';
    if (kind === 'confirms') h.state[kind].data = null;
    h.render();
    assert.match(h.area.innerHTML, /role="alert"/, '失败应显示错误条');
    h.state[kind].error = ''; h.state[kind].data = h.data;
    h.render(); h.visible();
  });
}
for (const view of ['tasks', 'releases', 'settings']) {
  test(`需求页切到 ${view} 后返回，相同数据恢复入口`, () => {
    const h = setup('holds');
    h.render(); h.state.view = view; h.render();
    assert.equal(h.area.innerHTML, '', '离开需求页应清空区域');
    h.state.view = 'status'; h.render(); h.visible();
  });
}
test('重新初始化后相同 hold 恢复；展开和折叠状态保留且触发重绘', () => {
  const h = setup('holds');
  h.render(); h.state.board.initialized = false; h.render();
  h.state.board.initialized = true; h.render(); h.visible();
  const before = h.writes();
  h.state.holds.expanded.add('REQ-20260921-001');
  h.state.holds.answeredOpen.set('REQ-20260921-001', true);
  h.render();
  assert.ok(h.writes() > before, '展开态变动应重绘');
  h.state.view = 'tasks'; h.render(); h.state.view = 'status'; h.render();
  assert.equal(h.state.holds.expanded.has('REQ-20260921-001'), true);
  assert.equal(h.state.holds.answeredOpen.get('REQ-20260921-001'), true);
  h.visible();
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (error) { failed++; console.error(`✗ ${name}: ${error.message}`); }
}
console.log(`${cases.length - failed}/${cases.length} 通过`);
process.exitCode = failed ? 1 : 0;
