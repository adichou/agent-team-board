# 设计 — BUG-20260927-002 文档与翻译界面的二次边界对话框，底部的关闭按钮无法关闭窗口

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260924-006（「文档编写流程优化」，经 `atb list` 核验存在、状态 done）。二次编辑弹窗由该需求引入（scripts/web/build.js 内「REQ-20260924-006 ② 二次编辑弹窗」注释与提交 675a215「feat: 文档编写流程优化 REQ-20260924-006」中首次出现 `q('[data-edit-close]')` 绑定行可佐证）。

## 根因分析

弹窗有**两个**关闭按钮共用同一属性 `data-edit-close`（scripts/web/build.js `renderSecondaryEditModal`：头部「✕ 关闭」约 4059 行、底部「关闭」约 4085 行），但事件绑定只绑了第一个：

- 绑定处（约 5136 行）：`q('[data-edit-close]')?.addEventListener('click', requestEditClose)`；
- `q` 的定义（约 4830 行）：`const q = (s) => view.querySelector(s)`——`querySelector` 只返回 DOM 顺序第一个匹配，即头部按钮。

于是头部「✕ 关闭」成为唯一挂上监听的关闭按钮，底部「关闭」没有监听器，点击无任何反应（也无禁用态兜底提示）。头部 ✕ / Esc（约 5272 行 keydown 分支）/ 遮罩点击（约 5137 行）三条关闭路径不受影响，与「仅底部按钮失灵」的现象完全吻合。

对照同文件审查对话框：`data-review-close` 同样是头部 + 底部双按钮，但用 `view.querySelectorAll('[data-review-close]')` 循环逐个绑定（约 5205 行），两处均可用——正确范式已存在，本弹窗绑定是漏改。

## 方案

把约 5136 行的单元素绑定改为与审查对话框同口径的循环绑定（一行改动）：

```js
for (const el of view.querySelectorAll('[data-edit-close]')) {
  el.addEventListener('click', requestEditClose);
}
```

底部按钮由此复用同一 `requestEditClose`：无未保存修改直接 `closeEditDialog()`（保持 BUG-20260925-004「只摘弹窗元素、不整块重建」口径）；有未保存修改先进挂起三动作保护条；busy 时既有守卫直接 return（底部按钮本身在 busy 渲染禁用）。不改渲染结构、不改文案、不改 i18n 词典。

**开源选型（REQ-20260909-015）**：不涉及——纯前端事件绑定修复，无新依赖、无自研库诉求，不创建 licenses.md。

## 风险与边界

- 同类风险排查：`scripts/web/build.js` 内以 `q('[data-…]')` 单绑定的属性中，`data-edit-close` 是唯一在同一视图内出现两个实例的（`data-review-close` / `data-review-tab` / `data-doc-rm` / `data-chk-*` 等多实例属性均已用 `querySelectorAll` 循环绑定）；修复后建议在测试中固化「弹窗内所有 `data-edit-close` 均可关闭」防回归。
- 不改关闭语义与守卫：busy 禁用 / 挂起保护 / Esc 先撤提示等既有口径全部保留，避免把「修按钮」扩大成「改交互」。
- 回归面：头部 ✕、Esc、遮罩三条关闭路径 + 未保存保护三动作 + 保存流程（savedNote / busy 态）需在测试或手工验证中覆盖。
