/* File Board 树/详情分隔条：纯逻辑 + 拖拽装配（REQ-20260906-004）
 * UMD 双通道：浏览器 classic script 挂 window.ATBSplitter（须在 app.js 之前加载）；
 * Node 测试走 module.exports，对纯函数直接单测。不依赖 app.js 的 $/state。 */
(function (global) {
  'use strict';

  const TREE_MIN = 180;       // 树最小宽（px）
  const TREE_DEFAULT = 300;   // 默认宽，与 style.css 的 .file-tree 保持一致
  const TREE_MAX_RATIO = 0.5; // 树最大不超过视口一半
  const VIEWER_MIN = 280;     // 详情栏保底可读宽（px）
  // 分栏容器左右留白 + 栏间间距 + 分隔条的宽度预算：取窄屏竖栏侧（≈94px）的保守值。
  // 只会让详情栏保底更宽，不会造成溢出。
  const FILE_VIEW_GUTTER = 130;
  const STORAGE_KEY = 'atb.fileTreeWidth';

  // 双约束取小者：视口 50% 上限、扣掉保底预算后的上限；再兜底到 TREE_MIN
  function treeMaxWidth(viewportWidth) {
    const vw = viewportWidth;
    const cap = Math.min(vw * TREE_MAX_RATIO, vw - TREE_MIN - VIEWER_MIN - FILE_VIEW_GUTTER);
    return Math.max(TREE_MIN, Math.round(cap));
  }

  function clampTreeWidth(width, viewportWidth) {
    return Math.min(treeMaxWidth(viewportWidth), Math.max(TREE_MIN, Math.round(width)));
  }

  // localStorage 值 → 可应用宽度；非法/缺失返回 null（调用方保持 CSS 默认 300）
  function parseStoredWidth(raw, viewportWidth) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return clampTreeWidth(n, viewportWidth);
  }

  // 拖拽装配：down 记起点，move 实时夹取回调 onChange，up/cancel 收尾 onCommit 恰一次，dblclick 触发 onReset
  function attach(opts) {
    const splitter = opts.splitter;
    const body = opts.body || (typeof document !== 'undefined' ? document.body : null);
    let dragging = false;
    let startX = 0;
    let startW = 0;
    let applied = 0;

    splitter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startW = opts.getTreeWidth();
      applied = startW;
      if (splitter.setPointerCapture) {
        try { splitter.setPointerCapture(e.pointerId); } catch {}
      }
      splitter.classList.add('dragging');
      if (body) body.classList.add('splitting');
      e.preventDefault();
    });
    splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      applied = clampTreeWidth(startW + (e.clientX - startX), opts.getViewportWidth());
      opts.onChange(applied);
    });
    const finish = (e) => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('dragging');
      if (body) body.classList.remove('splitting');
      if (splitter.releasePointerCapture) {
        try { splitter.releasePointerCapture(e.pointerId); } catch {}
      }
      opts.onCommit(applied);
    };
    splitter.addEventListener('pointerup', finish);
    splitter.addEventListener('pointercancel', finish);
    splitter.addEventListener('dblclick', () => opts.onReset());
  }

  const api = {
    TREE_MIN, TREE_DEFAULT, TREE_MAX_RATIO, VIEWER_MIN, FILE_VIEW_GUTTER, STORAGE_KEY,
    treeMaxWidth, clampTreeWidth, parseStoredWidth, attach,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ATBSplitter = api;
})(typeof window !== 'undefined' ? window : globalThis);
