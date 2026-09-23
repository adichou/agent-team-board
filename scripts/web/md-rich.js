'use strict';
// BUG-20260923-002 Markdown 预览富媒体增强层（图片相对路径改写 + mermaid 渲染 + plantuml 降级）。
// 设计：renderMd / sanitizeHtml 四处逐字同口径实现保持零改动，本模块在富文本容器渲染完成后
// 做 DOM 后置增强——与 app.js linkupDocImages（REQ-20260909-009 条目文档截图接管）同构先例。
// 宿主（build.js 审查对话框 / app.js 文件面板与条目文档 / req-disc.js / oncall.js）渲染后调用
// ATBMdRich.enhance(container, opts)，可选链调用：模块缺失或图表库缺失均静默降级，不白屏。
// - 图片：相对 src（无协议、非 / # 开头）经 opts.imgBase(raw) → 端点 URL 改写（./ 前缀先归一）；
//   所有图片挂 error 就地占位（含路径与原因），不渲染裸裂图；协议 / 根相对 / 锚点不改写。
// - mermaid：`​```mermaid` 围栏替换为 .md-mermaid 待渲染容器，懒加载 vendor 的
//   scripts/web/mermaid.min.js（index.html 不静态引入，常规页面加载零成本）后 render 为 SVG；
//   securityLevel:'strict'、主题随 prefers-color-scheme 深浅色；失败（语法 / 库）回退源码 + 可见提示。
// - plantuml：本地渲染无满足「本地优先 + License 白名单」的库（官方为 Java 实现），在线渲染
//   服务与「本地优先 · 无外部依赖」原则冲突、未经确认不接——首期给明确降级提示 + 源码。
// - 幂等：图片 data-md-rich 标记；回退源码块 pre data-md-keep 防二次包裹；.md-mermaid[data-pending]
//   待渲染容器再次 enhance 时重跑（覆盖 app.js 条目文档 docCache 回填缓存了「渲染中」占位）。
// 提示文案插入时经 ATBI18N.t() 现算：审查对话框富文本容器整体 data-i18n-skip，MutationObserver
// 接不住其内部新增节点（图表容器同样豁免——SVG 文字是文档本体），必须插入时自译。
// 同时作为普通脚本 / Node ESM 导入（模式对齐 i18n.js）：globalThis.ATBMdRich 供测试直测纯函数。

function t99(s) {
  try { const I = globalThis.ATBI18N; return I && typeof I.t === 'function' ? I.t(s) : s; } catch { return s; }
}

// 相对路径拼接（纯函数，供测试与宿主锚点计算）：'./x' 归一；'..' 轻归并；越出基层数时原样
// 保留 '../'（前端不吞越权路径，交 /api/fs/raw 端点拒绝 → 占位提示，安全口径不放宽）。
function relFrom(base, raw) {
  const r = String(raw || '').replace(/^\.\//, '');
  if (!r) return String(base || '');
  const segs = String(base || '').split('/').filter(Boolean);
  for (const part of r.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (segs.length && segs[segs.length - 1] !== '..') segs.pop();
      else segs.push('..');
    } else segs.push(part);
  }
  return segs.join('/');
}

/* ---------- 图片增强 ---------- */

function isRewriteableImgSrc(raw) {
  return !!raw && !raw.startsWith('#') && !raw.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(raw);
}

function enhanceImages(container, opts) {
  for (const img of container.querySelectorAll('img')) {
    if (typeof img.getAttribute !== 'function' || img.getAttribute('data-md-rich') != null) continue;
    try { img.setAttribute('data-md-rich', '1'); } catch { /* 假 DOM / 异常节点不阻断 */ }
    const raw = img.getAttribute('src') || '';
    let rewrote = false;
    if (isRewriteableImgSrc(raw) && typeof opts.imgBase === 'function') {
      const url = opts.imgBase(relFrom('', raw));
      if (url) {
        try { img.setAttribute('loading', 'lazy'); } catch { /* 同上 */ }
        img.src = url; // 真实 DOM：属性赋值触发按新 URL 加载
        rewrote = true;
      }
    }
    attachImgError(img, raw, rewrote);
  }
}

function attachImgError(img, raw, rewrote) {
  if (typeof img.addEventListener !== 'function') return;
  img.addEventListener('error', () => {
    try {
      const doc = typeof document !== 'undefined' ? document : null;
      if (!doc || typeof doc.createElement !== 'function') return;
      const p = doc.createElement('p');
      p.setAttribute('class', 'md-img-fallback muted small');
      p.setAttribute('data-md-rich', '1');
      p.textContent = t99(rewrote
        ? `图片 ${raw} 无法加载（不存在、越出项目根或超过 8MB 上限）`
        : `图片 ${raw} 加载失败（外链不可达、路径不存在或格式不受支持）`);
      img.replaceWith(p);
    } catch { /* 占位失败则退回浏览器原生裂图，不影响页面 */ }
  });
}

/* ---------- 图表增强（mermaid / plantuml） ---------- */

let mermaidSeq = 0;
let mermaidLoading = null;

function darkMode() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch { return false; }
}

// 懒加载 vendor 的 mermaid（/mermaid.min.js，BUG-20260923-002 licenses.md）。只在首次遇到
// 图表围栏时动态注入：常规页面加载不背约 3.5MB 库；注入失败 / 8s 超时按「库加载失败」降级。
function ensureMermaid() {
  if (globalThis.mermaid) return Promise.resolve(globalThis.mermaid);
  if (mermaidLoading) return mermaidLoading;
  if (typeof document === 'undefined' || !document.createElement || !(document.head || document.body)) {
    return Promise.resolve(null);
  }
  mermaidLoading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.setAttribute('src', '/mermaid.min.js');
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok ? (globalThis.mermaid || null) : null); } };
    s.addEventListener('load', () => finish(true));
    s.addEventListener('error', () => finish(false));
    try { (document.head || document.body).appendChild(s); } catch { finish(false); return; }
    setTimeout(() => finish(!!globalThis.mermaid), 8000); // 挂死兜底：不给用户留永久「渲染中」
  });
  return mermaidLoading;
}

