#!/usr/bin/env node
// REQ-20260910-009 搜索模块优化 —— 零依赖（node:assert）静态契约测试，
// 断言 index.html / app.js / oncall.js / style.css 与条目 ui-demo.html（参照 global-search-ui.test.mjs 风格）。
// 用法：node scripts/tests/search-module-20260910-009.test.mjs
// 覆盖 test-cases.md 的 S1–S11；M1–M5 为浏览器人工验收。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(root, 'scripts', 'web');
const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
const oncall = fs.readFileSync(path.join(webRoot, 'oncall.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
const itemDir = path.join(root, 'docs', 'agent-team-board', 'requirements', 'REQ-20260910-009');

let failed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n    ${String(e.message).split('\n')[0]}`);
  }
};

// 取函数体（从 `function name(` 起到下一个顶层 `\n}` 止）
const fnBody = (src, name) => {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `未找到函数 ${name}`);
  return m[1];
};

t('S1 搜索组含常显范围标签 #searchScope；SEARCH_SCOPE 五模块与 SEARCH_PLACEHOLDER 同键；设置模块隐藏整组', () => {
  const pageHead = html.match(/<section id="pageHead" class="page-head">([\s\S]*?)<\/section>/);
  assert.ok(pageHead, '未找到 #pageHead');
  assert.match(pageHead[1], /class="global-search module-search"/, '搜索组容器类名保持（旧契约）');
  assert.match(pageHead[1], /id="searchScope"/, '搜索组内需有范围标签 #searchScope');
  assert.match(pageHead[1], /id="searchInput"[^>]*aria-describedby="searchScope"/, '输入框 aria-describedby 指向范围标签');
  const scopeDef = js.match(/const SEARCH_SCOPE\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(scopeDef, '需定义 SEARCH_SCOPE 范围标签映射');
  // BUG-20260910-004：全局不再是模块视图，模块搜索不再解释全局（面板内有独立搜索 #globalSearchInput）
  // REQ-20260909-013：讨论 / 文件模块随入口暂态隐藏，其范围标签键移出（恢复时按条目 design.md 加回）
  for (const k of ['status', 'runs']) {
    assert.match(scopeDef[1], new RegExp(`\\b${k}:`), `SEARCH_SCOPE 缺少 ${k}`);
  }
  for (const k of ['oncall', 'files']) {
    assert.doesNotMatch(scopeDef[1], new RegExp(`\\b${k}:`), `SEARCH_SCOPE 应移出 ${k}（REQ-20260909-013 暂隐藏）`);
  }
  assert.doesNotMatch(scopeDef[1], /\bglobal:/, '模块搜索范围标签不应再含 global（BUG-20260910-004）');
  assert.match(html, /id="globalSearchInput"[^>]*aria-label="搜索全局任务（跨项目）"/, '全局搜索移入面板并标注跨项目语义');
  const upd = fnBody(js, 'updateSearchPlaceholder');
  assert.match(upd, /searchScope/, 'updateSearchPlaceholder 需同步范围标签文字');
  assert.match(upd, /aria-label/, 'updateSearchPlaceholder 需同步输入框 aria-label');
  const head = fnBody(js, 'updatePageHead');
  assert.match(head, /settings/, '设置模块隐藏搜索组');
});

t('S2 显式清除按钮 #searchClear；clearSearch 焦点回输入框且不关闭详情', () => {
  assert.match(html, /<button[^>]*id="searchClear"[^>]*aria-label="清除搜索"/, '需有 #searchClear 清除按钮（aria-label）');
  const bind = fnBody(js, 'bindSearchOnce');
  assert.match(bind, /#searchClear/, 'bindSearchOnce 需绑定 #searchClear');
  const clear = fnBody(js, 'clearSearch');
  assert.match(clear, /\.focus\(\)/, 'clearSearch 后焦点留在输入框');
  assert.doesNotMatch(clear, /closeDrawer\(/, '清空搜索不得关闭已打开详情');
  assert.match(js, /function syncSearchClearBtn/, '需有清除按钮显隐同步函数');
});

t('S3 Enter 立即搜索（清防抖定时器）；Esc 清空且 stopPropagation；防抖 250ms 保留', () => {
  assert.match(js, /SEARCH_DEBOUNCE_MS\s*=\s*250/, '防抖常量 250ms');
  const bind = fnBody(js, 'bindSearchOnce');
  const enter = bind.match(/e\.key === 'Enter'[\s\S]*?\n\s*\}/);
  assert.ok(enter, '输入框 keydown 需处理 Enter');
  assert.match(enter[0], /clearTimeout/, 'Enter 需清掉防抖定时器');
  assert.match(enter[0], /runSearch\(\)/, 'Enter 立即 runSearch');
  const escape = bind.match(/e\.key === 'Escape'[\s\S]*?\n\s*\}/);
  assert.ok(escape, '输入框 keydown 需处理 Escape');
  assert.match(escape[0], /stopPropagation/, 'Esc 不冒泡到全局');
  assert.match(escape[0], /clearSearch\(\)/, 'Esc 清空搜索');
});

t('S4 统一反馈条 #searchFeedback 紧邻 #pageHead 之后、#filterBar 之前，可被辅助技术读取；旧条带移除', () => {
  const iHead = html.indexOf('<section id="pageHead"');
  const iHeadEnd = html.indexOf('</section>', iHead);
  const iFeed = html.indexOf('id="searchFeedback"');
  const iFilter = html.indexOf('id="filterBar"');
  assert.ok(iFeed > 0, '需有 #searchFeedback 反馈条');
  assert.ok(iFeed > iHeadEnd && iFeed < iFilter, '#searchFeedback 必须位于 #pageHead 之后、#filterBar 之前');
  const between = html.slice(iHeadEnd, iFeed);
  assert.doesNotMatch(between.replace(/<!--[\s\S]*?-->/g, ''), /<(main|section|nav|div)\b/, '#pageHead 与 #searchFeedback 之间不得插入其他内容块');
  const feed = html.match(/<section[^>]*id="searchFeedback"[^>]*>/);
  assert.match(feed[0], /class="[^"]*hits-strip[^"]*"/, '反馈条沿用 .hits-strip 类（旧契约）');
  assert.match(feed[0], /role="region"/, '反馈条需 role=region');
  assert.match(feed[0], /aria-live="polite"/, '反馈条需 aria-live=polite');
  assert.doesNotMatch(html, /id="docHits"/, '旧 #docHits 条带应移除（统一到 #searchFeedback）');
  assert.doesNotMatch(html, /id="fileSearchHits"/, '旧 #fileSearchHits 条带应移除（统一到 #searchFeedback）');
});

t('S5 需求结果分「条目」「文档」两组；文件 / 需求跨模块入口 data-goto-view 保留关键词；点击打开对应内容', () => {
  assert.match(js, /function renderSearchFeedback/, '需有统一反馈条渲染函数');
  assert.match(js, /function renderDocHits/, '需求分组构建函数保留名称（旧契约）');
  assert.match(js, /function renderFileHits/, '文件分组构建函数保留名称（旧契约）');
  const docs = fnBody(js, 'renderDocHits');
  assert.match(docs, /hits-group-title[^\n]*条目/, '需有「条目」分组标题');
  assert.match(docs, /hits-group-title[^\n]*文档/, '需有「文档」分组标题');
  assert.match(docs, /hit-row item/, '条目命中渲染为可点击行');
  assert.match(docs, /data-goto-view="files"/, '文件命中数量需带「在文件查看」入口');
  const files = fnBody(js, 'renderFileHits');
  assert.match(files, /data-goto-view="status"/, '文件视图需带「在需求查看」返回入口');
  assert.match(files, /hit-file/, '文件命中渲染为路径 chip');
  const feed = fnBody(js, 'renderSearchFeedback');
  assert.match(feed, /openDrawer\(/, '条目行点击打开详情');
  assert.match(feed, /loadDoc\(/, '文档行点击定位文档');
  assert.match(feed, /openFile\(/, '文件行点击打开预览');
  const goto = feed.match(/data-goto-view\][\s\S]*?setView\(([^)]*)\)/);
  assert.ok(goto, '跨模块入口点击需调用 setView');
  assert.doesNotMatch(feed.slice(feed.indexOf('data-goto-view]')), /clearSearch\(\)/, '跨模块入口不得清空关键词');
});

t('S6 状态机：error / resQ；失败持久显示 + 重试；加载 / 旧结果 / 空结果文案互不混淆；不再仅用 toast', () => {
  assert.match(js, /search:\s*\{[^}]*error:/, 'state.search 需含 error');
  assert.match(js, /search:\s*\{[^}]*resQ:/, 'state.search 需含 resQ（结果对应的关键词）');
  const run = fnBody(js, 'runSearch');
  assert.match(run, /s\.error\s*=\s*e\.message|s\.error\s*=\s*String\(e/, '失败时记录 s.error');
  assert.doesNotMatch(run, /toast\(`搜索失败/, '失败不再只用 toast 提示');
  assert.match(run, /s\.resQ\s*=\s*q/, '成功时记录 resQ');
  const feed = fnBody(js, 'renderSearchFeedback');
  assert.match(feed, /hits-retry/, '失败态需有重试按钮');
  assert.match(feed, /正在搜索/, '加载态文案「正在搜索」');
  assert.match(feed, /旧结果/, '加载期间保留的旧结果需标注');
  assert.match(feed, /未找到匹配结果/, '空结果文案');
  assert.match(feed, /搜索失败/, '失败说明');
  assert.match(feed, /仅显示部分结果/, '截断提示');
  assert.match(js, /function retrySearch/, '需有重试函数');
  assert.match(fnBody(js, 'retrySearch'), /runSearch\(\)/, '重试用当前关键词重新搜索');
});

