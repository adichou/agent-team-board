/* File Board 横幅层栈状态机：纯函数（REQ-20260906-007）
 * UMD 双通道：浏览器 classic script 挂 window.ATBBanner（须在 app.js 之前加载）；
 * Node 测试走 module.exports，对纯函数直接单测。不依赖 app.js 的 $/state。
 *
 * 层栈 layers 是「从根到当前最深层」的目录路径数组，首元素恒为 ''（项目根），
 * 例如 ['', 'docs', 'docs/agent-team-board']。所有函数均为纯函数：返回新数组，
 * 不修改入参。entries 拉取与 DOM 渲染由 app.js 负责，本模块只管路径栈。 */
(function (global) {
  'use strict';

  // 默认展开路径（与旧目录树 expandDefaultPath 行为一致）
  const DEFAULT_PATH = 'docs/agent-team-board';

  // 进入目录 dirPath：已在栈中 → 截断到该层（含）；否则追加为最深层。
  // dirPath 为 ''（项目根）时等同于回到只剩根层。
  function openLayer(layers, dirPath) {
    const stack = Array.isArray(layers) ? layers : [];
    const dir = String(dirPath ?? '');
    const idx = stack.indexOf(dir);
    if (idx !== -1) return stack.slice(0, idx + 1);
    if (dir === '') return [''];
    return [...stack, dir];
  }

  // 面包屑回跳：截断到 dirPath（含）。dirPath 不在栈中时原样返回拷贝。
  function truncateTo(layers, dirPath) {
    const stack = Array.isArray(layers) ? layers : [];
    const dir = String(dirPath ?? '');
    const idx = stack.indexOf(dir);
    if (idx === -1) return stack.slice();
    return stack.slice(0, idx + 1);
  }

  // 面包屑逐段派生：首段为项目根（path=''，name 取注入的项目名），
  // 其余每层段名取路径末段。
  function crumbOf(layers, rootLabel) {
    const stack = Array.isArray(layers) ? layers : [];
    const segs = [{ name: String(rootLabel ?? ''), path: '' }];
    for (const p of stack.slice(1)) {
      segs.push({ name: p.split('/').filter(Boolean).pop() || p, path: p });
    }
    return segs;
  }

  const api = { DEFAULT_PATH, openLayer, truncateTo, crumbOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ATBBanner = api;
})(typeof window !== 'undefined' ? window : globalThis);
