#!/usr/bin/env node
// REQ-20260911-001 待接受条目「✎ 修改」居中弹窗迁右侧侧拉面板（对齐「＋ 新建」）
// 用法：node scripts/tests/edit-side-panel-20260911-001.test.mjs
// 覆盖 test-cases.md 的 E1–E12（E12 的既有迁移断言含 edit-content / rename-reject 契约改写与沙箱隐藏桩）。
// 模式对齐 edit-content.test.mjs：静态契约 + vm 沙箱行为断言。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_JS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'app.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'index.html'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'web', 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const fnBody = (src, name) => src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))?.[0] || '';

// ---------- 静态契约：面板结构（E1 / E10 / E11） ----------

t('E1 静态：index.html 常驻 #editModalWrap 侧拉面板（三态内容区 + 字段顺序 + 无全屏遮罩）', () => {
  const idx = INDEX_HTML.indexOf('id="editModalWrap"');
  assert.ok(idx > 0, '应有 #editModalWrap 面板节点');
  const tag = INDEX_HTML.slice(idx - 200, idx + 1600);
  assert.match(tag, /class="side-panel hidden"/, '面板应为 .side-panel 初始隐藏（几何复用新建面板）');
  assert.match(tag, /role="dialog"/, '面板应为 dialog 角色');
  assert.ok(tag.indexOf('aria-label="编辑') > 0, '面板应有可访问名称');
  // 头部常驻：动态标题 + 说明 + ✕ 关闭（aria-label / title）
  assert.ok(tag.indexOf('id="editItemTitle"') > 0, '缺少 #editItemTitle 动态标题');
  assert.ok(tag.indexOf('id="editScope"') > 0, '缺少 #editScope 说明');
  assert.ok(tag.indexOf('id="editClose"') > 0, '缺少 #editClose 关闭按钮');
  assert.match(tag, /aria-label="关闭编辑面板"/, '关闭按钮应有可访问名称');
  // 内容区三态：加载 / 错误（原因 + 重试 + 关闭）/ 表单
  assert.ok(tag.indexOf('id="editLoading"') > 0, '缺少 #editLoading 加载态');
  assert.ok(tag.indexOf('id="editErrorText"') > 0, '缺少 #editErrorText 错误原因');
  assert.ok(tag.indexOf('id="editRetry"') > 0, '缺少 #editRetry 重试');
  assert.ok(tag.indexOf('id="editErrorClose"') > 0, '缺少 #editErrorClose 错误态关闭');
  assert.ok(tag.indexOf('id="editForm"') > 0, '缺少 #editForm 表单');
  // 表单内顺序：标题（maxlength 120）→ 描述 textarea → 反馈（role=status）→ 取消/保存
  const form = tag.slice(tag.indexOf('id="editForm"'));
  const posTitle = form.indexOf('id="eTitle"');
  const posDesc = form.indexOf('id="eDesc"');
  const posMsg = form.indexOf('id="editMsg"');
  const posCancel = form.indexOf('id="editCancel"');
  const posSave = form.indexOf('id="editSave"');
  for (const p of [posTitle, posDesc, posMsg, posCancel, posSave]) assert.ok(p > 0, '表单控件齐全');
  assert.ok(posTitle < posDesc && posDesc < posMsg && posMsg < posCancel && posCancel < posSave, '字段顺序：标题 → 描述 → 反馈 → 取消/保存');
  assert.match(form.slice(0, 400), /maxlength="120"/, '标题应限 120 字');
  assert.match(form, /<textarea[^>]*id="eDesc"/, '描述应为多行文本域');
  assert.match(form, /id="editMsg"[^>]*role="status"[^>]*aria-live="polite"/, '反馈消息应可被辅助技术读取');
  assert.match(form, />取消</, '取消按钮保留');
  assert.match(form, /<button[^>]*type="submit"[^>]*id="editSave"/, '保存为主提交按钮');
  assert.ok(tag.includes('可留空'), '描述应带可留空提示');
  // 无全屏遮罩：编辑面板自身不是 .modal-wrap，也不在其上叠加遮罩节点
  assert.ok(!/id="editModalWrap"[^>]*class="[^"]*modal-wrap/.test(tag), '编辑面板不得使用 .modal-wrap 全屏遮罩形态');
});

