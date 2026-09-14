#!/usr/bin/env node
// REQ-20260909-014 需求详情抽屉文档页签右键「讨论」 —— 静态契约 + vm 纯函数测试
// 用法：node scripts/tests/doc-ctx-discuss-20260909-014.test.mjs
// 覆盖 test-cases.md 的 T1–T10（菜单视觉定位/深浅色/窄屏形态为人工浏览器目检，见 test-report.md）。

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

// 在 vm 沙箱里提取源码中的纯函数（无 DOM 依赖，桩对象注入）
function loadFns(names) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(names.map(fnSrc).join('\n'), sandbox);
  return sandbox;
}

// 顶层块级节点计数：按块级标签开合深度扫描（li/blockquote 内嵌 <p> 等不计顶层；hr 为 void）
function countTopLevel(html) {
  const re = /<(\/)?(h[1-6]|p|ul|ol|table|blockquote|pre|hr)(?:\s[^>]*)?>/g;
  let depth = 0;
  let top = 0;
  for (const m of html.matchAll(re)) {
    if (m[1]) { depth--; continue; }
    if (m[2] === 'hr') { if (depth === 0) top++; continue; }
    if (depth === 0) top++;
    depth++;
  }
  return top;
}

// 公共夹具：覆盖标题/多行段落/列表吸收缩进栅栏/松散列表跨空行/懒续行/表格/引用跨空行分块/
// 围栏记号长度/异族列表相邻分块/hr（与 marked 顶层节点 1:1 对齐的各形态）
const md = [
  '# 标题',          // 1
  '',                // 2
  '第一段第一行',     // 3
  '第一段第二行',     // 4
  '',                // 5
  '- 项目一',        // 6
  '- 项目二',        // 7
  '  ```js',         // 8（缩进栅栏并入列表块）
  '  const x = 1;',  // 9
  '  ```',           // 10
  '',                // 11
  '- 松散项一',      // 12（空行分隔的松散列表仍是一个块）
  '',                // 13
  '- 松散项二',      // 14
  '',                // 15
  '| 列A | 列B |',   // 16
  '| -- | -- |',     // 17
  '| a1 | b1 |',     // 18
  '',                // 19
  '> 引用行',        // 20
  '',                // 21
  '> 另一引用',      // 22（空行分隔：两个 blockquote）
  '',                // 23
  '```',             // 24
  '代码一',          // 25
  '```',             // 26
  '',                // 27
  '````',            // 28（四反引号围栏，内含三反引号不误闭）
  '内含 ``` 三反引号', // 29
  '````',            // 30
  '',                // 31
  '1. 有序项',       // 32
  '- 无序项',        // 33（异族列表相邻：顶层新块）
  '',                // 34
  '---',             // 35
  '',                // 36
  '- 列表项',        // 37
  '懒续行段落',      // 38（段后未缩进懒续行并入列表块）
  '',                // 39
  '尾段',            // 40
].join('\n');

// ---------- T1 parseDocBlocks：1 基源行块解析 ----------

t('T1 parseDocBlocks：标题/段落/列表（缩进栅栏+松散跨空行+懒续行）/表格/引用跨空行分块/围栏长度/异族列表/hr', () => {
  const sb = loadFns(['docKindOfLine', 'parseDocBlocks']);
  const blocks = sb.parseDocBlocks(md);
  // JSON 往返：vm 跨 realm 数组与主 realm 断言值原型不同，序列化后比较
  assert.deepEqual(
    JSON.parse(JSON.stringify(blocks.map((b) => [b.kind, b.start, b.end]))),
    [
      ['heading', 1, 1],
      ['para', 3, 4],
      ['list', 6, 14], // 吸收第 8–10 行缩进栅栏，跨 11/13 空行合并松散项
      ['table', 16, 18],
      ['quote', 20, 20],
      ['quote', 22, 22], // 空行分隔：两个块（marked 渲染两个 blockquote）
      ['fence', 24, 26],
      ['fence', 28, 30], // 四反引号围栏内含 ``` 不误闭
      ['list', 32, 32],  // 有序项
      ['list', 33, 33],  // 异族无序项：顶层新块
      ['hr', 35, 35],
      ['list', 37, 38],  // 懒续行并入列表块
      ['para', 40, 40],
    ],
    '块切分与 1 基行范围应与源码行一致',
  );
});