function mermaidFailMsg(err) {
  let reason = '';
  try { reason = String((err && err.message) || err || '').split('\n')[0].slice(0, 120); } catch { reason = ''; }
  return t99(`⚠ Mermaid 图表渲染失败（${reason}）：已回退为源码展示`);
}

// 失败 / 降级统一形态：可见提示条 + 源码块（pre data-md-keep 防二次包裹）
function diagramFallback(target, kind, noteText, src) {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || typeof doc.createElement !== 'function' || typeof target.replaceWith !== 'function') return;
  const wrap = doc.createElement('div');
  wrap.setAttribute('class', 'md-diagram-fallback');
  const note = doc.createElement('p');
  note.setAttribute('class', kind === 'note' ? 'md-diagram-note' : 'md-diagram-err');
  note.textContent = noteText;
  wrap.appendChild(note);
  if (src != null) {
    const pre = doc.createElement('pre');
    pre.setAttribute('data-md-keep', '1');
    const code = doc.createElement('code');
    code.textContent = src;
    pre.appendChild(code);
    wrap.appendChild(pre);
  }
  target.replaceWith(wrap);
}

function renderMermaidDiv(div, src) {
  ensureMermaid().then((mermaid) => {
    if (!mermaid || div.getAttribute('data-pending') == null) {
      if (!mermaid) diagramFallback(div, 'err', t99('⚠ Mermaid 渲染库加载失败（/mermaid.min.js）：已回退为源码展示'), src);
      return;
    }
    try {
      mermaid.initialize({
        startOnLoad: false, // 手动按节点渲染，不自动扫描全页
        securityLevel: 'strict', // 转义标签文字（文档内容不可信）
        theme: darkMode() ? 'dark' : 'default', // 深浅色随系统外观
      });
      Promise.resolve(mermaid.render(`md-rich-dia-${++mermaidSeq}`, src)).then((out) => {
        if (div.getAttribute('data-pending') == null) return; // 已被后续状态覆盖
        div.innerHTML = (out && out.svg) || '';
        div.removeAttribute('data-pending');
      }).catch((e) => diagramFallback(div, 'err', mermaidFailMsg(e), src));
    } catch (e) {
      diagramFallback(div, 'err', mermaidFailMsg(e), src);
    }
  }).catch((e) => diagramFallback(div, mermaidFailMsg(e), src));
}

function enhanceDiagrams(container) {
  for (const code of container.querySelectorAll('pre > code')) {
    const cls = (typeof code.getAttribute === 'function' && code.getAttribute('class')) || '';
    const m = /(?:^|\s)language-(mermaid|plantuml)\b/i.exec(cls);
    if (!m) continue;
    const pre = code.parentElement;
    if (!pre || (typeof pre.getAttribute === 'function' && pre.getAttribute('data-md-keep') != null)) continue;
    const lang = m[1].toLowerCase();
    const src = code.textContent || '';
    if (lang === 'plantuml') {
      // 本地渲染无可用库（官方 Java 实现；在线服务与本地优先原则冲突未获确认）——明确降级提示
      diagramFallback(pre, 'note', t99('PlantUML 图表暂不支持本地渲染：为保持「本地优先 · 无外部依赖」未接入在线渲染服务，以下为源码'), src);
      continue;
    }
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc || typeof doc.createElement !== 'function' || typeof pre.replaceWith !== 'function') continue;
    const div = doc.createElement('div');
    div.setAttribute('class', 'md-mermaid');
    div.setAttribute('data-src', src);
    div.setAttribute('data-pending', '1');
    div.setAttribute('data-i18n-skip', ''); // SVG 文字是文档本体，不进界面词典
    const note = doc.createElement('p');
    note.setAttribute('class', 'muted small md-mermaid-note');
    note.textContent = t99('正在渲染 Mermaid 图表…'); // 豁免子树内自译（见文件头）
    div.appendChild(note);
    pre.replaceWith(div);
  }
  // 待渲染容器统一渲染（新替换的围栏 + docCache 回填的「渲染中」占位同一路径，天然幂等）
  for (const div of container.querySelectorAll('.md-mermaid[data-pending]')) {
    renderMermaidDiv(div, div.getAttribute('data-src') || '');
  }
}

/* ---------- 对外入口 ---------- */

function enhance(container, opts = {}) {
  if (!container || typeof container.querySelectorAll !== 'function') return;
  try { enhanceImages(container, opts); } catch { /* 增强失败不影响宿主渲染 */ }
  try { enhanceDiagrams(container); } catch { /* 同上 */ }
}

const ATBMdRich = { enhance, relFrom };

if (typeof window !== 'undefined') window.ATBMdRich = ATBMdRich;
globalThis.ATBMdRich = ATBMdRich;

// 浏览器：系统深浅色切换时对已渲染图表重绘（lazy 引用 document，Node 测试导入不接线）
if (typeof document !== 'undefined' && typeof matchMedia === 'function') {
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      for (const div of document.querySelectorAll('.md-mermaid[data-src]')) {
        if (div.getAttribute('data-pending') != null) continue;
        div.setAttribute('data-pending', '1');
        renderMermaidDiv(div, div.getAttribute('data-src') || '');
      }
    });
  } catch { /* 旧浏览器无 addEventListener：跳过重绘，主题待下次渲染 */ }
}