t('E2 静态：uiEditForm / promptActive 居中弹窗整体下线，editItem 驱动侧拉面板', () => {
  assert.ok(!APP_JS.includes('uiEditForm'), 'app.js 不应残留 uiEditForm 居中编辑弹窗');
  assert.ok(!APP_JS.includes('promptActive'), 'app.js 不应残留 promptActive 旧互斥机制');
  assert.doesNotMatch(APP_JS, /window\.prompt\(/, 'IAB 内禁用同步 prompt');
  for (const sym of ['editPanelOpen', 'openEditPanel', 'loadEditContent', 'closeEditPanel', 'submitEditPanel', 'setEditBusy', '标题不能为空', '标题与描述均无变化', '保存中…']) {
    assert.ok(APP_JS.includes(sym), `app.js 应包含 ${sym}`);
  }
  assert.ok(INDEX_HTML.includes('正在读取描述…'), 'index.html 应常驻读取中提示文案');
  assert.match(APP_JS, /\$\('#editModalWrap'\)/, '应操作 #editModalWrap 面板');
  // 入口不变：卡片/详情仍 data-rename-id + stopPropagation（点卡片编辑不误开详情）
  const bind = fnBody(APP_JS, 'bindRenameButtons');
  assert.match(bind, /data-rename-id/, '入口仍按 data-rename-id 绑定');
  assert.match(bind, /stopPropagation/, '点击不得冒泡打开详情');
  assert.match(bind, /editItem\(button\.dataset\.renameId, button\)/, '应把入口按钮作为焦点返回锚点传入');
});

t('E4 静态：Esc 链编辑层在抽屉之前（一次只关一层），保存中 Esc 被拦截；面板纳入 anyModalOpen', () => {
  const chain = fnBody(APP_JS, 'onGlobalKeydown');
  assert.ok(chain, '应存在具名 onGlobalKeydown');
  const esc = chain.slice(chain.indexOf("e.key === 'Escape'"));
  const iEdit = esc.indexOf('closeEditPanel');
  const iDrawer = esc.indexOf('closeDrawer');
  assert.ok(iEdit !== -1 && iDrawer !== -1, 'Escape 链应包含编辑面板与抽屉关闭');
  assert.ok(iEdit < iDrawer, '编辑面板应先于详情抽屉关闭（详情保留）');
  const editBlock = esc.slice(0, iDrawer);
  assert.match(editBlock, /editSide\.busy/, '保存中 Esc 应被拦截（不关闭编辑层也不关其他层）');
  const any = fnBody(APP_JS, 'anyModalOpen');
  assert.match(any, /#editModalWrap/, 'anyModalOpen 应覆盖编辑面板（单键快捷键让位）');
});

t('E11 静态：编辑面板无遮罩点击关闭（点击面板外不关闭），仅 ✕ / 取消 / Esc', () => {
  const wiring = APP_JS.slice(APP_JS.indexOf('/* ---------- 事件绑定与启动 ---------- */'));
  assert.doesNotMatch(wiring, /\$\('#editModalWrap'\)\.addEventListener\('click'/, '编辑面板不得挂点击外部关闭');
  assert.match(wiring, /\$\('#editClose'\)\?\.addEventListener\('click'[^;]*closeEditPanel/, '✕ 关闭应接线');
  assert.match(wiring, /\$\('#editCancel'\)\?\.addEventListener\('click'[^;]*closeEditPanel/, '取消关闭应接线');
  assert.match(wiring, /\$\('#editForm'\)\?\.addEventListener\('submit'/, '表单 submit 应接线');
  assert.match(wiring, /\$\('#eTitle'\)\?\.addEventListener\('keydown'[^;]*'Enter'/, '标题 Enter 应发起保存');
  assert.doesNotMatch(wiring, /\$\('#eDesc'\)\?\.addEventListener\('keydown'/, '描述文本域不接管 Enter（保持换行）');
  assert.match(wiring, /\$\('#editRetry'\)\?\.addEventListener\('click'[^;]*loadEditContent/, '读取失败重试应接线');
  assert.match(wiring, /\$\('#editErrorClose'\)\?\.addEventListener\('click'[^;]*closeEditPanel/, '错误态关闭应接线');
});

t('E10 静态：样式复用 .side-panel，新增仅反馈/错误文案且颜色走 CSS 变量', () => {
  assert.match(INDEX_HTML, /id="editModalWrap" class="side-panel/, '面板几何复用 .side-panel（宽度/断点/投影随既有规则）');
  assert.match(STYLE_CSS, /\.edit-msg\s*\{/, '应有面板反馈文案样式');
  const msg = STYLE_CSS.match(/\.edit-msg\s*\{[^}]*\}/)[0];
  assert.match(msg, /var\(--muted\)/, '默认反馈色走变量');
  const err = STYLE_CSS.match(/\.edit-msg\.err\s*\{[^}]*\}/)?.[0] || '';
  assert.match(err, /var\(--warn\)/, '错误反馈色走变量');
  assert.match(STYLE_CSS, /\.edit-error-text\s*\{[^}]*var\(--warn\)/, '读取失败原因色走变量');
  assert.ok(!STYLE_CSS.includes('.confirm-box'), '居中编辑弹窗样式不应回归');
});

t('E12 静态：既有沙箱把 #editModalWrap 纳入初始隐藏清单（Esc 链读取其显隐）', () => {
  const shortcuts = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'tests', 'shortcuts-20260910-007.test.mjs'), 'utf8');
  assert.match(shortcuts, /INITIALLY_HIDDEN[\s\S]{0,400}#editModalWrap/, 'shortcuts 沙箱应初始隐藏编辑面板');
  const shot = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'tests', 'new-shot-preview-20260910-017.test.mjs'), 'utf8');
  assert.match(shot, /querySelector\('#editModalWrap'\)\.classList\.add\('hidden'\)/, 'new-shot-preview 沙箱应初始隐藏编辑面板');
});

// ---------- 沙箱行为（E3 / E5 / E6 / E7 / E8 / E9） ----------

function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    children: [], listeners: {}, isConnected: true, focusLog: [],
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    removeEventListener() {},
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    remove() {},
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    focus() { this.focusLog.push('focus'); },
  };
}

const README_DOC = '# REQ-20990101-001 旧标题\n\n## 描述\n\n旧描述正文\n\n## 验收标准\n\n- [ ] （待补充）\n';
const BUG_DOC = '# BUG-20990101-002 旧缺陷\n\n## 现象\n\n旧现象正文\n\n## 复现步骤\n\n1. 步骤\n';

function uiSetup() {
  const document = element();
  document.createElement = element;
  const requests = [];
  const sandbox = { document, URLSearchParams, console, setTimeout: () => 0, clearTimeout() {},
    location: { pathname: '/', search: '' }, history: { replaceState() {} }, localStorage: { setItem() {} },
    window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
    fetch: async (url, opts) => {
      requests.push({ url: String(url), opts });
      const u = String(url);
      const json = u.includes('REQ-20990101-001') && u.includes('/doc/README.md') ? { content: README_DOC }
        : u.includes('BUG-20990101-002') && u.includes('/doc/README.md') ? { content: BUG_DOC }
        : {};
      return { ok: true, json: async () => json };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_JS.split('/* ---------- 事件绑定与启动 ---------- */')[0], sandbox, { filename: 'app.js' });
  const run = (code) => vm.runInContext(code, sandbox);
  const state = run('state');
  state.project = '/project/a';
  state.board = { initialized: true, items: [
    { id: 'REQ-20990101-001', type: 'requirement', status: 'submitted', title: '旧标题' },
    { id: 'REQ-20990101-002', type: 'requirement', status: 'accepted', title: '已接受' },
    { id: 'BUG-20990101-002', type: 'bug', status: 'submitted', title: '旧缺陷' },
  ] };
  // Esc 链读取显隐的常驻面板初始隐藏桩（对齐 index.html 初始态）
  run("for (const s of ['#modalWrap', '#projModalWrap', '#shortcutHelpWrap', '#shotPreview', '#editModalWrap']) document.querySelector(s).classList.add('hidden')");
  run('toast = (m, e) => { globalThis.__toasts = (globalThis.__toasts || []).concat(String(m)); globalThis.__toastErr = !!e; };'
    + 'updateBoardTabs = () => {}; markActiveTab = () => {}; refreshHealth = async () => {};'
    + 'refreshDrawer = async () => { globalThis.__drawerRefreshed = (globalThis.__drawerRefreshed || 0) + 1; };'
    + 'poll = async () => { globalThis.__polled = (globalThis.__polled || 0) + 1; };'
    + 'closeDrawer = () => { globalThis.__drawerClosed = (globalThis.__drawerClosed || 0) + 1; };');
  return { sandbox, document, state, run, requests };
}

const esc = (h) => h.run("onGlobalKeydown({ key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false, preventDefault() {} })");
const writes = (h) => h.requests.filter((r) => String(r.url).includes('/content'));

t('E3 沙箱：打开面板读取预填并聚焦标题；重复点击同一条目不叠加、不重置已填内容', async () => {
  const h = uiSetup();
  await h.run("editItem('REQ-20990101-001')");
  const get = h.requests.find((r) => String(r.url).includes('/doc/README.md'));
  assert.ok(get, '应先拉 README 全文截取描述');
  assert.match(get.url, /\/api\/item\/REQ-20990101-001\/doc\/README\.md\?project=%2Fproject%2Fa$/, '读取应绑定打开时项目');
  assert.equal(h.run("$('#editModalWrap').classList.contains('hidden')"), false, '面板应打开');
  assert.equal(h.run("$('#editItemTitle').textContent"), '编辑 REQ-20990101-001', '头部标题应显示条目编号');
  assert.ok(String(h.run("$('#editScope').textContent")).includes('## 描述'), '说明应指明描述节口径');
  assert.equal(h.run("$('#eTitle').value"), '旧标题', '标题预填当前值');
  assert.equal(h.run("$('#eDesc').value"), '旧描述正文', '描述预填 README 描述节原文');
  assert.ok(h.document.querySelector('#eTitle').focusLog.length >= 1, '读取完成后应聚焦标题');
  assert.equal(h.run("$('#editMsg').textContent"), '', '打开时反馈区清空');
  // 重复点击同一入口：不再读取、不重置已填内容
  h.run("$('#eTitle').value = '改到一半'");
  await h.run("editItem('REQ-20990101-001')");
  assert.equal(h.requests.filter((r) => String(r.url).includes('/doc/README.md')).length, 1, '重复打开不叠加读取');
  assert.equal(h.run("$('#eTitle').value"), '改到一半', '重复打开不重置草稿');
});

t('E3 沙箱：取消 / ✕ / Esc 关闭面板不发写请求，焦点返回入口；入口失联时按编号回落', async () => {
  const h = uiSetup();
  const btn = element();
  btn.dataset.renameId = 'REQ-20990101-001';
  await h.sandbox.editItem('REQ-20990101-001', btn);
  // Esc：只关编辑层，不连关抽屉
  esc(h);
  assert.equal(h.run("$('#editModalWrap').classList.contains('hidden')"), true, 'Esc 应关闭编辑面板');
  assert.equal(h.run("globalThis.__drawerClosed"), undefined, 'Esc 不得连带关闭详情抽屉');
  assert.equal(writes(h).length, 0, '关闭不应发写请求');
  assert.ok(btn.focusLog.length >= 1, '关闭后焦点应返回入口按钮');
  // 入口被重渲染移除：按 data-rename-id 回落找回
  const btn2 = element();
  btn2.dataset.renameId = 'REQ-20990101-001';
  btn2.isConnected = false;
  await h.sandbox.editItem('REQ-20990101-001', btn2);
  h.run('closeEditPanel()');
  const fallback = h.document.querySelector('[data-rename-id="REQ-20990101-001"]');
  assert.ok(fallback.focusLog.length >= 1, '入口失联时应按编号回落找回编辑入口');
  assert.equal(writes(h).length, 0, '关闭不应发写请求');
});

t('E5 沙箱：读取中显示「正在读取描述…」并禁用表单与保存（保留关闭）；失败与缺节进错误态可重试', async () => {
  const h = uiSetup();
  let release;
  const gate = new Promise((r) => { release = r; });
  h.sandbox.fetch = async (url) => {
    h.requests.push({ url: String(url), opts: undefined });
    await gate;
    return { ok: true, json: async () => ({ content: README_DOC }) };
  };
  const loading = h.run("editItem('REQ-20990101-001')");
  assert.equal(h.run("$('#editLoading').classList.contains('hidden')"), false, '读取中应显示加载提示');
  assert.equal(h.run("$('#editForm').classList.contains('hidden')"), true, '读取中不展示表单');
  assert.equal(h.run("$('#editSave').disabled"), true, '读取中禁用保存');
  assert.equal(h.run("$('#editClose').disabled"), false, '读取中保留关闭入口');
  release();
  await loading;
  assert.equal(h.run("$('#editForm').classList.contains('hidden')"), false, '读取完成进入表单');

  // 读取失败 → 错误态：显示原因 + 重试/关闭，不出现可提交的伪空表单
  const h2 = uiSetup();
  h2.sandbox.fetch = async (url) => {
    h2.requests.push({ url: String(url), opts: undefined });
    if (String(url).includes('/doc/README.md')) return { ok: false, json: async () => ({ error: '磁盘读取失败' }) };
    return { ok: true, json: async () => ({}) };
  };
  await h2.run("editItem('REQ-20990101-001')");
  assert.equal(h2.run("$('#editError').classList.contains('hidden')"), false, '读取失败应进错误态');
  assert.match(h2.run("$('#editErrorText').textContent"), /读取描述失败：磁盘读取失败/, '错误态应显示原因');
  assert.equal(h2.run("$('#editForm').classList.contains('hidden')"), true, '失败时不得出现可提交表单');
  assert.equal(writes(h2).length, 0, '失败态不发写请求');

  // 缺节 → 错误态（不能当空描述覆盖文档）
  const h3 = uiSetup();
  h3.sandbox.fetch = async (url) => {
    h3.requests.push({ url: String(url), opts: undefined });
    const content = String(url).includes('/doc/README.md') ? '# REQ-20990101-001 旧标题\n\n## 验收标准\n' : {};
    return { ok: true, json: async () => (String(url).includes('/doc/README.md') ? { content } : {}) };
  };
  await h3.run("editItem('REQ-20990101-001')");
  assert.match(h3.run("$('#editErrorText').textContent"), /缺少「## 描述」节/, '缺节应明确报错');

  // 重试成功进入表单
  let failOnce = true;
  const h4 = uiSetup();
  h4.sandbox.fetch = async (url) => {
    h4.requests.push({ url: String(url), opts: undefined });
    if (String(url).includes('/doc/README.md') && failOnce) { failOnce = false; return { ok: false, json: async () => ({ error: '暂时不可用' }) }; }
    return { ok: true, json: async () => (String(url).includes('/doc/README.md') ? { content: README_DOC } : {}) };
  };
  await h4.run("editItem('REQ-20990101-001')");
  assert.equal(h4.run("$('#editError').classList.contains('hidden')"), false, '首次读取失败进错误态');
  await h4.run('loadEditContent()');
  assert.equal(h4.run("$('#editForm').classList.contains('hidden')"), false, '重试成功应进入表单');
  assert.equal(h4.run("$('#eDesc').value"), '旧描述正文', '重试后预填描述');
});

t('E6 沙箱：读取与保存绑定打开时项目与条目，迟到响应不写入新面板', async () => {
  const h = uiSetup();
  const DOC_B = '# REQ-20990101-003 B 标题\n\n## 描述\n\nB 描述\n';
  const gates = {};
  const gateOf = (k) => gates[k] ||= new Promise((r) => { gates[`r${k}`] = r; });
  h.sandbox.fetch = async (url, opts) => {
    const u = String(url);
    h.requests.push({ url: u, opts });
    if (u.includes('/doc/README.md') && u.includes('REQ-20990101-001')) { await gateOf('a'); return { ok: true, json: async () => ({ content: README_DOC }) }; }
    if (u.includes('/doc/README.md') && u.includes('REQ-20990101-003')) { await gateOf('b'); return { ok: true, json: async () => ({ content: DOC_B }) }; }
    return { ok: true, json: async () => ({}) };
  };
  h.state.board.items.push({ id: 'REQ-20990101-003', type: 'requirement', status: 'submitted', title: 'B 标题' });
  const pa = h.run("editItem('REQ-20990101-001')");
  const pb = h.run("editItem('REQ-20990101-003')"); // A 读取在途时改开 B：重开读取当前已保存内容
  gates.rb(); // B 先返回
  await pb;
  assert.equal(h.run("$('#eTitle').value"), 'B 标题', '新面板应预填 B 的内容');
  gates.ra(); // A 的迟到响应返回
  await pa;
  assert.equal(h.run("$('#eTitle').value"), 'B 标题', '迟到响应不得写入新面板');
  assert.equal(h.run("$('#eDesc').value"), 'B 描述', '迟到响应不得污染描述');
});

t('E7 沙箱：空白标题与无变化在面板反馈区拦截且不发写请求；Bug 编辑走「## 现象」节', async () => {
  const h = uiSetup();
  await h.run("editItem('REQ-20990101-001')");
  h.run("$('#eTitle').value = ''");
  h.run("$('#eDesc').value = '新描述'");
  await h.run('submitEditPanel()');
  assert.equal(h.run("$('#editMsg').textContent"), '标题不能为空', '空标题应面板内提示');
  assert.equal(writes(h).length, 0, '空标题不得发写请求');
  assert.equal(h.run("$('#editModalWrap').classList.contains('hidden')"), false, '面板保持打开');
  h.run("$('#eTitle').value = '旧标题'");
  h.run("$('#eDesc').value = '旧描述正文'");
  await h.run('submitEditPanel()');
  assert.equal(h.run("$('#editMsg').textContent"), '标题与描述均无变化', '无变化应明确提示');
  assert.equal(writes(h).length, 0, '无变化不得发写请求');
  // 非 submitted：不开面板、不发任何请求
  await h.run("editItem('REQ-20990101-002')");
  assert.equal(h.run("$('#editModalWrap').classList.contains('hidden')"), false, '面板仍为上一条目（未叠加）');
  assert.equal(h.requests.filter((r) => String(r.url).includes('REQ-20990101-002')).length, 0, '非 submitted 不得发任何请求');
  // Bug：说明与预填走「## 现象」节
  const h2 = uiSetup();
  await h2.run("editItem('BUG-20990101-002')");
  assert.ok(String(h2.run("$('#editScope').textContent")).includes('## 现象'), 'Bug 说明应指出现象节');
  assert.equal(h2.run("$('#eDesc').value"), '旧现象正文', 'Bug 预填现象节原文');
  h2.run("$('#eTitle').value = '新缺陷'");
  h2.run("$('#eDesc').value = '新现象正文'");
  await h2.run('submitEditPanel()');
  const post = writes(h2)[0];
  assert.ok(post, 'Bug 保存应发写请求');
  assert.match(post.url, /\/api\/item\/BUG-20990101-002\/content\?project=%2Fproject%2Fa$/, 'Bug 保存绑定打开时项目');
  assert.deepEqual(JSON.parse(post.opts.body), { title: '新缺陷', description: '新现象正文' });
});

t('E8 沙箱：保存中锁定字段与关闭入口、Esc 被拦截；失败恢复可编辑且草稿保留可重试', async () => {
  const h2 = uiSetup();
  await h2.run("editItem('REQ-20990101-001')");
  h2.run("$('#eTitle').value = '新标题'");
  h2.run("$('#eDesc').value = '新描述'");
  let release;
  const gate = new Promise((r) => { release = r; });
  h2.sandbox.fetch = async (url, opts) => {
    h2.requests.push({ url: String(url), opts });
    if (String(url).includes('/content')) { await gate; return { ok: false, json: async () => ({ error: '仅待接受可改' }) }; }
    return { ok: true, json: async () => ({ content: README_DOC }) };
  };
  const saving = h2.run('submitEditPanel()');
  assert.equal(h2.run("$('#eTitle').disabled"), true, '保存中禁用标题');
  assert.equal(h2.run("$('#eDesc').disabled"), true, '保存中禁用描述');
  assert.equal(h2.run("$('#editCancel').disabled"), true, '保存中禁用取消');
  assert.equal(h2.run("$('#editClose').disabled"), true, '保存中禁用 ✕');
  assert.equal(h2.run("$('#editSave').disabled"), true, '保存中禁用保存（防重复提交）');
  assert.equal(h2.run("$('#editSave').textContent"), '保存中…', '保存按钮应切换保存中态');
  esc(h2); // 保存中 Esc：不得关闭
  assert.equal(h2.run("$('#editModalWrap').classList.contains('hidden')"), false, '保存中 Esc 不得关闭面板');
  release();
  await saving;
  assert.equal(h2.run("$('#eTitle').disabled"), false, '失败后恢复可编辑');
  assert.equal(h2.run("$('#editClose').disabled"), false, '失败后恢复关闭入口');
  assert.match(h2.run("$('#editMsg').textContent"), /仅待接受可改/, '失败应显示服务端错误');
  assert.equal(h2.run("$('#eTitle').value"), '新标题', '失败草稿保留');
  assert.equal(h2.run("$('#editModalWrap').classList.contains('hidden')"), false, '失败保持面板可重试');
  // 重试成功
  h2.sandbox.fetch = async (url, opts) => {
    h2.requests.push({ url: String(url), opts });
    return { ok: true, json: async () => ({ title: '新标题', status: 'submitted' }) };
  };
  await h2.run('submitEditPanel()');
  assert.equal(h2.run("$('#editModalWrap').classList.contains('hidden')"), true, '重试成功应关闭面板');
});

t('E9 沙箱：保存成功关闭面板、toast 提示、poll 刷新、详情打开时 refreshDrawer、焦点返回入口', async () => {
  const h = uiSetup();
  const btn = element();
  btn.dataset.renameId = 'REQ-20990101-001';
  h.state.drawer.id = 'REQ-20990101-001'; // 详情打开该条目
  await h.sandbox.editItem('REQ-20990101-001', btn);
  h.run("$('#eTitle').value = '新标题'");
  h.run("$('#eDesc').value = '新描述正文'");
  await h.run('submitEditPanel()');
  const post = writes(h)[0];
  assert.ok(post, '保存应发写请求');
  assert.match(post.url, /\/api\/item\/REQ-20990101-001\/content\?project=%2Fproject%2Fa$/, '保存绑定打开时项目与条目');
  assert.equal(post.opts.method, 'POST');
  assert.deepEqual(JSON.parse(post.opts.body), { title: '新标题', description: '新描述正文' });
  assert.equal(h.run("$('#editModalWrap').classList.contains('hidden')"), true, '成功后关闭面板');
  assert.ok((h.run('globalThis.__toasts') || []).some((m) => m.includes('REQ-20990101-001') && m.includes('已更新')), '成功应 toast 编号与更新提示');
  assert.equal(h.run('globalThis.__polled'), 1, '成功应刷新看板');
  assert.equal(h.run('globalThis.__drawerRefreshed'), 1, '详情打开该条目应刷新详情');
  assert.ok(btn.focusLog.length >= 1, '成功后焦点返回入口');
});

t('E12 沙箱：同屏互斥旧机制下线后 uiConfirm 居中确认不受影响（删除等入口保留）', () => {
  assert.match(APP_JS, /function uiConfirm\(/, 'uiConfirm 应保留');
  assert.match(APP_JS, /confirmActive/, 'uiConfirm 自身互斥机制应保留');
  assert.match(APP_JS, /data-delete-id=/, '删除入口保留');
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n${e.stack}`); }
}
console.log(`\n${cases.length} 个用例，失败 ${failed}`);
process.exitCode = failed ? 1 : 0;
