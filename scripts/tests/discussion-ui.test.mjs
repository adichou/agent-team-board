#!/usr/bin/env node
// REQ-20260909-004 开放式讨论模块重构 —— 前端契约 + 行为测试（U1~U8）
// U1/U2/U6/U7/U8 为源码静态契约（index.html / app.js / oncall.js / style.css），
// U3/U4/U5 为静态契约 + vm 行为（加载实际 oncall.js，fetch stub 返回 board / 详情）。
// 用法：node scripts/tests/discussion-ui.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const oncallJs = fs.readFileSync(path.join(webRoot, 'oncall.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// oncall.js 函数位于 IIFE 内缩进两格（discussion-tabs 测试同法）：提取函数源码做静态契约断言
function fnSrc(name) {
  const m = oncallJs.match(new RegExp(`^[ \\t]*(?:async )?function ${name}\\([\\s\\S]*?^  \\}`, 'm'));
  assert.ok(m, `应存在 ${name} 函数`);
  return m[0];
}

/* ---------- vm 接缝（oncall-view-lean.test.mjs 同法） ---------- */
function element() {
  const nodes = new Map();
  const classes = new Set();
  return {
    nodes, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', disabled: false, checked: false, hidden: false,
    children: [], listeners: {},
    classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v), toggle: (v, on) => on ? classes.add(v) : classes.delete(v) },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, element()); return nodes.get(sel); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = c; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    closest() { return null; },
    get scrollTop() { return 0; }, set scrollTop(v) {},
  };
}

