# 测试用例 — BUG-20260913-004 版本卡片行内操作按钮（AI 完善 / 合并入 main）

实现文件：`scripts/tests/bug-build-ver-card-acts-20260913-004.test.mjs`（vm 行为 + 静态契约，沿用 `build-ui.test.mjs` 假 DOM 口径）。

## 用例

- **B1 列表卡片内联两操作按钮**：版本列表每张 `.rel-card` 内渲染 `data-ver-answer`（文本「AI 完善」）与 `data-ver-merge`（文本「合并入 main」）按钮，均带 `aria-label`（动作 + 版本号）与 `title`（说明动作）；未选中任何版本时按钮同样渲染（入口不随右侧详情联动）。
- **B2 状态口径逐卡继承**：`draft` 两键可用；`merging` 卡片两键均 disabled（AI 完善 title=「合并中，请稍候……」、合并键 title=「合并中，请勿重复触发」）；`merged` 卡片合并键 disabled 且 title=「已合并入 main」；`failed` 卡片合并键文案「重试合并入 main」且可用；合并执行中（`state.mergeBusy`）所有卡片合并键禁用（静态断言 renderVersionList 含 mergeBusy 口径）。
- **B3 移动而非复制**：选中版本渲染详情后，全文不出现 `footer.rel-acts`、`#bldAnswerBtn`、`#bldMergeBtn`；详情其余区块（名称/描述编辑、条目增删、合并中提示）不受影响。
- **B4 按钮操作所在卡片版本且不改变选中**：选中版本 A（`selVerId=A`）时对未选中版本 B 调 `openAnswerModal('B')` → 弹窗标题「AI 完善（B）」、提示词内容为 B 的名称/描述；`openMergeConfirm('B')` → 确认框标题对 B；卡片选中态保持 A（B 卡片无 `sel`，A 卡片仍 `sel`）。
- **B5 无参调用兼容**：`openAnswerModal()` / `openMergeConfirm()` 不带参时对应当前选中版本（向后兼容）；带参但版本不存在时不弹窗。
- **B6 i18n 同步**：`scripts/web/i18n.js` EN 含 `'AI 完善'` 词条，旧键 `'提示词与回答回填'` 已移除；`'合并入 main'` / `'重试合并入 main'` 词条保留。
- **S1 静态契约（bindCommon / 数据流）**：bindCommon 按 `view.querySelectorAll('[data-ver-answer]')` / `('[data-ver-merge]')` 循环绑定 `openAnswerModal` / `openMergeConfirm`，不再有 `#bldAnswerBtn` / `#bldMergeBtn` 绑定；`copyPrompt` 以 `state.answer.verId` 定位版本（不再用 selVersion）；`doMerge` 以 `state.mergeConfirm.verId` 定位版本。

## 回归

- `build-ui.test.mjs`（N1~N8）全绿；全量 `npm test` 通过。
