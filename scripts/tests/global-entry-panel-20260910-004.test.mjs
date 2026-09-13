#!/usr/bin/env node
// BUG-20260910-004 全局模块入口移到右上角「管理项目」右边 —— 零依赖（node:assert），
// 静态断言 index.html / app.js / style.css（沿用 view-tabs-right.test.mjs 契约风格）。
// 用法：node scripts/tests/global-entry-panel-20260910-004.test.mjs
// 覆盖条目 README 验收说明 B1–B12；浏览器交互（焦点 / 连续点击 / 窄屏）按验收标准人工核对。

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
const nav = html.match(/<nav class="module-nav"[\s\S]*?<\/nav>/);

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('B1 顶栏入口：「全局」紧邻「管理项目」右侧，非视图切换 tab，带面板语义标注', () => {
  assert.ok(topbar, '未找到顶栏');
  const iManage = topbar[1].indexOf('id="btnProjManage"');
  const iGlobal = topbar[1].indexOf('id="btnGlobal"');
  assert.ok(iManage !== -1, '顶栏应有「管理项目」按钮');
  assert.ok(iGlobal !== -1, '顶栏应有「全局」入口按钮 #btnGlobal');
  assert.ok(iGlobal > iManage, '「全局」应位于「管理项目」之后（紧邻右侧）');
  // 「管理项目」与「全局」之间不得插入其他按钮（相邻顺序）
  const manageEnd = topbar[1].indexOf('</button>', iManage) + '</button>'.length;
  const globalStart = topbar[1].lastIndexOf('<button', iGlobal);
  const between = topbar[1].slice(manageEnd, globalStart);
  assert.doesNotMatch(between, /<button/, '「管理项目」与「全局」之间不得有其他按钮');
  const btn = topbar[1].match(/<button id="btnGlobal"[^>]*>/);
  assert.ok(btn, '缺少 #btnGlobal 开始标签');
  assert.match(btn[0], /type="button"/, '入口须可键盘访问（type=button）');
  assert.doesNotMatch(btn[0], /view-tab/, '顶栏入口不得复用视图切换 tab（顶栏无视图切换契约保持）');
  assert.match(btn[0], /aria-haspopup="dialog"/, '入口应声明弹出面板语义');
  assert.match(btn[0], /aria-expanded="false"/, '入口初始 aria-expanded=false，随面板开合同步');
  assert.match(btn[0], /aria-controls="globalPanel"/, '入口应通过 aria-controls 指向面板容器');
  assert.match(topbar[1].slice(iGlobal), />全局</, '入口文案为「全局」');
});