t('S7 列表头提示区分总命中与当前档可见数；零可见说明筛选影响', () => {
  const board = fnBody(js, 'renderBoard');
  assert.match(board, /搜索命中条目/, '列表头需以「搜索命中条目 N 项」表述总命中');
  assert.match(board, /当前档可见/, '需与当前状态档可见数分开说明');
  assert.match(board, /切换状态筛选|切换筛选/, '零可见命中时提示切换筛选');
});

t('S8 竞态守卫与重解释：seq 保留；clearSearch 递增 seq；setView 后缺少本词结果时重发；切换项目仍重发', () => {
  const run = fnBody(js, 'runSearch');
  assert.match(run, /s\.seq !== seq/, 'seq 竞态守卫保留');
  assert.match(fnBody(js, 'clearSearch'), /s\.seq\+\+|s\.seq \+= 1/, 'clearSearch 需递增 seq 让在途响应作废');
  assert.match(js, /function ensureSearchForView/, '需有按视图补发搜索的函数');
  assert.match(fnBody(js, 'setView'), /ensureSearchForView\(\)/, 'setView 需调用 ensureSearchForView');
  const ensure = fnBody(js, 'ensureSearchForView');
  assert.match(ensure, /resQ/, '按 resQ 判断是否已有本词结果');
  assert.match(ensure, /runSearch\(\)/, '缺少本词结果时重发');
  assert.match(fnBody(js, 'switchProject'), /runSearch\(\)/, '切换项目仍按新项目重发');
});

