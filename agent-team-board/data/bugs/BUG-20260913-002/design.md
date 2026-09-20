# 设计 — BUG-20260913-002 新建版本和版本查看界面的需求或 bug 如果标题过长，需要显示 tips

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260913-001——构建模块为本次新增界面（`scripts/web/build.js`，commit 4b7d8a2），候选行渲染函数 `renderCandidateRows()` 即出自该实现，标题 span 未带 `title` 属性，缺陷随之引入。候选口径相关联的前序修复为 BUG-20260913-001（经 `atb list` 核验均存在）。

## 根因分析

`scripts/web/build.js` 的 `renderCandidateRows()` 渲染候选行标题时输出：

```html
<span class="bld-cand-title">REQ-… 标题…</span>
```

- `.bld-cand-title` 样式（style.css）为单行 `overflow: hidden; text-overflow: ellipsis`，标题过长被省略号截断；
- span 未带原生 `title` 属性，截断后悬停无任何提示，长标题不可辨识全名。

对照：版本详情正文条目行（`build.js` `renderDetail()`）的 `bld-item-title` 同款截断样式但带 `title="完整标题"`，悬停可见完整标题——项目内已有可对齐的既定形态。两个侧拉面板（新建版本、添加条目）共用 `renderCandidateRows()`，一处修复两处生效。

## 方案

**人工优化口径（本单实施时拍板）**：tips 内容只显示完整标题、不含单号，与详情正文条目行既有 tips 口径一致；行内展示不变，仍为「单号 + 标题」。（原 README 建议含单号，人工明确改为仅标题。）

实现（原生 `title` 属性，零依赖、与既有形态完全对齐，无自研 / 无开源引入）：

```html
<span class="bld-cand-title" title="${esc(it.title || '')}">${esc(it.itemId)} ${esc(it.title || '')}</span>
```

- tips 值经既有 `esc()` 转义后再进属性，标题含引号 / 尖括号不截断属性、无注入；
- CSS / 布局零改动：不换行、不撑破面板，复选框、commit 下拉、全选 / 全不选工具条不变；
- 候选口径、勾选联动、校验与 toast 反馈等行为零变化。

测试：新增 `scripts/tests/bug-build-candidate-tips-title-20260913-002.test.mjs`（vm 行为测试，沿用 BUG-20260913-001 脚手架），覆盖：新建面板 tips 仅标题、添加条目面板同口径、特殊字符转义、行内「单号 + 标题」文案不变。

## 风险与边界

- tips 由浏览器原生渲染（无自定义悬浮层），移动端 / 触屏无悬停形态——与详情正文既有 `title` 形态一致，不在本单范围。
- 面板宽 420px，行内仍前置 16 字符单号，长标题依旧会被截断；tips 仅解决「截断后不可辨识」。
- 无候选空态、读取失败等状态不涉及候选行，不受影响。
