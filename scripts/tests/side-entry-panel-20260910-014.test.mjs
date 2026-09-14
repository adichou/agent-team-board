#!/usr/bin/env node
// REQ-20260910-014 管理项目 / 新建按钮改用与「全局」一致的右侧侧拉面板 —— 零依赖（node:assert），
// 静态断言 index.html / app.js / style.css（沿用 global-entry-panel-20260910-004.test.mjs 契约风格）。
// 用法：node scripts/tests/side-entry-panel-20260910-014.test.mjs
// 覆盖条目 test-cases.md V1–V9；浏览器交互（焦点 / 连续点击 / 窄屏）按验收标准人工核对。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(sel) {
  const m = flat.match(new RegExp(`(?:^|[{}])\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `缺少规则 ${sel}`);
  return m[1];
}

function fnBody(src, name) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `未找到函数 ${name}`);
  return m[1];
}

const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/);
const newPanel = html.match(/<div id="modalWrap"[\s\S]*?(?=\n\s*<!--[^>]*REQ-20260910-005 项目管理|<div id="projModalWrap")/);
const projPanel = html.match(/<div id="projModalWrap"[\s\S]*?(?=\n\s*<!--[^>]*REQ-20260910-007 快捷键)/);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('V1 入口语义：管理项目 / 新建为面板弹出按钮（type=button + aria-haspopup + aria-expanded + aria-controls）', () => {
  assert.ok(topbar, '未找到顶栏');
  const manage = topbar[1].match(/<button id="btnProjManage"[^>]*>/);
  assert.ok(manage, '缺少 #btnProjManage 开始标签');
  assert.match(manage[0], /type="button"/, '管理项目须可键盘访问（type=button）');
  assert.match(manage[0], /aria-haspopup="dialog"/, '管理项目应声明弹出面板语义');
  assert.match(manage[0], /aria-expanded="false"/, '管理项目初始 aria-expanded=false，随面板开合同步');
  assert.match(manage[0], /aria-controls="projModalWrap"/, '管理项目应通过 aria-controls 指向面板容器');
  const create = topbar[1].match(/<button id="btnNew"[^>]*>/);
  assert.ok(create, '缺少 #btnNew 开始标签');
  assert.match(create[0], /type="button"/, '新建须可键盘访问（type=button）');
  assert.match(create[0], /aria-haspopup="dialog"/, '新建应声明弹出面板语义');
  assert.match(create[0], /aria-expanded="false"/, '新建初始 aria-expanded=false，随面板开合同步');
  assert.match(create[0], /aria-controls="modalWrap"/, '新建应通过 aria-controls 指向面板容器');
});

t('V2 新建面板结构：右侧面板（非遮罩）+ 常驻头部（标题/说明/✕）+ 表单分区顺序不变', () => {
  assert.ok(newPanel, '应有 #modalWrap 容器');
  const p = newPanel[0];
  assert.doesNotMatch(p, /class="modal-wrap/, '#modalWrap 不得再用 .modal-wrap 全屏遮罩');
  assert.doesNotMatch(p, /class="modal"/, '#modalWrap 不得再含居中 .modal 容器');
  assert.match(p, /class="side-panel hidden"/, '面板为右侧侧拉形态（side-panel + hidden 初始隐藏）');
  assert.match(p, /role="dialog"/, '面板为 dialog 角色');
  assert.match(p, /aria-label="新建条目"/, '面板可访问名称标注新建条目');
  // 头部常驻：标题 + 一句说明 + ✕ 关闭，均在内容区之前
  assert.match(p, /<h3>新建条目<\/h3>/, '面板标题「新建条目」');
  const head = p.match(/<header class="side-panel-head">[\s\S]*?<\/header>/);
  assert.ok(head, '应有常驻面板头部');
  assert.match(head[0], /side-panel-scope/, '头部应有一句简短说明');
  assert.match(head[0], /id="modalClose"[^>]*aria-label="关闭新建面板"/, '头部应有常驻关闭按钮（可访问名称）');
  const iHead = p.indexOf('class="side-panel-head"');
  const iBody = p.indexOf('id="newForm"');
  assert.ok(iHead !== -1 && iBody !== -1 && iHead < iBody, '头部应在表单内容区之前（常驻不随内容滚动）');
  assert.match(p, /class="side-panel-body"/, '应有独立滚动的面板内容区');
  // 表单字段与顺序不变：类型 → 标题 → 描述 → 截图区块 → 操作按钮（.modal-foot 契约保留）
  const order = ['id="fType"', 'id="fTitle"', 'id="fDesc"', 'id="fShotRow"', 'class="modal-foot"'];
  let last = -1;
  for (const id of order) {
    const i = p.indexOf(id);
    assert.ok(i > last, `表单应含 ${id} 且顺序不变`);
    last = i;
  }
  for (const id of ['fShotPick', 'fShotFile', 'fShotList', 'fShotCount', 'fShotEmpty', 'fShotError', 'modalCancel', 'fSubmit']) {
    assert.ok(p.includes(`id="${id}"`), `缺少 #${id}（功能不增减）`);
  }
  assert.match(p, /id="modalCancel"[^>]*>取消</, '取消按钮保留');
  assert.match(p, /id="fSubmit"[^>]*>创建</, '创建按钮保留');
});

