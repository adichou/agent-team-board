#!/usr/bin/env node
// BUG-20260915-005 挂起确认面板「保持挂起 / 重新核验 / 确认并继续」按钮缺少使用场景说明 —— 修复回归。
// 用法：node scripts/tests/bug-confirm-btn-guide-20260915-005.test.mjs
// 覆盖（README 验收标准）：
//   · T1 develop 侧三按钮各带 title 与 aria-label（悬停 / 读屏均可见场景 + 后果）；
//   · T2 develop 侧按钮区上方一行 muted small 三按钮对照说明（不依赖悬停，触屏 / 键盘可读），
//     位于 footer 按钮区之前；
//   · T3 分析侧（hold 问题）面板「保持挂起 / 保存草稿 / 确认并继续」同口径统一；
//   · T4 任务页卡片「查看并确认 / 重新核验」按钮同口径补 title（卡片重新核验含 aria-label）；
//   · T5 新增文案全部进入 scripts/web/i18n.js 双语表（中英文环境均正常显示）。
// 片段加载模式对齐 bug-confirm-reason-classify-20260915-004.test.mjs（vm 提取真实 app.js 源码）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { makeScanner, extractFragments } from './lib/js-string-scanner.mjs';
import '../web/i18n.js';

const appSource = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const I = globalThis.ATBI18N;
assert.ok(I, 'i18n.js 应在 globalThis.ATBI18N 暴露接口');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function runRenderFragment(detail, { needsReverify = false } = {}) {
  const nodes = new Map();
  const mk = (id) => {
    const el = {
      textContent: '', innerHTML: '',
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    };
    nodes.set(`#${id}`, el);
    return el;
  };
  for (const id of ['confirmPanelTitle', 'confirmPanelScope', 'confirmForm', 'confirmScopeSummary', 'confirmUnresolved']) mk(id);
  const context = vm.createContext({
    $: (s) => nodes.get(s) || nodes.get(s.replace(/^#confirmForm /, '')) || null,
    esc,
    fmtTime: () => '12:00',
    confirmSide: { busy: false, attr: new Map(), needsReverify },
    state: { confirms: { busyId: null } },
    confirmScopeText: (c) => `待提交：${c.pendingCount} 个路径`,
    confirmAttrOf: () => null,
    bindConfirmFormActions: () => {},
  });
  const start = appSource.indexOf('function renderConfirmForm(');
  const end = appSource.indexOf('function bindConfirmFormActions(');
  assert.ok(start > 0 && end > start, 'app.js 应包含 renderConfirmForm 片段');
  vm.runInContext(appSource.slice(start, end), context);
  vm.runInContext(`renderConfirmForm(${JSON.stringify(detail)})`, context);
  return nodes.get('#confirmForm').innerHTML;
}

function runCardFragment(card) {
  const context = vm.createContext({
    esc, fmtElapsed: () => '1 分', fmtTime: () => '12:00', shortOwner: (s) => String(s || ''),
    state: { confirms: { busyId: null } },
  });
  const start = appSource.indexOf('function confirmKindChip(');
  const end = appSource.indexOf('function renderConfirmArea(');
  assert.ok(start > 0 && end > start, 'app.js 应包含卡片渲染片段');
  vm.runInContext(appSource.slice(start, end), context);
  return vm.runInContext(`confirmCardHtml(${JSON.stringify(card)})`, context);
}

const buttonTag = (html, id) => {
  const m = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
  return m ? m[0] : '';
};
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
};

const devDetail = {
  itemId: 'BUG-1', kind: 'develop', blockTypeLabel: '待人工确认提交', state: 'waiting',
  reason: '自动提交失败', legacy: false, committedCount: 0, supplementCommits: [],
  pendingCount: 2, attributedCount: 2, uncertainCount: 0, scopeUnknown: false,
  files: [{ path: 'scripts/lib/impl.mjs', group: 'own', kind: '修改', state: '未提交' }],
  verify: null, keepNote: null, fingerprint: { files: {} },
};
const anDetail = {
  itemId: 'REQ-1', kind: 'analyze', blockTypeLabel: '待人工确认分析', state: 'waiting',
  background: '方案二选一', total: 2, answered: 0, unansweredRequired: ['Q1'],
  questions: [{ id: 'Q1', text: '选哪个方案？', required: true, options: [{ label: 'A' }, { label: 'B' }] }],
  keepNote: null,
};

// ---------- T1：develop 侧三按钮 title + aria-label（场景 + 后果） ----------

t('T1 develop 面板三按钮各带 title 与 aria-label：适用场景 + 点击后果', () => {
  const html = runRenderFragment(devDetail);
  const keep = buttonTag(html, 'confirmKeepBtn');
  const verify = buttonTag(html, 'confirmVerifyBtn');
  const cont = buttonTag(html, 'confirmContinueBtn');
  assert.ok(keep && verify && cont, '三按钮均应渲染');

  const keepTitle = attr(keep, 'title');
  assert.ok(keepTitle, '「保持挂起」应有 title（悬停可见）');
  assert.equal(attr(keep, 'aria-label'), keepTitle, '「保持挂起」aria-label 应与 title 同口径（读屏可闻）');
  assert.ok(/暂不处理|稍后再来/.test(keepTitle) && keepTitle.includes('说明留档') && /队列暂停|暂停保留/.test(keepTitle),
    `「保持挂起」应含场景（暂不处理）与后果（说明留档、队列暂停）：${keepTitle}`);

  const verifyTitle = attr(verify, 'title');
  assert.ok(verifyTitle, '「重新核验」应有 title');
  assert.equal(attr(verify, 'aria-label'), verifyTitle, '「重新核验」aria-label 应与 title 同口径');
  assert.ok(/只检查|只重查不提交/.test(verifyTitle), `「重新核验」应注明只查不改现场：${verifyTitle}`);
  assert.ok(/自行补交|状态已变化/.test(verifyTitle) && verifyTitle.includes('最近核验'),
    `「重新核验」应含适用场景（终端自行补交后 / 怀疑状态变化）与后果（刷新最近核验结论）：${verifyTitle}`);

  const contTitle = attr(cont, 'title');
  assert.ok(contTitle, '「确认并继续」应有 title');
  assert.equal(attr(cont, 'aria-label'), contTitle, '「确认并继续」aria-label 应与 title 同口径');
  assert.ok(contTitle.includes('补交') && contTitle.includes('测试') && contTitle.includes('恢复队列'),
    `「确认并继续」应说明后果（补交 + 复验测试 + 恢复队列）：${contTitle}`);
});

t('T1b 内容变化拦截态：「确认并继续」title 转为指引先重新核验（aria-label 同步）', () => {
  const html = runRenderFragment(devDetail, { needsReverify: true });
  const cont = buttonTag(html, 'confirmContinueBtn');
  const title = attr(cont, 'title');
  assert.ok(title && title.includes('重新核验'), `拦截态应指引先重新核验：${title}`);
  assert.equal(attr(cont, 'aria-label'), title, '拦截态 aria-label 应与 title 同口径');
});

// ---------- T2：按钮区上方一行对照说明（不依赖悬停） ----------

t('T2 develop 面板按钮区上方有一行 muted small 三按钮对照说明，位于 footer 之前', () => {
  const html = runRenderFragment(devDetail);
  const gi = html.indexOf('confirm-btn-guide');
  assert.ok(gi > 0, '应有对照说明节点（confirm-btn-guide）');
  assert.ok(/class="[^"]*muted[^"]*small[^"]*"/.test(html.slice(gi - 200, gi + 200)), '对照说明应使用 muted small 样式');
  const guide = html.slice(gi, html.indexOf('</p>', gi));
  for (const k of ['保持挂起＝', '重新核验＝', '确认并继续＝']) {
    assert.ok(guide.includes(k), `对照说明应逐个区分三按钮（缺 ${k}）：${guide.slice(0, 160)}`);
  }
  const fi = html.indexOf('<footer class="modal-foot">');
  assert.ok(fi > gi, '对照说明应在按钮 footer 之前（先读说明再见按钮）');
});

// ---------- T3：分析侧（hold 问题）面板同口径统一 ----------

t('T3 分析侧面板「保持挂起 / 保存草稿 / 确认并继续」同口径：title + aria-label + 对照说明', () => {
  const html = runRenderFragment(anDetail);
  const keep = buttonTag(html, 'confirmKeepBtn');
  const draft = buttonTag(html, 'confirmDraftBtn');
  const cont = buttonTag(html, 'confirmContinueBtn');
  assert.ok(keep && draft && cont, '分析侧三按钮均应渲染');

  const keepTitle = attr(keep, 'title');
  assert.ok(keepTitle && /暂不处理|稍后再来/.test(keepTitle) && keepTitle.includes('说明留档'),
    `分析侧「保持挂起」应与 develop 侧同口径：${keepTitle}`);
  assert.equal(attr(keep, 'aria-label'), keepTitle, '分析侧「保持挂起」aria-label 应与 title 同口径');

  const draftTitle = attr(draft, 'title');
  assert.ok(draftTitle && draftTitle.includes('草稿') && /不确认|不续跑/.test(draftTitle),
    `「保存草稿」应说明后果（暂存作答，不确认不续跑）：${draftTitle}`);
  assert.equal(attr(draft, 'aria-label'), draftTitle, '「保存草稿」aria-label 应与 title 同口径');

  const contTitle = attr(cont, 'title');
  assert.ok(contTitle && contTitle.includes('答案回传') && contTitle.includes('必答'),
    `分析侧「确认并继续」应说明后果（答案回传续跑）与前提（必答全部作答）：${contTitle}`);
  assert.equal(attr(cont, 'aria-label'), contTitle, '分析侧「确认并继续」aria-label 应与 title 同口径');

  const gi = html.indexOf('confirm-btn-guide');
  assert.ok(gi > 0, '分析侧也应有对照说明节点');
  const guide = html.slice(gi, html.indexOf('</p>', gi));
  for (const k of ['保持挂起＝', '保存草稿＝', '确认并继续＝']) {
    assert.ok(guide.includes(k), `分析侧对照说明应逐个区分三按钮（缺 ${k}）：${guide.slice(0, 160)}`);
  }
});

// ---------- T4：任务页卡片按钮同口径 ----------

t('T4 卡片「查看并确认 / 重新核验」补 title；卡片重新核验带 aria-label', () => {
  const devCard = runCardFragment({
    itemId: 'BUG-1', kind: 'develop', kindLabel: '开发', blockType: 'commit', blockTypeLabel: '提交挂起',
    title: '提交挂起单', declaredAt: new Date().toISOString(), state: 'waiting',
    committedCount: 0, supplementCommits: [], pendingCount: 1, attributedCount: 1, uncertainCount: 0,
    partialBadge: true,
  });
  const panelBtn = buttonTag(devCard, '') || (devCard.match(/<button[^>]*data-confirm-panel="[^"]*"[^>]*>/) || [''])[0];
  assert.ok(panelBtn, '卡片应有「查看并确认」入口');
  const panelTitle = attr(panelBtn, 'title');
  assert.ok(panelTitle && panelTitle.includes('侧拉面板'), `「查看并确认」应说明打开侧拉面板后的核对内容：${panelTitle}`);
  const verifyBtn = (devCard.match(/<button[^>]*data-confirm-verify="[^"]*"[^>]*>/) || [''])[0];
  assert.ok(verifyBtn, '卡片应有「重新核验」按钮');
  assert.ok(attr(verifyBtn, 'title') && /只检查|只重查不提交/.test(attr(verifyBtn, 'title')),
    `卡片「重新核验」title 应与面板同口径：${attr(verifyBtn, 'title')}`);
  assert.ok(attr(verifyBtn, 'aria-label'), '卡片「重新核验」应带 aria-label');

  const anCard = runCardFragment({
    itemId: 'REQ-1', kind: 'analyze', kindLabel: '分析', blockType: 'question', blockTypeLabel: '待确认分析',
    title: '分析挂起单', declaredAt: new Date().toISOString(), state: 'waiting', total: 2, unansweredRequired: ['Q1'],
  });
  const anPanelBtn = (anCard.match(/<button[^>]*data-confirm-panel="[^"]*"[^>]*>/) || [''])[0];
  const anTitle = attr(anPanelBtn, 'title');
  assert.ok(anTitle && /作答|问题/.test(anTitle), `分析卡片入口 title 应贴合作答场景：${anTitle}`);
});

// ---------- T5：i18n 双语覆盖 ----------

t('T5 新增按钮场景文案全部进入 i18n 双语表（中英文环境均正常显示）', () => {
  // 用与 i18n-coverage 同源扫描器提取面板 / 卡片段内全部中文片段（含模板内条件分支字面量）
  const panelSources = [
    appSource.slice(appSource.indexOf('function renderConfirmForm('), appSource.indexOf('function bindConfirmFormActions(')),
    appSource.slice(appSource.indexOf('function confirmKindChip('), appSource.indexOf('function renderConfirmArea(')),
  ];
  const panelZh = [...new Set(panelSources.flatMap((src) => {
    const { texts, attrs } = extractFragments(makeScanner().run(src));
    return [...texts, ...attrs];
  }).filter((s) => /[\u4e00-\u9fff]/.test(s)))];
  const { EN, EN_DYNAMIC, ALLOWLIST } = I._dict;
  const missing = panelZh.filter((s) => !(s in EN || s in EN_DYNAMIC || s in ALLOWLIST));
  assert.deepEqual(
    missing,
    [],
    `以下面板 / 卡片中文文案缺少 i18n 双语条目：\n${missing.map((s) => '  - ' + s).join('\n')}`,
  );
  // 新增按钮场景说明走 EN 静态词典（不接受豁免），值不得含中文
  const mustEn = [
    '保持挂起：暂不处理，处理说明留档，现场与队列暂停保留，稍后再来',
    '重新核验：只检查不改现场（重算候选路径并运行测试）；终端已自行补交后或怀疑状态已变化时，用它刷新「最近核验」结论',
    '确认并继续：授权补交选中文件、复验测试，通过后恢复队列，一步闭环',
    '保持挂起＝暂不处理，说明留档，现场与队列暂停保留 · 重新核验＝只检查不改现场，重核提交状态并跑测试，刷新「最近核验」结论 · 确认并继续＝授权补交剩余路径＋复验测试＋恢复队列',
    '保存草稿：暂存当前作答，不确认不续跑，稍后可继续作答',
    '确认并继续：答案回传当前条目继续分析；必答项全部作答才能确认',
    '保持挂起＝暂不处理，说明留档，队列保持暂停 · 保存草稿＝暂存作答，不确认不续跑 · 确认并继续＝答案回传当前条目继续分析，未决问题清零才处理下一条',
    '打开侧拉面板：核对文件、差异与核验结论后处理',
    '打开侧拉面板：查看问题并逐项作答后确认',
  ];
  for (const k of mustEn) {
    assert.ok(k in EN, `按钮场景文案应进 EN 静态词典：${k}`);
    assert.ok(!/[\u4e00-\u9fff]/.test(EN[k]), `EN 值不得含中文：${k}`);
  }
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
