#!/usr/bin/env node
// REQ-20260909-006 详情抽屉页签式布局 —— 静态契约 + vm 行为测试
// 用法：node scripts/tests/drawer-tabs-20260909-006.test.mjs
// 覆盖 test-cases.md 的 T1–T11（1020px 两形态与深浅色目检为人工浏览器实测）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const js = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

function fnSrc(name) {
  const m = js.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

// ---------- T1 页签栏结构 ----------

t('T1 头部下方固定页签栏：页签顺序 基本信息→说明→设计→测试用例→讨论纪要（REQ-20260909-013：讨论纪要页签随讨论模块暂隐藏，隐藏态不渲染）；licenses.md（REQ-20260909-015）与 test-report.md 存在时分别条件插入/追加', () => {
  const rd = fnSrc('renderDrawer');
  const posHead = rd.indexOf('</header>');
  const posTabs = rd.indexOf('<nav class="tabs drawer-tabs"');
  const posBody = rd.indexOf('<div class="drawer-body">');
  assert.ok(posHead >= 0 && posTabs > posHead, '页签栏应在抽屉头部之后');
  assert.ok(posBody > posTabs, '内容区应在页签栏之后');
  const order = ['data-tab="info"', 'drawerDocTabs(it)', 'data-tab="disc"'].map((s) => rd.indexOf(s, posTabs));
  assert.ok(order.every((p) => p > 0), '页签栏应含 info/文档/讨论纪要页签');
  assert.ok(order[0] < order[1] && order[1] < order[2], '页签顺序应为 基本信息 → 文档 → 讨论纪要');
  assert.match(rd, /data-tab="info"[^<]*>基本信息</, '首页签文案为「基本信息」');
  assert.match(rd, /data-tab="disc"[^<]*>讨论纪要</, '末页签文案为「讨论纪要」');
  // 文档页签口径：三份固定 + licenses.md / test-report.md 条件附加
  const docTabs = js.match(/const DRAWER_FIXED_DOC_TABS = \[[^\]]*\]/);
  assert.ok(docTabs, '应存在固定文档页签常量');
  assert.match(docTabs[0], /'README\.md'/);
  assert.match(docTabs[0], /'design\.md'/);
  assert.match(docTabs[0], /'test-cases\.md'/);
  const docTabsFn = fnSrc('drawerDocTabs');
  assert.match(docTabsFn, /test-report\.md/, 'test-report.md 应为条件追加的附加页签');
  assert.match(docTabsFn, /includes\('test-report\.md'\)/, '仅文件存在时出现测试报告页签');
  // REQ-20260909-015：licenses.md 条件插入「设计」之后，不进固定页签常量
  assert.match(docTabsFn, /includes\('licenses\.md'\)/, 'licenses.md 存在时出现开源许可页签');
  assert.match(docTabsFn, /indexOf\('design\.md'\) \+ 1/, 'licenses.md 应插在「设计」页签之后');
  assert.doesNotMatch(docTabs[0], /licenses\.md/, 'licenses.md 不得进固定页签常量');
});

// ---------- T2 默认页签与切换重置 ----------

t('T2 打开/关闭/初始均重置 tab=info 与 docCache：切换条目回基本信息、旧文档缓存不串显', () => {
  assert.match(js, /drawer: \{ id: null, item: null, doc: null, navIds: null,[^}]*tab: 'info'[^}]*\}/, '初始 state.drawer 应含 tab: info');
  const open = fnSrc('openDrawer');
  assert.match(open, /state\.drawer = \{ id, item: null, doc: null, navIds[^}]*tab: 'info'/, 'openDrawer 应重置 tab 为 info');
  assert.match(open, /docCache: \{\}/, 'openDrawer 应重建文档缓存（旧条目不串显）');
  const close = fnSrc('closeDrawer');
  assert.match(close, /state\.drawer = \{ id: null, item: null, doc: null,[^}]*tab: 'info'/, 'closeDrawer 应重置 tab 为 info');
  // 回归：drawer-nav D2 依赖的 openDrawer 重置前缀不被破坏
  assert.match(open, /state\.drawer = \{ id, item: null, doc: null, navIds/);
});

// ---------- T3 基本信息页签完整性 ----------