function setup({ board, detail }) {
  const document = element();
  document.createElement = element;
  document.body = element();
  document.querySelector = (sel) => document.nodes.get(sel) ?? null;
  document.nodes.set('#oncallView', element());
  document.nodes.set('#ocList', element());
  document.nodes.set('#ocDetail', element());
  document.nodes.set('#discMask', element());
  document.nodes.set('#oncallLightbox', element());
  document.addEventListener = () => {};
  const sandbox = {
    document, console, URLSearchParams, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    marked: { parse: (s) => String(s || '') },
    fetch: async (url) => {
      if (String(url).includes('/api/discussion/board')) return { ok: true, json: async () => board };
      if (detail && String(url).includes(`/api/discussion/`)) return { ok: true, json: async () => ({ discussion: detail }) };
      return { ok: true, json: async () => ({}) };
    },
    navigator: { clipboard: { writeText: async () => {} } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(oncallJs, sandbox, { filename: 'oncall.js' });
  return sandbox;
}

// 列表内容：空态走 innerHTML 字符串，有记录时经 replaceChildren 注入卡片（桩不解析 HTML）
function listHtml(h) {
  const list = h.document.querySelector('#ocList');
  return [list.innerHTML || '', ...(list.children || []).map((c) => c.innerHTML || '')].join('\n');
}

const disc = (id, over = {}) => ({
  id, title: `t-${id}`, status: 'discussing', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T01:00:00.000Z',
  phase: 'none', waiting: false, draftCount: 0, createdCount: 0, ...over,
});

t('U1 骨架：两档胶囊筛选 + 计数；复用 req-split 左右分栏；窄屏返回保留滚动位置', async () => {
  const board = { initialized: true, discussions: [
    disc('ASK-20990909-001'), disc('ASK-20990909-002'), disc('ASK-20990909-003', { status: 'archived' }),
  ] };
  const h = setup({ board });
  await h.ATBOncall.poll('/p', true);
  const viewHtml = h.document.querySelector('#oncallView').innerHTML;
  assert.match(viewHtml, /class="filter-chip active" data-filter="discussing"/, '缺省选中「讨论中」');
  assert.match(viewHtml, /data-filter="discussing">讨论中 <span class="filter-count">2<\/span>/, '讨论中计数');
  assert.match(viewHtml, /data-filter="archived">已归档 <span class="filter-count">1<\/span>/, '已归档计数');
  assert.doesNotMatch(viewHtml, /data-filter="pending"|data-filter="answering"|data-filter="answered"|data-filter="failed"/, '不得再有旧四态筛选');
  assert.match(oncallJs, /req-split/, '宽屏左右分栏应复用 req-split 结构');
  assert.match(oncallJs, /返回列表/, '窄屏应有「返回列表」入口');
  assert.match(oncallJs, /scrollTop/, '返回列表应恢复列表滚动位置');
  assert.match(css, /\.disc-view\s*\{/, 'disc-view 容器样式存在');
});

t('U2 列表行：标题、编号、两态状态、最近更新与成果提示副标题；按最近更新排序', async () => {
  const board = { initialized: true, discussions: [
    disc('ASK-20990909-001', { phase: 'waiting' }),
    disc('ASK-20990909-002', { phase: 'drafts', draftCount: 2, createdCount: 1, updatedAt: '2026-09-09T02:00:00.000Z' }),
    disc('ASK-20990909-003', { status: 'archived', phase: 'ready' }),
  ] };
  const h = setup({ board });
  await h.ATBOncall.poll('/p', true);
  const rows = listHtml(h);
  assert.match(rows, /t-ASK-20990909-002/, '列表行应展示标题');
  assert.match(rows, /ASK-20990909-002/, '列表行应展示编号');
  assert.match(rows, /等待纪要/, '阶段提示：等待纪要');
  assert.match(rows, /有待创建草稿/, '阶段提示：有待创建草稿');
  assert.ok(rows.indexOf('t-ASK-20990909-002') < rows.indexOf('t-ASK-20990909-001'), '按最近更新排序');
  const viewHtml = h.document.querySelector('#oncallView').innerHTML;
  assert.match(viewHtml, /data-filter="archived">已归档 <span class="filter-count">1<\/span>/, '已归档档计数（默认档不显示归档行）');
});

t('U3 详情操作与提示词复制回退（REQ-20260910-018：整理结论替代讨论完毕，新增复制继续讨论提示词）', () => {
  assert.match(oncallJs, /启动提示词/, '详情头应有启动提示词按钮');
  assert.match(oncallJs, /复制继续讨论提示词/, '详情头应有复制继续讨论提示词按钮');
  assert.match(oncallJs, /整理结论/, '详情头应有整理结论按钮（原「讨论完毕」）');
  assert.ok(!fnSrc('renderDetail').includes('讨论完毕'), '详情操作区不再有「讨论完毕」按钮');
  assert.match(oncallJs, /归档讨论|归档/, '详情头应有归档操作');
  assert.match(oncallJs, /继续讨论/, '已归档详情应有继续讨论');
  assert.match(oncallJs, /复制提示词/, '应有复制提示词按钮');
  assert.match(oncallJs, /Ctrl\+C|⌘C/, '剪贴板不可用应提示手动复制');
  assert.match(oncallJs, /select\(\)/, '回退应全选文本');
  assert.match(oncallJs, /readonly/, '提示词为只读文本');
});

t('U4 阶段反馈仅为提示：失败原因与重试入口，不渲染半成品', () => {
  assert.match(oncallJs, /纪要读取失败|读取失败/, '失败态应有说明');
  assert.match(oncallJs, /重新读取|重试/, '失败态应有重试入口');
  assert.match(oncallJs, /reread/, '重试应调用 reread 接口');
  assert.match(oncallJs, /等待纪要/, '等待纪要仅为反馈');
  assert.doesNotMatch(oncallJs, /state\.filter = 'waiting'|data-filter="waiting"/, '等待纪要不得成为筛选项');
});

t('U5 后续行动区：勾选/编辑/批量创建/仅重试失败项/已创建跳转', () => {
  // REQ-20260910-018：详情三页签「讨论纪要 / 交流记录 / 后续行动」（原纪要/成果页签归并）
  assert.match(oncallJs, />讨论纪要/, '详情应有「讨论纪要」页签');
  assert.match(oncallJs, />交流记录/, '详情应有「交流记录」页签');
  assert.match(oncallJs, />后续行动/, '详情应有「后续行动」页签');
  assert.match(oncallJs, /create-items/, '批量创建应调 create-items 接口');
  assert.match(oncallJs, /type="checkbox"/, '草稿应有勾选框');
  assert.match(oncallJs, /先勾选|未勾选/, '未勾选任何条目应提示');
  assert.match(oncallJs, /重试|仅重试/, '失败项可单独重试');
  assert.match(oncallJs, /跳转条目|data-goto-item/, '已创建成果应有跳转入口');
  assert.match(oncallJs, /验收标准/, '草稿字段应含验收标准');
  assert.match(oncallJs, /复现/, 'Bug 草稿应含复现字段');
});

t('U6 新建：弹窗仅标题（必填）+ 背景（可选）；保存后定位新讨论并展示启动提示词（REQ-20260909-013：讨论类型入口暂态隐藏，创建链路保留待恢复）', () => {
  assert.doesNotMatch(html, /option value="ask">讨论/, '「讨论」类型选项随 REQ-20260909-013 暂态隐藏（口径见 requirements/REQ-20260909-013/design.md 待确认 2 裁定）');
  assert.doesNotMatch(html, /id="fReq"/, '弹窗不应再有关联需求字段');
  assert.doesNotMatch(html, /id="fAttach"/, '弹窗不应再有截图附件字段');
  assert.match(app, /背景（可选）|背景/, '描述字段按讨论类型改标为背景');
  assert.match(app, /\/api\/discussion'/, '讨论创建应走 /api/discussion');
  assert.match(app, /ATBOncall\?\.reveal|ATBOncall\.reveal/, '创建成功应定位新讨论');
  assert.match(oncallJs, /reveal/, '模块应导出 reveal 定位并展示启动提示词');
  assert.match(app, /标题不能为空/, '标题为空应阻止保存并就地提示');
});

t('U7 双向关联：条目详情来源讨论跳转；讨论详情跳条目', () => {
  assert.match(app, /sourceDiscussion/, '条目详情应展示来源讨论');
  assert.match(app, /来源讨论/, '条目 meta 区应有来源讨论字段');
  assert.match(app, /atb:open-discussion|ATBOncall\?\.openItem/, '条目侧应可跳回讨论详情');
  assert.match(oncallJs, /atb:open-item|openItem/, '讨论侧已创建成果应可跳条目');
});

t('U8 兼容：旧单按讨论中展示且历史问答只读保留；新模块不再派单', () => {
  assert.doesNotMatch(oncallJs, /\/api\/oncall\/dispatch/, '新 UI 不应再调用派单接口');
  assert.doesNotMatch(oncallJs, /批量派单|提交追问/, '不应再有派单/追问入口');
  assert.match(oncallJs, /历史问答|旧/, '旧单历史问答应只读保留');
  assert.match(oncallJs, /\/api\/oncall\/ticket\/.+\/attachment/, '旧单附件仍经 oncall 附件端点展示');
  assert.match(app, /'讨论中'|>讨论中</, '需求抽屉旧绑定讨论按两态口径展示');
  assert.match(app, /'已归档'|>已归档</, '需求抽屉旧绑定讨论按两态口径展示');
});

t('U9 行为：未初始化项目空态引导', async () => {
  const h = setup({ board: { initialized: false, discussions: [] } });
  await h.ATBOncall.poll('/p', true);
  const viewHtml = h.document.querySelector('#oncallView').innerHTML;
  assert.match(viewHtml, /尚未初始化/, '未初始化应引导先初始化看板');
});

t('U10 行为：空列表引导新建；已归档空档正常空态', async () => {
  const h = setup({ board: { initialized: true, discussions: [] } });
  await h.ATBOncall.poll('/p', true);
  const rows = listHtml(h);
  assert.match(rows, /＋ 新建/, '空列表应引导新建讨论');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
}
console.log(failed ? `\n${failed} 个用例未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