t('V3 管理项目面板结构：右侧面板 + 常驻头部 + 内容分区与顺序不变', () => {
  assert.ok(projPanel, '应有 #projModalWrap 容器');
  const p = projPanel[0];
  assert.doesNotMatch(p, /class="modal-wrap/, '#projModalWrap 不得再用 .modal-wrap 全屏遮罩');
  assert.doesNotMatch(p, /proj-modal/, '#projModalWrap 不得再含居中 .proj-modal 容器');
  assert.match(p, /class="side-panel hidden"/, '面板为右侧侧拉形态');
  assert.match(p, /role="dialog"/, '面板为 dialog 角色');
  assert.match(p, /aria-label="项目管理"/, '面板可访问名称标注项目管理');
  assert.match(p, /<h3>项目管理<\/h3>/, '面板标题「项目管理」');
  const head = p.match(/<header class="side-panel-head">[\s\S]*?<\/header>/);
  assert.ok(head, '应有常驻面板头部');
  assert.match(head[0], /side-panel-scope/, '头部应有一句简短说明');
  assert.match(head[0], /id="projClose"[^>]*aria-label="关闭项目管理面板"/, '头部应有常驻关闭按钮（可访问名称）');
  const iHead = p.indexOf('class="side-panel-head"');
  const iForm = p.indexOf('id="projForm"');
  assert.ok(iHead !== -1 && iForm !== -1 && iHead < iForm, '头部应在表单内容区之前');
  assert.match(p, /class="side-panel-body"/, '应有独立滚动的面板内容区');
  // 内容分区与顺序不变：表单 → 状态通知 → 检测栏 → 项目列表 → 批量确认 → 单项确认
  const order = ['id="projForm"', 'id="projNotice"', 'id="projScanBar"', 'id="projList"', 'id="projBatchConfirm"', 'id="projConfirm"'];
  let last = -1;
  for (const id of order) {
    const i = p.indexOf(id);
    assert.ok(i > last, `面板应含 ${id} 且分区顺序不变`);
    last = i;
  }
  for (const id of ['projMode', 'projPath', 'projTarget', 'projSubmit', 'projCancel', 'projScanSummary', 'projScanBtn', 'projRemoveMissingBtn', 'projBatchOk', 'projBatchCancel', 'projRemoveOk', 'projRemoveCancel']) {
    assert.ok(p.includes(`id="${id}"`), `缺少 #${id}（功能不增减）`);
  }
});

t('V4 样式形态：贴右缘通高、min(560px,92vw)、z-index 25、左描边+向左投影、头部常驻内容区滚动、窄屏全宽', () => {
  const panel = rule('.side-panel');
  assert.match(panel, /position:\s*fixed/, '面板为固定定位');
  assert.match(panel, /top:\s*0/, '面板贴顶通高');
  assert.match(panel, /right:\s*0/, '面板贴屏幕右缘');
  assert.match(panel, /bottom:\s*0/, '面板贴底通高');
  assert.match(panel, /z-index:\s*25/, '面板层级与全局面板一致（25）');
  assert.match(panel, /width:\s*min\(560px,\s*92vw\)/, '面板宽度与全局面板一致');
  assert.match(panel, /display:\s*flex/, '面板为纵向弹性布局');
  assert.match(panel, /flex-direction:\s*column/, '面板纵向排布（头部 + 滚动内容区）');
  assert.match(panel, /border-left:\s*1px solid var\(--border\)/, '左侧 1px 描边（走 CSS 变量）');
  assert.match(panel, /box-shadow:\s*-\d+px\s+0/, '投影向左（贴右缘面板特征）');
  assert.match(panel, /background:\s*var\(--bg\)/, '面板背景走 CSS 变量（深浅色自动适配）');
  const head = rule('.side-panel-head');
  assert.match(head, /flex:\s*none/, '头部不被压缩（关闭按钮任何宽度可达）');
  assert.match(head, /border-bottom:\s*1px solid var\(--border\)/, '头部与内容区分隔');
  const body = rule('.side-panel-body');
  assert.match(body, /flex:\s*1/, '内容区占余高');
  assert.match(body, /min-height:\s*0/, '内容区允许在弹性布局内收缩滚动');
  assert.match(body, /overflow-y:\s*auto/, '内容区独立滚动');
  // 窄屏（≤640px）：全宽、无左描边（与全局面板同一断点）
  const narrow = flat.match(/@media \(max-width:\s*640px\)\s*\{([^]*?)\.side-panel\s*\{([^}]*)\}/);
  assert.ok(narrow, '窄屏断点应覆盖 .side-panel');
  assert.match(narrow[2], /width:\s*100vw/, '窄屏面板全宽');
  assert.match(narrow[2], /border-left:\s*none/, '窄屏无左描边');
});

t('V5 开合行为：幂等守卫、hidden 开合、aria 同步、焦点进入面板并返回入口', () => {
  const openNew = fnBody(js, 'openModal');
  assert.match(openNew, /classList\.contains\('hidden'\)\)[^;]*;?\s*return/, '重复打开新建面板应幂等守卫（不叠加面板）');
  assert.match(openNew, /classList\.remove\('hidden'\)/, '打开移除 hidden');
  assert.match(openNew, /#btnNew[^;]*setAttribute\('aria-expanded', 'true'\)|setAttribute\('aria-expanded', 'true'\)[^;]*#btnNew/, '打开同步入口 aria-expanded=true');
  assert.match(openNew, /\$\('#fTitle'\)\.focus\(\)/, '打开后焦点进入标题输入框');
  const closeNew = fnBody(js, 'closeModal');
  assert.match(closeNew, /classList\.add\('hidden'\)/, '关闭恢复 hidden');
  assert.match(closeNew, /aria-expanded', 'false'/, '关闭同步入口 aria-expanded=false');
  assert.match(closeNew, /#btnNew.*focus|focus\(\)/, '关闭后焦点返回入口 #btnNew');
  const openProj = fnBody(js, 'openProjPanel');
  assert.match(openProj, /classList\.contains\('hidden'\)\)[^;]*;?\s*return/, '重复打开管理项目面板应幂等守卫（不叠加面板）');
  assert.match(openProj, /classList\.remove\('hidden'\)/, '打开移除 hidden');
  assert.match(openProj, /#btnProjManage[^;]*setAttribute\('aria-expanded', 'true'\)|setAttribute\('aria-expanded', 'true'\)/, '打开同步入口 aria-expanded=true');
  assert.match(openProj, /\$\('#projPath'\)\.focus\(\)/, '打开后焦点进入路径输入框');
  const closeProj = fnBody(js, 'closeProjPanel');
  assert.match(closeProj, /classList\.add\('hidden'\)/, '关闭恢复 hidden');
  assert.match(closeProj, /aria-expanded', 'false'/, '关闭同步入口 aria-expanded=false');
  assert.match(closeProj, /opener|btnProjManage/, '关闭后焦点返回打开入口（opener 记录，回落 #btnProjManage）');
});

t('V6 Esc 关闭链顺序不变：管理项目面板 → 新建面板 → 全局面板 → 详情抽屉；两面板仍让位单键快捷键', () => {
  const fn = fnBody(js, 'onGlobalKeydown');
  const esc = fn.slice(fn.indexOf("e.key === 'Escape'"));
  const iProj = esc.indexOf('closeProjPanel');
  const iNew = esc.indexOf('closeModal');
  const iGlobal = esc.indexOf('closeGlobalPanel');
  const iDrawer = esc.indexOf('closeDrawer');
  for (const [name, idx] of [['closeProjPanel', iProj], ['closeModal', iNew], ['closeGlobalPanel', iGlobal], ['closeDrawer', iDrawer]]) {
    assert.ok(idx !== -1, `Escape 链应包含 ${name}`);
  }
  assert.ok(iProj < iNew && iNew < iGlobal && iGlobal < iDrawer, '关闭顺序应为：管理项目面板 → 新建面板 → 全局面板 → 详情抽屉');
  const any = fnBody(js, 'anyModalOpen');
  assert.match(any, /#modalWrap/, 'anyModalOpen 应覆盖新建面板（单键快捷键让位）');
  assert.match(any, /#projModalWrap/, 'anyModalOpen 应覆盖管理项目面板（单键快捷键让位）');
});

t('V7 遮罩形态取消：新建面板不再挂「点击遮罩空白关闭」监听；.modal-wrap 样式保留给仍居中的弹窗', () => {
  assert.doesNotMatch(js, /\$\('#modalWrap'\)\.addEventListener\('click', \(e\) => \{\s*if \(e\.target === \$\('#modalWrap'\)\) closeModal\(\)/,
    '不得再有点击遮罩空白关闭（面板无全屏遮罩，仅 ✕ / Esc / 取消关闭）');
  assert.doesNotMatch(js, /\$\('#projModalWrap'\)\.addEventListener\('click'/, '管理项目面板同样不得挂遮罩点击关闭');
  // .modal-wrap 样式本身保留（快捷键帮助等仍居中的弹窗继续使用）
  assert.match(flat, /\.modal-wrap\s*\{/, '.modal-wrap 全屏遮罩样式保留给其余居中弹窗');
});

t('V8 入口接线与空态卡入口保留：btnNew / btnProjManage / btnOpenProjManage 均指向原开合函数', () => {
  assert.match(js, /\$\('#btnNew'\)\.addEventListener\('click', \(\) => openModal\(\)\)/, '顶栏「＋ 新建」接线不变');
  assert.match(js, /\$\('#btnProjManage'\)\.addEventListener\('click', openProjPanel\)/, '顶栏「管理项目」接线不变');
  assert.match(js, /\$\('#btnOpenProjManage'\)\?\.addEventListener\('click', openProjPanel\)/, '空态卡「管理项目」入口仍指向 openProjPanel');
  assert.match(js, /\$\('#modalClose'\)\.addEventListener\('click', closeModal\)/, '新建面板 ✕ 关闭接线保留');
  assert.match(js, /\$\('#modalCancel'\)\.addEventListener\('click', closeModal\)/, '新建面板取消接线保留');
  assert.match(js, /\$\('#projClose'\)\.addEventListener\('click', closeProjPanel\)/, '管理项目面板 ✕ 关闭接线保留');
  assert.match(js, /\$\('#projCancel'\)\.addEventListener\('click', closeProjPanel\)/, '管理项目面板关闭按钮接线保留');
});

t('V9 深浅色：面板表面颜色全部走 CSS 变量，无硬编码色值', () => {
  const panelRule = rule('.side-panel');
  // 表面色（背景 / 文字 / 描边）必须走变量（投影 rgba 与全局面板先例一致，不属表面色）
  for (const prop of ['background', 'color', 'border-left']) {
    const m = panelRule.match(new RegExp(`${prop}:\\s*([^;}]+)`));
    if (m) assert.match(m[1], /var\(--/, `.side-panel 的 ${prop} 应走 CSS 变量`);
  }
  assert.match(panelRule, /background:\s*var\(--bg\)/, '背景走 CSS 变量');
  const headRule = rule('.side-panel-head');
  assert.match(headRule, /var\(--border\)/, '头部描边走 CSS 变量');
  const scopeRule = rule('.side-panel-scope');
  assert.match(scopeRule, /var\(--muted\)/, '说明文字颜色走 CSS 变量');
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