t('T3 info pane 含迁移前全部区块；上一条/下一条留在操作行两翼、不进页签栏', () => {
  const rd = fnSrc('renderDrawer');
  const pInfo = rd.indexOf('data-pane="info"');
  const pDoc = rd.indexOf('data-pane="doc"');
  assert.ok(pInfo > 0 && pDoc > pInfo, '应存在 info 与 doc 两个 pane');
  const infoTpl = rd.slice(pInfo, pDoc);
  for (const word of ['meta-grid', 'refineBadgeHtml', 'agentCompletedAt', 'drawerActionsNoticeHtml(it)', 'drawer-actions', 'bug-list', 'batchSettingsHtml(it)']) {
    assert.ok(infoTpl.includes(word), `基本信息页签应包含 ${word}`);
  }
  assert.match(infoTpl, /drawerActionsNoticeHtml\(it\)\}\s*\n\s*<div class="drawer-actions">/, 'notice 应仍紧邻操作行上方（结构契约不回归）');
  // 导航不在页签栏内：页签栏片段不得含 data-nav，info pane 内保留两翼导航
  const navBar = rd.slice(rd.indexOf('<nav class="tabs drawer-tabs"'), rd.indexOf('</nav>', rd.indexOf('<nav class="tabs drawer-tabs"')));
  assert.doesNotMatch(navBar, /data-nav/, '上一条/下一条不应放进页签栏');
  assert.match(infoTpl, /drawerNavBtn\('prev'/, '操作行两翼应保留上一条导航');
  assert.match(infoTpl, /drawerNavBtn\('next'/, '操作行两翼应保留下一条导航');
});

// ---------- T4 文档页签加载与渲染 ----------

t('T4 文档页签共用 #docView：loadDoc 渲染后 linkupDocDemo 接管演示链接；页签点击绑定 activateDrawerTab', () => {
  const rd = fnSrc('renderDrawer');
  const pDoc = rd.indexOf('data-pane="doc"');
  const pDisc = rd.indexOf('data-pane="disc"');
  assert.ok(pDisc > pDoc, 'doc pane 应在 disc pane 之前');
  const docTpl = rd.slice(pDoc, pDisc);
  assert.match(docTpl, /id="docView"/, '文档页签内容区应为 #docView');
  assert.match(docTpl, /class="md"/, '沿用 markdown 渲染样式');
  // BUG-20260908-021 前端接线契约保持（与 item-demo-link U1 同口径）
  assert.match(js, /view\.innerHTML = renderMd\(res\.content\);\s*\n\s*linkupDocDemo\(view, state\.drawer\.id\)/, 'loadDoc 渲染后应调用 linkupDocDemo');
  // 页签绑定
  assert.match(rd, /querySelectorAll\('\.drawer-tab'\)/, 'renderDrawer 应绑定 drawer-tab 点击');
  assert.match(rd, /activateDrawerTab\(b\.dataset\.tab\)/, '页签点击应切换 activateDrawerTab');
});

// ---------- T5/T6 activateDrawerTab 行为（vm 沙箱） ----------

function mkClassEl(init = '') {
  const classes = new Set(init.split(/\s+/).filter(Boolean));
  return {
    classes,
    attrs: {},
    classList: {
      toggle(cls, on) { on ? classes.add(cls) : classes.delete(cls); },
      contains(cls) { return classes.has(cls); },
    },
    setAttribute(k, v) { this.attrs[k] = v; },
  };
}

// 提取 activateDrawerTab 及其依赖（常量 + HIDDEN_VIEWS 开关 + drawerDocTabs + drawerTabValid），DOM/api 以桩注入
// REQ-20260909-013：drawerTabValid 引用 HIDDEN_VIEWS（disc 页签随讨论模块暂隐藏 → 无效），需一并提取
function runActivate(tab, { docs = ['README.md', 'design.md'], doc = null, cache = {} } = {}) {
  const hidden = js.match(/const HIDDEN_VIEWS = [^\n]+;/);
  assert.ok(hidden, '应存在 HIDDEN_VIEWS 暂态隐藏开关（REQ-20260909-013）');
  const consts = js.match(/const DRAWER_TAB_LABEL = \{[\s\S]*?\};\s*\nconst DRAWER_FIXED_DOC_TABS = \[[^\]]*\];/);
  assert.ok(consts, '应存在页签常量定义');
  const src = `${hidden[0]}\n${consts[0]}\n${fnSrc('drawerDocTabs')}\n${fnSrc('drawerTabValid')}\n${fnSrc('activateDrawerTab')}\nactivateDrawerTab(__tab);`;
  const tabs = ['info', 'README.md', 'design.md', 'test-cases.md', 'test-report.md', 'disc'].map((k) => ({ k, el: mkClassEl('tab drawer-tab') }));
  const panes = ['info', 'doc', 'disc'].map((k) => ({ k, el: mkClassEl('drawer-pane') }));
  const view = { innerHTML: '' };
  const drawer = {
    querySelectorAll: (sel) => (sel === '.drawer-tab' ? tabs.map((x) => x.el).map((el, i) => Object.assign(el, { dataset: { tab: tabs[i].k } }))
      : sel === '.drawer-pane' ? panes.map((x) => x.el).map((el, i) => Object.assign(el, { dataset: { pane: panes[i].k } }))
        : []),
  };
  const calls = { loadDoc: [], linkup: [], linkupImg: [] };
  const state = { drawer: { id: 'REQ-X', item: { docs }, tab: 'info', doc, docCache: cache } };
  const sandbox = {
    $: (s) => (s === '#drawer' ? drawer : s === '#docView' ? view : null),
    state,
    linkupDocDemo: (v, id) => calls.linkup.push([v, id]),
    // REQ-20260909-009：缓存回填同样需要重新接管相对截图引用
    linkupDocImages: (v, id) => calls.linkupImg.push([v, id]),
    loadDoc: (...a) => calls.loadDoc.push(a),
    closeDocCtxMenu: () => {}, // REQ-20260909-014：切换页签收起右键菜单（此处仅桩）
    saveViewSnapshot: () => {}, // REQ-20260910-001：页签切换落盘刷新快照（纯本地存储），此处仅桩
    __tab: tab,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { tabs, panes, view, calls, state };
}

t('T5 切到文档页签：active/aria/pane 正确切换；未加载时显示加载态并调 loadDoc', () => {
  const r = runActivate('README.md');
  assert.equal(r.state.drawer.tab, 'README.md', '应记录当前页签');
  const infoTab = r.tabs.find((x) => x.k === 'README.md').el;
  assert.ok(infoTab.classes.has('active'), '目标页签应激活');
  assert.equal(infoTab.attrs['aria-selected'], 'true', 'aria-selected 应为 true');
  assert.equal(r.tabs.find((x) => x.k === 'info').el.attrs['aria-selected'], 'false', '其余页签 aria-selected 应为 false');
  assert.ok(r.panes.find((x) => x.k === 'info').el.classes.has('hidden'), 'info pane 应隐藏');
  assert.ok(!r.panes.find((x) => x.k === 'doc').el.classes.has('hidden'), 'doc pane 应显示');
  assert.ok(r.panes.find((x) => x.k === 'disc').el.classes.has('hidden'), 'disc pane 应隐藏');
  assert.deepEqual(r.calls.loadDoc, [['README.md', false]], '首次激活应调用 loadDoc 拉取');
  assert.match(r.view.innerHTML, /加载中/, '拉取前应显示加载态');
});

t('T5 再次激活已加载文档：state.drawer.doc 相同直接早退，不重复请求', () => {
  const r = runActivate('README.md', { doc: 'README.md' });
  assert.deepEqual(r.calls.loadDoc, [], '已在展示的文档不应重复请求');
});

t('T5 命中缓存直接回填：不 fetch、内容来自 docCache、linkupDocDemo 重新接管链接', () => {
  const r = runActivate('design.md', { cache: { 'design.md': '<p>cached-design</p>' } });
  assert.deepEqual(r.calls.loadDoc, [], '缓存命中不应请求');
  assert.equal(r.view.innerHTML, '<p>cached-design</p>', '应回填缓存内容');
  assert.deepEqual(r.calls.linkup, [[r.view, 'REQ-X']], '回填后应重新接管演示链接');
  assert.deepEqual(r.calls.linkupImg, [[r.view, 'REQ-X']], '回填后应重新接管相对截图（REQ-20260909-009）');
  assert.equal(r.state.drawer.doc, 'design.md', '应更新当前文档');
});

t('T6 缺失文档空态：不请求、不置 state.drawer.doc、内容区给「尚未创建」提示', () => {
  const r = runActivate('test-cases.md', { docs: ['README.md'] }); // test-cases.md 不存在
  assert.deepEqual(r.calls.loadDoc, [], '缺失文档不应请求');
  assert.equal(r.state.drawer.doc, null, '不应把缺失文档记为当前文档');
  assert.match(r.view.innerHTML, /尚未创建/, '应显示空态提示');
});

t('T8 失效页签回落：未知 tab 回到基本信息', () => {
  const r = runActivate('bogus-tab');
  assert.equal(r.state.drawer.tab, 'info', '失效页签应回落 info');
  assert.ok(!r.panes.find((x) => x.k === 'info').el.classes.has('hidden'), 'info pane 应显示');
});

// ---------- T5 缓存写入（loadDoc） ----------

t('T5 loadDoc 成功后写入 docCache（再次激活不重复请求的数据来源）', () => {
  const ld = fnSrc('loadDoc');
  assert.match(ld, /state\.drawer\.docCache\[name\] = html/, 'loadDoc 应把渲染结果写入缓存');
});

// ---------- T7 讨论纪要页签 ----------

t('T7 disc pane 含关联讨论列表与 #reqDocDisc 挂载点（REQ-20260909-013：disc 页签与分区随讨论模块暂隐藏，模板与机制保留待恢复）；Bug 单给空态而非空白', () => {
  const rd = fnSrc('renderDrawer');
  const pDisc = rd.indexOf('data-pane="disc"');
  assert.ok(pDisc > 0, '应存在 disc pane');
  const discTpl = rd.slice(pDisc, rd.indexOf('</div>`;', pDisc) > 0 ? rd.indexOf('</div>`;', pDisc) : undefined);
  assert.match(discTpl, /reqDiscussionsHtml\(it\)/, '讨论纪要页签应渲染关联讨论区块');
  assert.match(discTpl, /reqDocDisc/, '需求单应保留文档讨论挂载点（REQ-20260909-003）');
  const discFn = fnSrc('reqDiscussionsHtml');
  assert.match(discFn, /if \(it\.type !== 'requirement'\) return '<p class="muted">[^']*暂不支持/, 'Bug 单讨论纪要页签应为空态文案而非空白');
});

