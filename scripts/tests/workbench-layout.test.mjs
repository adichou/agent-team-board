#!/usr/bin/env node
// REQ-20260907-004 看板整体布局优化 —— 统一工作台四行布局契约测试（W1–W12）
// 静态断言 index.html / app.js / oncall.js / style.css；视觉与多尺寸核验按 test-cases.md UI-13 人工执行。
// 用法：node scripts/tests/workbench-layout.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const oncall = fs.readFileSync(path.join(webRoot, 'oncall.js'), 'utf8');
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

function mediaBody(cond) {
  const re = new RegExp(`@media\\s*\\(${escapeRe(cond)}\\)\\s*\\{`, 'g');
  let out = '';
  let found = false;
  let m;
  while ((m = re.exec(flat)) !== null) {
    found = true;
    const start = m.index + m[0].length;
    let i = start;
    let depth = 1;
    while (i < flat.length && depth > 0) {
      if (flat[i] === '{') depth++;
      else if (flat[i] === '}') depth--;
      i++;
    }
    out += flat.slice(start, i - 1) + ' ';
  }
  assert.ok(found, `缺少媒体查询 @media (${cond})`);
  return out;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('W1 层级：topbar（含模块页签）→ page-head（副标题+搜索）→ 模块内容；顶栏不再含搜索框（REQ-20260910-012 页签上移并入顶栏，原独立第二行取消）', () => {
  const iTop = html.indexOf('<header class="topbar"');
  const iNav = html.indexOf('<nav class="module-nav"');
  const iHead = html.indexOf('<section id="pageHead"');
  assert.ok(iTop !== -1, '缺少第一行 .topbar');
  assert.ok(iNav !== -1, '缺少模块页签 .module-nav');
  assert.ok(iHead !== -1, '缺少第二行 #pageHead');
  const iHeadEnd = html.indexOf('</header>', iTop);
  const iBrand = html.indexOf('<div class="brand">', iTop);
  const iActions = html.indexOf('<div class="top-actions">', iTop);
  // REQ-20260910-012：页签并入顶栏——brand 之后、操作区之前；顶栏结束后直接进入副标题行
  assert.ok(iTop < iBrand && iBrand < iNav && iNav < iActions && iActions < iHeadEnd,
    '顶栏内顺序应为 brand → module-nav → top-actions');
  assert.ok(iHeadEnd < iHead, '顶栏之后直接为副标题 + 搜索行（原独立第二行消失）');
  const topbar = html.slice(iTop, iHeadEnd);
  assert.doesNotMatch(topbar, /global-search|searchInput/, '顶栏不得再放搜索框');
  assert.match(topbar, /view-tab/, '模块页签上移并入顶栏（REQ-20260910-012 新契约）');
  assert.match(topbar, /id="btnNew"/, '顶栏右侧保留统一新建入口');
  assert.match(html, /id="moduleSub"/, '副标题行应有模块副标题');
  assert.match(html, /id="searchInput"/, '副标题行应含模块搜索输入');
});

t('W2 模块导航（REQ-20260911-002 口径）：需求 → 任务，末位「设置」辅助入口；讨论 / 文件 / 营销 / 发布入口暂态隐藏；全局入口在顶栏（BUG-20260910-004）', () => {
  const nav = html.match(/<nav class="module-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, '缺少模块导航');
  const order = [...nav[0].matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  // REQ-20260909-013：讨论（oncall）/ 文件（files）入口暂态隐藏（恢复步骤见条目 design.md）；
  // REQ-20260911-002：营销 / 发布入口同口径暂态隐藏，导航收敛为 需求/任务 + 末位设置；
  // BUG-20260910-004 全局移至顶栏「管理项目」右侧（跨项目总览不属于单一项目模块）
  assert.deepEqual(order, ['status', 'runs', 'settings'], '导航顺序应为 需求/任务 + 末位设置（营销与发布已暂隐藏）');
  assert.match(nav[0], /data-view="status"[^>]*>需求</, '需求栏目名称');
  assert.match(nav[0], /data-view="runs"[^>]*>任务</, '执行中心应更名为「任务」');
  assert.doesNotMatch(nav[0], /data-view="global"/, '模块导航不再含全局入口（BUG-20260910-004，移至顶栏）');
  assert.doesNotMatch(nav[0], /data-view="oncall"/, '「讨论」入口随 REQ-20260909-013 暂态隐藏（无空占位）');
  assert.doesNotMatch(nav[0], /data-view="files"/, '「文件」入口随 REQ-20260909-013 暂态隐藏（无空占位）');
  assert.doesNotMatch(nav[0], /data-view="marketing"/, '「营销」入口随 REQ-20260911-002 暂态隐藏（无空占位）');
  assert.doesNotMatch(nav[0], /data-view="release"/, '「发布」入口随 REQ-20260911-002 暂态隐藏（无空占位）');
  assert.match(nav[0], /<button[^>]*class="view-tab nav-extra"[^>]*data-view="settings"/, '设置应为行末辅助入口');
});

t('W3 需求默认列表：默认激活 status；无列表/看板切换；看板机制移除', () => {
  assert.match(html, /class="view-tab active" data-view="status"/, '需求 tab 默认激活');
  assert.doesNotMatch(html, /data-layout/, '不得保留列表/看板切换控件');
  assert.doesNotMatch(js, /board-tabs|scrollToCol|markActiveTab|updateBoardTabs/, '看板列 tab 与滚动机制应移除');
  assert.doesNotMatch(js, /LANE_DROP_STATUS/, '看板拖拽换列映射应随看板移除');
  assert.match(js, /laneOf/, 'laneOf 派生分类保留（筛选与状态展示用）');
});

t('W4 需求工作区：宽屏列表与详情并排；详情容器位于 split 内；窄屏单列覆盖抽屉，关闭收敛为 ✕（BUG-20260909-007）', () => {
  assert.match(html, /id="reqView"/, '应有需求工作区容器');
  assert.match(html, /class="req-split"/, '应有 .req-split 双栏容器');
  const split = html.slice(html.indexOf('req-split'), html.indexOf('</main>'));
  assert.match(split, /id="reqList"/, 'split 内应含列表容器');
  assert.ok(split.indexOf('id="drawer"') > split.indexOf('id="reqList"'), '#drawer 应位于列表之后（右侧详情栏）');
  const wide = rule('.req-split');
  assert.match(wide, /grid-template-columns:[^;]*minmax\(0,\s*1fr\)[^;]*minmax\(0,\s*[0-9.]+(?:fr|px)\)/, '宽屏 split 应为列表+详情双栏');
  const mid = mediaBody('max-width: 1020px');
  assert.match(mid, /grid-template-columns:\s*minmax\(0,\s*1fr\)|grid-template-columns:\s*1fr/, '窄屏 split 应退化为单列');
  // BUG-20260909-007：窄屏「← 返回」与「✕」行为完全相同（同一 closeDrawer），需求侧返回按钮移除；
  // .drawer-back 样式保留给讨论模块 #ocBack（该处无并存 ✕，返回是唯一出口）
  assert.doesNotMatch(js, /drawerBack/, '需求详情不得再提供窄屏返回入口（冗余出口已移除）');
  assert.match(js, /id="drawerClose"/, '关闭出口唯一收敛为既有 ✕ 按钮');
  assert.match(oncall, /id="ocBack"/, '讨论模块返回入口保留（唯一出口，未受波及）');
  assert.match(css, /\.drawer-back/, '.drawer-back 样式保留（讨论模块使用，宽屏隐藏）');
});

t('W5 状态筛选（BUG-20260907-016 修订）：#filterBar 五档无「全部」；laneOf 支撑筛选与行状态', () => {
  assert.match(html, /id="filterBar"/, '第四行筛选容器应存在');
  assert.match(js, /const REQ_FILTERS = LANES\.map\(\(lane\) => \(\{ key: lane, label: LANE_LABEL\[lane\] \}\)\);/, 'REQ_FILTERS 应由 LANES 五档派生（待接受/已接受/开发中/待测试/已完成），无其余档');
  const barSeg = js.slice(js.indexOf('function renderFilterBar'), js.indexOf('function reqRowEl'));
  assert.doesNotMatch(barSeg, /全部|'all'/, 'chips 渲染不得含「全部」档');
  assert.match(js, /renderFilterBar|applyReqFilter|reqFilter/, '筛选条机制存在');
  assert.match(js, /laneOf/, 'laneOf 派生分类保留（筛选与行状态展示用）');
  assert.match(js, /\$\('#reqList'\)/, '应有需求列表容器挂载渲染');
  assert.match(js, /reqRowEl/, '应有需求列表行渲染');
});

t('W6 统一新建：同一弹窗支持 需求/Bug（REQ-20260909-013：讨论类型随讨论入口暂态隐藏移除，/api/discussion 服务端与 ask 分支保留待恢复）；Bug 一律独立（REQ-20260908-009 / REQ-20260909-004）', () => {
  const modal = html.match(/<div id="modalWrap"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(modal, '缺少统一新建弹窗');
  assert.match(html, /<option value="req">/, '类型应含需求');
  assert.match(html, /<option value="bug">/, '类型应含 Bug');
  assert.doesNotMatch(html, /<option value="ask">/, '「讨论（ASK）」选项随 REQ-20260909-013 暂态隐藏移除（口径见条目 design.md 待确认 2 裁定；恢复 = 加回 option 即生效）');
  assert.doesNotMatch(html, /id="fParent"/, 'Bug 不再有归属需求选择（一律独立，源单写 design.md 引入来源）');
  // REQ-20260909-004：讨论为标题 + 背景（可选），截图附件与关联需求入口移除
  assert.ok(!html.includes('id="fAttach"'), '讨论不再有截图上传（旧单附件只读保留）');
  assert.ok(!js.includes('addNewAttachFiles'), 'app.js 不再有附件读取机制');
  assert.match(js, /\/api\/discussion'/, '讨论走开放式讨论创建接口（ask 分支保留待恢复）');
  assert.match(js, /\/api\/new/, '需求/Bug 走现有创建接口');
});

t('W7 新建返回列表与防重（REQ-20260908-017）：三类成功进入对应模块不再自动打开详情；提交中禁用；失败保留输入', () => {
  assert.match(js, /submitNew[\s\S]{0,400}disabled = true/, '提交中应禁用提交按钮防重');
  assert.match(js, /setView\('status'\)/, '需求/Bug 创建成功进入需求模块');
  // REQ-20260909-013：讨论创建分支保留（类型入口暂隐藏后不可达；setView('oncall') 由兜底回落需求模块，恢复即生效）
  assert.match(js, /setView\('oncall'\)/, '讨论单创建跳转分支保留待恢复（入口已暂隐藏）');
  // REQ-20260908-017：需求/Bug 创建成功只返回列表不自动打开详情；
  // REQ-20260909-004：讨论创建成功 reveal 定位新讨论并展示启动提示词（模块内选中，非详情抽屉跳转）
  const submitStart = js.indexOf('async function submitNew');
  assert.ok(submitStart >= 0, '缺少 submitNew');
  const submitSeg = js.slice(submitStart, js.indexOf('\n}', submitStart) + 2);
  assert.doesNotMatch(submitSeg, /openDrawer\(/, 'submitNew 不得自动打开需求/Bug 详情');
  assert.match(oncall, /reveal\s*\(/, 'REQ-20260909-004：ATBOncall 暴露 reveal（创建后展示启动提示词）');
  // 失败不关弹窗：submitNew 的 catch 分支不得调用 closeModal（保留输入）
  const seg = js.match(/async function submitNew[\s\S]*?\n\}/);
  assert.ok(seg, '缺少 submitNew');
  const catchSeg = seg[0].slice(seg[0].indexOf('catch'));
  assert.doesNotMatch(catchSeg, /closeModal/, '失败分支不得关闭弹窗（保留输入）');
  assert.match(catchSeg, /toast\(/, '失败分支应 toast 明确提示');
});

t('W8 模块搜索：第三行搜索按模块更新占位符（REQ-20260909-013：讨论 / 文件占位符随入口暂态隐藏移出，恢复时按条目 design.md 加回）；任务前端过滤；设置无搜索', () => {
  assert.match(js, /搜需求 \/ Bug \/ 文档/, '需求模块搜索占位符');
  assert.match(js, /搜任务|搜执行/, '任务模块搜索占位符');
  assert.doesNotMatch(js, /搜讨论/, '讨论模块搜索占位符随入口隐藏移出（视图经 setView 兜底不可达）');
  assert.doesNotMatch(js, /搜文件/, '文件模块搜索占位符随入口隐藏移出');
  assert.match(oncall, /setQuery/, '讨论模块搜索词过滤机制保留（待恢复）');
  assert.match(js, /settings[\s\S]{0,120}hidden|module-search/, '设置视图应隐藏搜索框');
  assert.match(js, /updateSearchPlaceholder/, '占位符随模块同步');
});

t('W9 更名：面向用户文案统一 讨论；ASK 编号沿用不迁移（REQ-20260909-004 开放式讨论；REQ-20260909-013：讨论类型入口暂态隐藏）', () => {
  assert.doesNotMatch(oncall, /咨询单/, '咨询单应更名为讨论');
  assert.doesNotMatch(oncall, /Oncall 咨询/, 'Oncall 咨询字样应移除');
  assert.match(oncall, /讨论/, '应使用讨论文案');
  assert.match(oncall, /\/api\/oncall\/ticket\/.+attachment/, '旧单附件仍用 oncall 内部 API 路径（兼容旧数据）');
  assert.match(js, /\/api\/discussion/, '新交互走 /api/discussion（分支保留待恢复）');
  assert.doesNotMatch(html, /<option value="ask">/, '新建入口类型暂收敛为需求 / Bug 两项（REQ-20260909-013；「讨论（ASK）」option 待恢复时按 BUG-20260910-013 口径加回）');
  assert.doesNotMatch(html, /讨论（开放式）/, '新建入口类型文案不再带「（开放式）」后缀（BUG-20260910-006）');
});

t('W10 任务模块：setView 支持 runs；批量面板渲染进任务视图；无遮罩', () => {
  assert.match(html, /id="runsView"/, '应有任务视图容器');
  const runsSeg = html.slice(html.indexOf('id="runsView"'), html.indexOf('</section>', html.indexOf('id="runsView"')));
  assert.match(runsSeg, /id="batchDrawer"/, '批量面板应位于任务视图容器内');
  assert.doesNotMatch(html, /id="batchMask"/, '批量面板不得再用独立遮罩（页面化）');
  assert.match(js, /'runs'/, 'setView 应支持 runs');
  assert.match(js, /state\.view === 'runs'/, '任务视图随主轮询刷新');
});

t('W11 设置模块：setView 支持 settings；渲染派发默认值并保存', () => {
  assert.match(html, /id="settingsView"/, '应有设置视图容器');
  assert.match(js, /'settings'/, 'setView 应支持 settings');
  assert.match(js, /renderSettingsView/, '应有设置视图渲染');
  assert.match(js, /\/api\/dispatch\/settings/, '设置保存走派发设置接口');
});

t('W12 深链兼容：view 参数解析保留全部模块旧值（REQ-20260909-013：oncall / files 深链经 setView 兜底回落需求模块，不空白不报错）', () => {
  assert.match(js, /viewParam/, 'boot 应解析 view 参数');
  for (const v of ['files', 'oncall', 'runs', 'settings']) {
    assert.ok(js.includes(`'${v}'`), `view 参数应支持 ${v}`);
  }
  assert.match(js, /const HIDDEN_VIEWS = [^\n]*'oncall'[^\n]*'files'[^\n]*;/, '隐藏模块兜底开关应含 oncall 与 files');
});

t('W13 副标题：第三行按模块展示一句副标题（REQ-20260909-013：讨论 / 文件副标题随入口暂态隐藏移出，恢复时按条目 design.md 加回）', () => {
  assert.match(js, /从想法到验收，跟进每一项工作/, '需求副标题');
  assert.match(js, /进度、队列与结果集中在这里/, '任务副标题');
  assert.doesNotMatch(js, /开放式讨论，看板沉淀成果/, '讨论副标题随入口隐藏移出（视图经 setView 兜底不可达）');
  assert.doesNotMatch(js, /项目资料与源码，专注阅读/, '文件副标题随入口隐藏移出');
  // BUG-20260909-013：同口径文案全前端仅第三行副标题一处，筛选条行末提示删除
  assert.doesNotMatch(oncall, /看板沉淀成果/, '筛选条行末提示文案已删（同屏重复）');
  assert.doesNotMatch(oncall, /disc-filter-tip/, 'oncall.js 不再渲染行末提示节点');
  assert.doesNotMatch(css, /disc-filter-tip/, 'style.css 死样式 .disc-filter-tip 已删');
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