t('B2 第二行模块导航移除「全局」：只剩项目模块，无重复入口', () => {
  assert.ok(nav, '未找到模块导航');
  assert.doesNotMatch(nav[0], /data-view="global"/, '模块导航不得再含全局入口（避免重复入口）');
  const order = [...nav[0].matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  // REQ-20260909-013 起讨论 / 文件、REQ-20260911-002 起营销 / 发布入口暂态隐藏（恢复见各条目 design.md）
  assert.deepEqual(order, ['status', 'build', 'runs', 'settings'], // REQ-20260913-001 新增构建
    '导航顺序应为 需求/任务 + 末位设置（全局已移至顶栏；讨论 / 文件 / 营销 / 发布暂隐藏）');
});

t('B3 面板结构：右侧面板常驻节点 = 标题 + 跨项目说明 + 关闭按钮 + 独立搜索 + 滚动内容区', () => {
  const panel = html.match(/<aside id="globalPanel"[\s\S]*?<\/aside>/);
  assert.ok(panel, '应有 #globalPanel 侧边面板容器');
  const p = panel[0];
  assert.match(p, /class="global-panel hidden"/, '面板初始隐藏（hidden 由开合控制）');
  assert.match(p, /role="dialog"/, '面板为 dialog 角色');
  assert.match(p, /aria-label="全局任务（跨项目）"/, '面板可访问名称标注全局任务与跨项目范围');
  assert.match(p, /<h2>全局任务<\/h2>/, '面板标题「全局任务」');
  assert.match(p, /跨项目/, '面板头部应有跨项目范围说明');
  assert.match(p, /id="globalPanelClose"[^>]*aria-label="关闭全局任务面板"/, '应有常驻关闭按钮（可访问名称）');
  assert.match(p, /id="globalSearchInput"/, '面板应有独立搜索输入（不复用第三行 #searchInput）');
  assert.doesNotMatch(p, /id="searchInput"/, '面板内不得复用模块搜索输入框');
  assert.match(p, /placeholder="搜项目 \/ 批次号 \/ 条目编号…"/, '面板搜索占位符沿用全局口径');
  assert.match(p, /id="globalPanelBody"/, '应有 #globalPanelBody 内容容器');
  // 关闭按钮位于静态头部（不随内容重渲染）：加载 / 失败状态不阻塞关闭
  const iClose = p.indexOf('id="globalPanelClose"');
  const iBody = p.indexOf('id="globalPanelBody"');
  assert.ok(iClose !== -1 && iBody !== -1 && iClose < iBody, '关闭按钮应在内容区之前（静态头部，不随内容重渲染）');
});

t('B4 开合交互：打开幂等不叠加、aria 同步、焦点进入；关闭隐藏并归还焦点给入口', () => {
  assert.match(js, /function openGlobalPanel\(/, '应有 openGlobalPanel');
  assert.match(js, /function closeGlobalPanel\(/, '应有 closeGlobalPanel');
  const open = fnBody(js, 'openGlobalPanel');
  assert.match(open, /state\.global\.open\)[^;]*;?\s*return|state\.global\.open[^;\n]*return/, '重复打开应幂等守卫（不叠加面板）');
  assert.match(open, /classList\.remove\('hidden'\)/, '打开移除 hidden');
  assert.match(open, /setAttribute\('aria-expanded', 'true'\)/, '打开同步入口 aria-expanded=true');
  assert.match(open, /#globalPanelClose.*focus|focus\(\)/, '打开后焦点进入面板（关闭按钮为首个可达控件）');
  const close = fnBody(js, 'closeGlobalPanel');
  assert.match(close, /classList\.add\('hidden'\)/, '关闭恢复 hidden');
  assert.match(close, /aria-expanded', 'false'/, '关闭同步入口 aria-expanded=false');
  assert.match(close, /#btnGlobal.*focus|focus\(\)/, '关闭后焦点返回入口 #btnGlobal');
  // 入口与关闭按钮接线
  assert.match(js, /\$\('#btnGlobal'\)\?\.addEventListener\('click', openGlobalPanel\)/, '顶栏入口点击应打开面板');
  assert.match(js, /\$\('#globalPanelClose'\)\?\.addEventListener\('click', \(\) => closeGlobalPanel\(\)\)/, '关闭按钮点击应关闭面板');
});

t('B5 打开面板不切换模块：global 不再是主视图，旧深链 / 快照 / 回放收敛为打开面板', () => {
  assert.match(js, /const VIEWS = \['status', 'oncall', 'build', 'runs', 'files', 'marketing', 'release', 'settings'\]/, 'VIEWS 不应再含 global（主视图收敛为模块列表；REQ-20260910-019 增 marketing；REQ-20260913-001 增 build）');
  const setV = fnBody(js, 'setView');
  assert.match(setV, /v === 'global'[\s\S]{0,200}openGlobalPanel\(\)/, "setView('global') 应收敛为打开面板");
  const beforeGuard = setV.slice(0, setV.indexOf('openGlobalPanel'));
  assert.doesNotMatch(beforeGuard, /state\.view = v/, '打开面板不得改写 state.view（不切换当前模块）');
  // 深链与浏览器回放兼容
  assert.match(js, /viewRaw === 'global'/, 'boot 应将旧 view=global 深链视为有效入口（打开面板）');
  assert.match(js, /VIEWS\.includes\(v\) \|\| v === 'global'/, 'popstate 回放应兼容 view=global（打开面板）');
  // 模块搜索不再解释全局（全局改用面板内独立搜索）
  const ph = js.match(/const SEARCH_PLACEHOLDER\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(ph, '缺少 SEARCH_PLACEHOLDER');
  assert.doesNotMatch(ph[1], /\bglobal:/, '模块搜索占位符不应再含 global（面板有独立搜索）');
  const scope = js.match(/const SEARCH_SCOPE\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(scope, '缺少 SEARCH_SCOPE');
  assert.doesNotMatch(scope[1], /\bglobal:/, '模块搜索范围标签不应再含 global');
  const sub = js.match(/const MODULE_SUB\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(sub, '缺少 MODULE_SUB');
  assert.doesNotMatch(sub[1], /\bglobal:/, '第三行模块副标题不应再含 global');
});

t('B6 面板独立搜索：词存 state.global.q，防抖复用常量，不写第三行模块搜索状态', () => {
  const bind = fnBody(js, 'bindGlobalPanelOnce');
  assert.ok(bind, '缺少 bindGlobalPanelOnce');
  assert.match(bind, /#globalSearchInput/, '应绑定面板搜索输入');
  assert.match(bind, /SEARCH_DEBOUNCE_MS/, '面板搜索防抖复用既有常量');
  assert.match(bind, /state\.global\.q\s*=/, '面板搜索词写入 state.global.q');
  assert.doesNotMatch(bind, /state\.search\.q\s*=/, '面板搜索不得写第三行模块搜索状态（不污染原页面搜索条件）');
  assert.match(bind, /e\.key === 'Escape'[\s\S]{0,160}stopPropagation/, '面板搜索内 Esc 只清空并阻止冒泡（不触发关面板链）');
  const render = fnBody(js, 'renderGlobalView');
  assert.match(render, /state\.global\.q/, '面板渲染按 state.global.q 前端过滤');
  assert.doesNotMatch(render, /state\.search\.q/, '面板渲染不得读取模块搜索词');
});

t('B7 数据链路：拉取与轮询以「面板打开」为条件，渲染进面板内容区', () => {
  assert.match(js, /if \(state\.global\.open\) await refreshGlobal\(\)/, '主轮询应随面板打开刷新全局数据');
  const refresh = fnBody(js, 'refreshGlobal');
  assert.match(refresh, /if \(!state\.global\.open\) return;/, 'refreshGlobal 守卫应为面板打开（不再是主视图）');
  const render = fnBody(js, 'renderGlobalView');
  assert.match(render, /\$\('#globalPanelBody'\)/, '渲染应写入 #globalPanelBody（头部与搜索不随内容重渲染）');
  assert.doesNotMatch(js, /\$\('#globalView'\)/, '旧 #globalView 容器引用应移除');
  assert.doesNotMatch(html, /id="globalView"/, 'index.html 不应再有 #globalView 主视图容器');
});

t('B8 跳转：进入项目任务前关闭面板，跳转语义（switchProject / gotoRuns / openDrawer）保留', () => {
  const fn = fnBody(js, 'gotoProjectTask');
  assert.match(fn, /closeGlobalPanel\(/, '跳转前应关闭全局面板');
  assert.match(fn, /switchProject\(/, '跳转仍切换到对应项目');
  assert.match(fn, /gotoRuns\(|openDrawer\(/, '跳转仍进入任务模块子面板或条目详情');
});

t('B9 键盘链：Escape 一次只关一层，全局面板位于新建弹窗之后、详情抽屉之前', () => {
  const fn = fnBody(js, 'onGlobalKeydown');
  const esc = fn.slice(fn.indexOf("e.key === 'Escape'"));
  const iPanel = esc.indexOf('closeGlobalPanel');
  const iModal = esc.indexOf('closeModal');
  const iDrawer = esc.indexOf('closeDrawer');
  assert.ok(iPanel !== -1, 'Escape 链应包含 closeGlobalPanel');
  assert.ok(iModal !== -1 && iDrawer !== -1, 'Escape 链应保留弹窗与抽屉关闭');
  assert.ok(iModal < iPanel && iPanel < iDrawer, '关闭顺序应为：弹窗 → 全局面板 → 详情抽屉');
});

t('B10 状态反馈保持：骨架 / 无项目引导 / 已收尾 / 无匹配 / 首载失败 / 刷新失败 / 单项目失败文案保留', () => {
  const render = fnBody(js, 'renderGlobalView');
  for (const text of ['global-skeleton-row', '尚无注册项目', '均已收尾', '没有匹配的任务', '读取失败', '加载失败']) {
    assert.ok(render.includes(text), `面板渲染应保留状态文案「${text}」`);
  }
  assert.match(render, /刷新失败，正在重试/, '刷新失败应提示已保留上次数据');
  // 筛选 chips 与任务行由 renderGlobalView 调用的辅助函数产出（globalFilterChipsHtml / globalTaskRowHtml）
  assert.match(render, /globalFilterChipsHtml\(\)/, '渲染应组装筛选 chips（globalFilterChipsHtml）');
  const chips = js.match(/function globalFilterChipsHtml[\s\S]*?\n\}/);
  assert.ok(chips, '缺少 globalFilterChipsHtml');
  assert.match(chips[0], /data-gfilter/, '筛选 chips 挂点保留（前端过滤）');
  assert.match(render, /globalTaskRowHtml/, '渲染应组装任务行（globalTaskRowHtml）');
  const row = js.match(/function globalTaskRowHtml[\s\S]*?\n\}/);
  assert.ok(row, '缺少 globalTaskRowHtml');
  assert.match(row[0], /进入项目任务/, '保留「进入项目任务」跳转操作');
});

t('B11 样式：右侧固定面板覆盖主工作区、低于弹窗；头部常驻、内容区滚动；窄屏不破版', () => {
  const panel = rule('.global-panel');
  assert.match(panel, /position:\s*fixed/, '面板为固定定位');
  assert.match(panel, /right:\s*0/, '面板贴右侧');
  assert.match(panel, /z-index:\s*2[0-9]/, '面板层级应高于抽屉（20）低于弹窗（30）');
  assert.match(panel, /display:\s*flex/, '面板为纵向弹性布局');
  const body = rule('.global-panel-body');
  assert.match(body, /overflow-y:\s*auto/, '内容区可滚动');
  assert.match(body, /min-height:\s*0/, '内容区允许在弹性布局内收缩滚动');
  assert.match(flat, /\.global-panel-head/, '面板头部样式存在（关闭按钮常驻）');
  assert.match(flat, /\.global-panel-tools/, '面板搜索工具区样式存在');
  assert.match(flat, /\.global-group\s*\{/, '项目分组样式保留');
  assert.match(flat, /\.global-task\s*\{/, '任务行样式保留');
  // 窄屏：面板宽度受限时头部不裁掉关闭按钮（换行不隐藏）
  const narrow = flat.match(/@media \(max-width: 640px\) \{([\s\S]*?)\}\s*\}/);
  assert.ok(narrow, '应有 ≤640px 窄屏适配');
  assert.doesNotMatch(flat, /\.global-panel-head[^{]*\{[^}]*overflow:\s*hidden/, '头部不得裁切（关闭按钮可达）');
});

t('B12 快照：面板筛选档与搜索词随快照记忆（面板本身为临时层，刷新后不自动打开）', () => {
  const save = fnBody(js, 'saveViewSnapshot');
  assert.match(save, /globalStatus/, '筛选档（状态）仍入快照');
  assert.match(save, /globalKind/, '筛选档（类型）仍入快照');
  assert.match(save, /globalQ/, '面板搜索词入快照');
  const apply = fnBody(js, 'applyViewSnapshot');
  assert.match(apply, /globalQ/, '快照恢复应回填面板搜索词');
  assert.match(apply, /#globalSearchInput/, '恢复时同步面板搜索输入框');
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