t('T10 配对前提：真实 marked 顶层块级节点数与 parseDocBlocks 块数一致', () => {
  const markedSrc = fs.readFileSync(path.join(pluginRoot, 'scripts', 'web', 'marked.min.js'), 'utf8');
  const sandbox = { __md: md };
  vm.createContext(sandbox);
  vm.runInContext(markedSrc, sandbox);
  const html = vm.runInContext('marked.parse(__md)', sandbox);
  const sb = loadFns(['docKindOfLine', 'parseDocBlocks']);
  assert.equal(countTopLevel(html), sb.parseDocBlocks(md).length, '夹具在 marked 下应与块 1:1 对齐（含列表内栅栏/松散列表不拆块）');
});

// ---------- T2 annotateDocLines：顺序配对 + 失准守卫 ----------

function mkDocEl(text) {
  return { textContent: text, dataset: {} };
}

t('T2 annotateDocLines：顶层元素按序配对写 data-doc-start/end/kind', () => {
  const sb = loadFns(['docKindOfLine', 'parseDocBlocks', 'docBlockMatches', 'annotateDocLines']);
  const view = {
    children: [
      mkDocEl('标题'),
      mkDocEl('第一段第一行\n第一段第二行'),
      mkDocEl('项目一项目二const x = 1;松散项一松散项二'),
      mkDocEl('列A列Ba1b1'),
      mkDocEl('引用行'),
      mkDocEl('另一引用'),
      mkDocEl('代码一'),
      mkDocEl('内含 ``` 三反引号'),
      mkDocEl('有序项'),
      mkDocEl('无序项'),
      mkDocEl(''), // hr：无文本，视为可配对
      mkDocEl('列表项\n懒续行段落'),
      mkDocEl('尾段'),
    ],
  };
  sb.annotateDocLines(view, md);
  const got = [...view.children].map((el) => [el.dataset.docStart, el.dataset.docEnd, el.dataset.docKind]);
  assert.deepEqual(got, [
    ['1', '1', 'heading'],
    ['3', '4', 'para'],
    ['6', '14', 'list'],
    ['16', '18', 'table'],
    ['20', '20', 'quote'],
    ['22', '22', 'quote'],
    ['24', '26', 'fence'],
    ['28', '30', 'fence'],
    ['32', '32', 'list'],
    ['33', '33', 'list'],
    ['35', '35', 'hr'],
    ['37', '38', 'list'],
    ['40', '40', 'para'],
  ]);
});

t('T2 失准守卫：元素文本与块文本子序列校验不通过即停止标注，后续节点不给行号（宁缺勿错）', () => {
  const sb = loadFns(['docKindOfLine', 'parseDocBlocks', 'docBlockMatches', 'annotateDocLines']);
  const view = {
    children: [
      mkDocEl('标题'),
      mkDocEl('第一段第一行\n第一段第二行'),
      mkDocEl('与任何块都对不上的未知节点'), // 中途失准
      mkDocEl('项目一项目二const x = 1;松散项一松散项二'),
    ],
  };
  sb.annotateDocLines(view, md);
  assert.equal(view.children[0].dataset.docStart, '1', '失准前应正常标注');
  assert.equal(view.children[1].dataset.docStart, '3', '失准前应正常标注');
  assert.equal(view.children[2].dataset.docStart, undefined, '失准节点不得标注');
  assert.equal(view.children[3].dataset.docStart, undefined, '失准后续节点不得标注（防错行号）');
});

// ---------- T3 docSelLines：块内选文精确行映射 ----------

t('T3 docSelLines：段落按换行精确映射；围栏偏移首行 ```；富文本（列表/表格）回退整块范围', () => {
  const sb = loadFns(['docSelLines']);
  // 逐属性断言：vm 跨 realm 对象不能直接 deepEqual（原型不同）
  const eq = (got, start, end) => {
    assert.equal(got.start, start);
    assert.equal(got.end, end);
  };
  eq(sb.docSelLines(3, 4, 'para', '', '第一段第一行'), 3, 3);
  eq(sb.docSelLines(3, 4, 'para', '第一段第一行\n', '第一段第二行'), 4, 4);
  eq(sb.docSelLines(22, 24, 'fence', '', '代码一'), 23, 23); // 渲染文本不含首行围栏
  eq(sb.docSelLines(22, 25, 'fence', '', '代码一\n代码二'), 23, 24);
  eq(sb.docSelLines(6, 14, 'list', '项目一', '项目二'), 6, 14); // 富文本：可确定的整块范围
  eq(sb.docSelLines(16, 18, 'table', '列A', 'b1'), 16, 18);
});

// ---------- T4 buildDocRef / docRefPath：复制文本组装 ----------

t('T4 docRefPath：绝对路径口径同 req-disc 引用复制（<项目根>/docs/agent-team-board/requirements/<单号>/<文档名>）', () => {
  const sb = loadFns(['docRefPath']);
  assert.equal(
    sb.docRefPath('/Users/x/proj', 'REQ-1', 'design.md'),
    '/Users/x/proj/docs/agent-team-board/requirements/REQ-1/design.md',
  );
});

