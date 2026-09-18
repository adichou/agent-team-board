# 测试用例 — REQ-20260906-020 待接受卡片「✓ 接受」按钮移至单号右侧

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 静态契约测试：scripts/tests/pending-accept-inline.test.mjs（T1–T5）；交互/禁用态行为复用 accept-ui.test.mjs 既有用例回归（A2/A13）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 按钮位置：「✓ 接受」按钮渲染在待接受卡片首行 .card-top 内，顺序为 选择框→chip→单号(.cid)→按钮，且在「待确认」flag 之前 | P0 | 通过 |
| T2 | 旧布局移除：app.js 卡片模板不再有 .card-accept 底部按钮行；style.css 中 .card-accept 选择器全部清理 | P0 | 通过 |
| T3 | 交互保留：按钮仍携带 data-accept-id，点击 stopPropagation 不打开详情并单条接受（acceptItems([it.id])），渲染时初始化禁用态；syncAcceptance 仍按 [data-act="accepted"] 一并同步 | P0 | 通过 |
| T4 | 样式：行内按钮保持 12px 级紧凑尺寸（padding 4px 9px / font-size 12px）且 flex:none 不被压缩；禁用态样式保留 | P1 | 通过 |
| T5 | 其他状态不受影响：接受按钮仍仅在 submitted 分支渲染，accepted 卡片首行仍为批量实施复选框（data-impl-id） | P1 | 通过 |