// ---------- T8 轮询不重置页签 ----------

t('T8 renderDrawer 按 state.drawer.tab 恢复页签；文档消失的当前页签回落基本信息', () => {
  const rd = fnSrc('renderDrawer');
  assert.match(rd, /drawerTabValid\(state\.drawer\.tab, it\)/, '渲染前应校验页签有效性');
  assert.match(rd, /state\.drawer\.tab = 'info';/, '失效页签应回落 info');
  assert.match(rd, /\btab === 'info'/, '应按当前页签渲染 active/hidden');
  const rf = fnSrc('refreshDrawer');
  assert.match(rf, /activateDrawerTab\('info'\)/, '当前文档消失时应回落基本信息页签');
  // pane 显隐口径一致性：渲染与切换都走 .hidden class（classList.toggle），不用 hidden 属性，避免重渲染后 pane 卡死
  assert.doesNotMatch(rd, /class="drawer-pane"[^>]*hidden/, 'pane 显隐不得用 hidden 属性');
  const act = fnSrc('activateDrawerTab');
  assert.match(act, /classList\.toggle\('hidden'/, 'activateDrawerTab 应以 .hidden class 切换 pane');
});

// ---------- T9 键盘与焦点 ----------

t('T9 页签为 button[role=tab][aria-selected]；:focus-visible 可见焦点态', () => {
  const rd = fnSrc('renderDrawer');
  assert.match(rd, /role="tablist"/, '页签栏应为 tablist');
  assert.match(rd, /class="tab drawer-tab[^"]*" role="tab" aria-selected="/, '页签应为 button+role=tab+aria-selected');
  assert.match(css, /\.drawer-tab:focus-visible\s*\{[^}]*outline/, '页签应有可见焦点态');
});

// ---------- T10 窄屏换行 ----------

t('T10 页签栏可换行、无横向滚动', () => {
  const rule = css.match(/\.drawer-tabs\s*\{[^}]*\}/);
  assert.ok(rule, '应存在 .drawer-tabs 样式');
  assert.match(rule[0], /flex-wrap:\s*wrap/, '窄屏页签行应可换行');
  assert.doesNotMatch(rule[0], /overflow-x:\s*(auto|scroll)/, '不应产生横向滚动');
});

// ---------- T11 搜索命中定位 ----------

t('T11 文档搜索命中点击后仍 loadDoc(hitDoc, true) 切到对应文档页签', () => {
  assert.match(js, /await openDrawer\(b\.dataset\.hitId\);\s*\n\s*loadDoc\(b\.dataset\.hitDoc, true\)/, '搜索命中定位调用不回归');
  const ld = fnSrc('loadDoc');
  assert.match(ld, /if \(setActive\) activateDrawerTab\(name\);/, 'setActive 应经 activateDrawerTab 切换页签');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