t('T4 buildDocRef：有选中＝单号/文档名/行范围/路径/原文；无选中＝路径+行号且无「原文」节', () => {
  const sb = loadFns(['docRefPath', 'buildDocRef']);
  const p = sb.docRefPath('/Users/x/proj', 'REQ-1', 'design.md');
  const ref = sb.buildDocRef({ id: 'REQ-1', name: 'design.md', path: p, start: 3, end: 4, text: '原文片段' });
  assert.ok(ref.includes('REQ-1 / design.md 第 3–4 行'), '首行应为 单号 / 文档名 第 x–y 行');
  assert.ok(ref.includes(`文档：${p}`), '应含绝对文档路径');
  assert.ok(ref.includes('原文：\n原文片段'), '有选中时应附原文');
  const ref2 = sb.buildDocRef({ id: 'REQ-1', name: 'README.md', path: p, start: 42, end: 42, text: null });
  assert.ok(ref2.includes('第 42 行'), '单行范围应为「第 x 行」');
  assert.ok(!ref2.includes('原文'), '无选中时不应有原文节');
});

// ---------- T5 右键入口契约（静态） ----------

t('T5 contextmenu 文档级委托绑定；仅 #docView 内且条件满足才 preventDefault，其余放行原生', () => {
  assert.match(js, /document\.addEventListener\('contextmenu', onDocCtxMenu\)/, '应文档级委托绑定一次');
  const h = fnSrc('onDocCtxMenu');
  assert.match(h, /view\.contains\(e\.target\)/, '应校验落点在 #docView 内');
  assert.match(h, /state\.drawer\.item\?\.type !== 'requirement'/, '仅需求详情抽屉启用（README 默认口径）');
  assert.match(h, /closest\('a, img'\)/, '链接/图片右键应放行原生菜单');
  assert.match(h, /state\.drawer\.tab !== name/, '加载中/未创建/失败态（doc 与页签不一致）不弹菜单');
  assert.match(h, /e\.preventDefault\(\)/, '拦截原生菜单应发生在全部前置校验之后');
  assert.match(h, /openDocCtxMenu\(e\.clientX, e\.clientY/, '菜单出现在右键坐标处');
});

t('T5 纯前端剪贴板能力：右键/菜单/复制链路无任何 api()/fetch() 后端调用', () => {
  for (const name of ['onDocCtxMenu', 'openDocCtxMenu', 'closeDocCtxMenu', 'onDocCtxDiscuss', 'resolveDocSelection']) {
    const src = fnSrc(name);
    assert.doesNotMatch(src, /\bapi\(|\bfetch\(/, `${name} 不应有后端请求`);
  }
});

t('T5 选文映射实现：段落/代码内 cloneRange 换行计数，跨块/富文本回退覆盖范围', () => {
  const r = fnSrc('resolveDocSelection');
  assert.match(r, /cloneRange\(\)/, '应克隆 Range 计算选区前文本');
  assert.match(r, /selectNodeContents/, '应从块首截取');
  assert.match(r, /setEnd\(range\.startContainer, range\.startOffset\)/, '应截至选区起点');
  assert.match(r, /Math\.min\(/, '跨块应取覆盖范围起点');
  assert.match(r, /Math\.max\(/, '跨块应取覆盖范围终点');
  assert.match(r, /docSelLines\(/, '块内应走精确行映射');
});

// ---------- T6 标注接线与缓存（静态） ----------

t('T6 loadDoc 渲染后调 annotateDocLines，docCache 存标注后 HTML（回填保留行标注）', () => {
  const ld = fnSrc('loadDoc');
  const posRender = ld.indexOf('view.innerHTML = renderMd(res.content)');
  const posAnnotate = ld.indexOf('annotateDocLines(view, res.content)');
  const posCache = ld.indexOf('state.drawer.docCache[name] = html');
  assert.ok(posRender >= 0, '应保留渲染语句');
  assert.ok(posAnnotate > posRender, '标注应在渲染之后');
  assert.ok(posCache > posAnnotate, '缓存应在标注之后写入（存标注后 HTML）');
  assert.match(ld, /html = view\.innerHTML/, '缓存值应取标注后的 view.innerHTML');
});

t('T6 renderDrawer/activateDrawerTab/closeDrawer 主动收起菜单', () => {
  assert.match(fnSrc('renderDrawer'), /closeDocCtxMenu\(\)/, '抽屉重渲染应收起菜单（目标 DOM 已重建）');
  assert.match(fnSrc('activateDrawerTab'), /closeDocCtxMenu\(\)/, '切换页签应收起菜单');
  assert.match(fnSrc('closeDrawer'), /closeDocCtxMenu\(\)/, '关闭抽屉应收起菜单');
});

// ---------- T7 菜单浮层（静态） ----------

t('T7 菜单单例：打开前先关旧菜单，同一时刻至多一个 .doc-ctx-menu', () => {
  const o = fnSrc('openDocCtxMenu');
  assert.match(o, /closeDocCtxMenu\(\);\s*\n\s*docCtxMenuInfo = info/, '打开前应先收起旧菜单（重定位单例）');
  assert.match(o, /className = 'doc-ctx-menu'/, '菜单类名固定');
  assert.match(o, /role/, '菜单应带 role=menu');
});

t('T7 视口内收：右/下溢出时向左/上翻转，不溢出视口', () => {
  const o = fnSrc('openDocCtxMenu');
  assert.match(o, /window\.innerWidth/, '应校验水平溢出');
  assert.match(o, /window\.innerHeight/, '应校验垂直溢出');
  assert.match(o, /- r\.width/, '右溢出应向左翻转');
  assert.match(o, /- r\.height/, '下溢出应向上翻转');
});

t('T7 收起通道：外部 pointerdown/Esc/任意滚动/resize 关闭且不执行；监听随关闭清理', () => {
  const o = fnSrc('openDocCtxMenu');
  assert.match(o, /addEventListener\('pointerdown', onDown, true\)/, '外部 pointerdown（捕获）应关闭');
  assert.match(o, /contains\(e\.target\)/, '菜单自身点击不触发关闭（让 click 先执行）');
  assert.match(o, /addEventListener\('keydown', onKey, true\)/, 'Esc（捕获）应关闭');
  assert.match(o, /e\.key === 'Escape'/, 'Esc 判定');
  assert.match(o, /addEventListener\('scroll', onScroll, true\)/, '任意滚动（捕获，含文档区内滚动）应关闭');
  assert.match(o, /addEventListener\('resize', onScroll\)/, '视口变化应关闭');
  assert.match(o, /removeEventListener\('pointerdown', onDown, true\)/, '关闭时应清理 pointerdown 监听');
  assert.match(o, /removeEventListener\('keydown', onKey, true\)/, '关闭时应清理 Esc 监听');
  assert.match(o, /removeEventListener\('scroll', onScroll, true\)/, '关闭时应清理滚动监听');
  assert.match(fnSrc('closeDocCtxMenu'), /docCtxMenuCleanup\(\)/, 'closeDocCtxMenu 应触发监听清理');
});

// ---------- T8 复制链路（静态） ----------

t('T8 复制走 copyPlain 双回退；成功 toast 已复制引用摘要；失败页内手动复制引导', () => {
  const d = fnSrc('onDocCtxDiscuss');
  assert.match(d, /await copyPlain\(/, '应走 copyPlain（navigator.clipboard + execCommand 双回退）');
  assert.match(d, /已复制 引用：/, '成功 toast 应含「已复制 引用：」摘要');
  assert.match(d, /uiCopyBox\(/, '失败应给页内自绘手动复制引导');
  assert.doesNotMatch(d, /window\.prompt/, '不得用 window.prompt（IAB 内同步弹窗会冻结页面）');
  const box = fnSrc('uiCopyBox');
  assert.match(box, /readOnly = true|setAttribute\('readonly'/, '手动复制文本域应只读');
  assert.match(box, /textarea/i, '应以文本域展开引用文本供选择复制');
});

// ---------- T9 样式契约（静态） ----------

t('T9 .doc-ctx-menu/.doc-ctx-item：fixed 浮层用面板变量体系，焦点可见，不新引入配色', () => {
  const menu = css.match(/\.doc-ctx-menu\s*\{[^}]*\}/);
  assert.ok(menu, '应存在 .doc-ctx-menu 样式');
  assert.match(menu[0], /position:\s*fixed/, '菜单应为 fixed 浮层');
  for (const v of ['var(--panel)', 'var(--border)', 'var(--shadow)']) {
    assert.ok(menu[0].includes(v), `应使用既有变量 ${v}`);
  }
  assert.doesNotMatch(menu[0], /#[0-9a-f]{3,8}\b/i, '不得新引入硬编码配色');
  const item = css.match(/\.doc-ctx-item\s*\{[^}]*\}/);
  assert.ok(item, '应存在 .doc-ctx-item 样式');
  assert.match(css, /\.doc-ctx-item:focus-visible\s*\{[^}]*outline/, '菜单项应有可见焦点态');
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