t('S9 讨论 / 全局前端计数：oncall.js 导出 searchStats；全局面板搜索用 globalTaskMatches 前端过滤；前端模块不发 /api/search', () => {
  assert.match(oncall, /function searchStats/, 'oncall.js 需有 searchStats');
  assert.match(oncall, /return \{[^}]*searchStats/, 'ATBOncall 需导出 searchStats');
  const feed = fnBody(js, 'renderSearchFeedback');
  assert.match(feed, /searchStats/, '讨论视图从 ATBOncall.searchStats 取计数');
  assert.doesNotMatch(feed, /\/api\/search/, '反馈条渲染不得发起请求');
  // BUG-20260910-004：全局改为右侧面板独立搜索（不再经第三行模块搜索反馈条计数）
  const bind = fnBody(js, 'bindGlobalPanelOnce');
  assert.match(bind, /renderGlobalView\(\)/, '面板搜索词落定即重渲染（前端过滤）');
  const render = fnBody(js, 'renderGlobalView');
  assert.match(render, /globalTaskMatches\(/, '面板内容用 globalTaskMatches 过滤');
});

t('S10 style.css：范围标签 / 清除按钮 / 反馈条 / 分组样式；≤720px 搜索组独占整行；键盘焦点描边', () => {
  assert.match(flat, /\.search-scope \{/, '需有 .search-scope 样式');
  assert.match(flat, /\.search-clear \{/, '需有 .search-clear 样式');
  assert.match(flat, /\.search-feedback/, '需有 .search-feedback 样式');
  assert.match(flat, /\.hits-group-title/, '需有分组标题样式');
  assert.match(flat, /\.global-search \{[^}]*min-width: \d+px/, '.global-search 保留 min-width（旧契约）');
  // REQ-20260910-016：排序菜单迁入定位组后，窄屏改为定位组独占整行（组内排序仍在搜索左侧），
  // 搜索组在组内伸缩（1 1 auto）而非自身 1 1 100% 强制换行
  const narrow = flat.match(/@media \(max-width: 720px\) \{[^@]*?\.page-head \.locate-group \{[^}]*flex: 1 1 100%/);
  assert.ok(narrow, '≤720px 时 .page-head .locate-group 需 flex: 1 1 100% 独占整行');
  assert.match(flat, /\.hit-row:focus-visible/, '.hit-row 键盘焦点描边');
  assert.match(flat, /\.search-clear:focus-visible/, '.search-clear 键盘焦点描边');
  assert.match(flat, /\.hits-error/, '失败说明样式');
});

t('S11 ui-demo.html 离线单文件；README 含有效相对链接', () => {
  const demo = path.join(itemDir, 'ui-demo.html');
  assert.ok(fs.existsSync(demo), '条目目录需有 ui-demo.html');
  const d = fs.readFileSync(demo, 'utf8');
  assert.doesNotMatch(d, /<script[^>]*src=|<link[^>]*href=/, '演示需内联，无外链资源');
  assert.match(d, /示意/, '演示需声明为示意数据');
  const readme = fs.readFileSync(path.join(itemDir, 'README.md'), 'utf8');
  assert.match(readme, /\]\(\.\/ui-demo\.html\)/, 'README 需含 ./ui-demo.html 相对链接');
});

if (failed) {
  console.error(`\n${failed} 个用例失败`);
  process.exit(1);
}
console.log('\n全部通过');
