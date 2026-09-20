# 测试用例 — REQ-20260906-004 File Board 文件详情栏过窄：支持拖拽分隔条调宽并记忆

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 对应 `scripts/tests/file-splitter.test.mjs`（S1–S7 纯函数单测 + 静态契约）；M1 为浏览器人工核验。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | 范围夹取：clampTreeWidth 低于 180 取 180；超视口 50% 取 50%；极窄窗口（50% 上限 < 180 或详情保底不足）时仍保 180 | P0 | ✅ |
| S2 | 双约束上限：正常宽度下上限 = min(视口50%, 视口-保底预算)，桌面宽屏由 50% 生效 | P0 | ✅ |
| S3 | 记忆恢复：parseStoredWidth 合法值夹取返回；非数字/负数/空返回 null（保持默认 300） | P0 | ✅ |
| S4 | 拖拽交互（attach 假元素仿真）：down 记起点+加态，move 实时夹取 onChange，up 收尾 onCommit 恰一次；未按下 move 不触发；pointercancel 同 up；dblclick 触发 onReset | P0 | ✅ |
| S5 | 结构契约：index.html 有 #fileSplitter 位于树与详情之间，role=separator/aria-orientation=vertical/aria-label；splitter.js 在 app.js 之前引入 | P0 | ✅ |
| S6 | CSS 契约：.file-splitter 6px/flex:none/col-resize/主题变量底色，hover 高亮，.dragging 加深；body.splitting 禁选中；.file-view gap=4px；.file-tree 默认 300；.file-viewer flex:1 + min-width:0 | P1 | ✅ |
| S7 | 接线契约：app.js 调用 ATBSplitter（loadTreeWidth/commit 持久化/dblclick 重置 300/resize 重夹取），initFileBoard 内初始化且幂等 | P1 | ✅ |
| S8 | 树层级缩进压缩（2026-09-06 用户追加反馈）：wb-indent 12px/级、叶节点 expander 兼作缩进时保持图标宽对齐、vendor 图标变量不变（file-board.test.mjs F13） | P1 | ✅ |
| M1 | 浏览器实测：拖动流畅无溢出遮挡、双击回 300、刷新后保持、深浅色 hover 一致、详情空态文案不变 | P1 | 人工 |
