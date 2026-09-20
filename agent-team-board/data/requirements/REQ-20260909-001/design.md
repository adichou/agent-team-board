# 设计 — REQ-20260909-001 任务设置中仅保留对Agent隐藏的配置，其他的全删掉

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

设置模块「批量任务」分区自 REQ-20260908-020 起为四列表格（执行 Agent / 子代理模型 / 推理强度 / 是否隐藏）。本需求将界面收敛为仅剩「任务类别 × Agent」的隐藏开关，删除子代理模型输入、推理强度选择与默认智能档建议，降低启动任务前的配置负担。

## 方案

**仅删 UI 与文案，不动底层链路**（前端 `scripts/web/app.js`）：

1. `taskSettingsHtml`：四列表格收敛为两列（执行 Agent / 是否隐藏），每组固定 Codex、Zcode 两行；正文精简为一句「隐藏后，该 Agent 不出现在对应任务的启动选项中。」；删除 tsModel/tsLevel 控件、相关表头与默认智能档建议文案。保留 BUG-20260909-002 的复选框 aria-label 契约（无尾随可见文字）与 REQ-20260908-026 的全部隐藏合法持久态。
2. 状态反馈（README「状态反馈」节）：新增 `#tsStatus` 就近状态位（已加载设置 → 有未保存的更改 → 保存中…/已保存/保存失败草稿已保留）；`ensureTaskSettings` 记录 `state.tasks.loading/error`；`renderSettingsView` 改两阶段渲染——阶段一「正在加载任务设置」骨架（不渲染编辑与保存控件，运行参数一并禁用），阶段二按结果渲染隐藏开关或「任务设置加载失败 + 重试」（`#tsRetry`）。类别全部隐藏时显示「无可用 Agent」提示（`#tsEmpty-<kind>`，随保存值与草稿联动），与加载失败文案区分。
3. 保存（`bindSettingsView`）：POST `/api/tasks/settings` 请求体仅 `{ agents }`。服务端 `saveTaskSettings` 为局部合并（patch 缺 `models` 键即沿用现值），故既有模型/档位不清空、不重置。
4. 样式 `style.css`：删除 ts-table 内文本输入的宽度规则，补 `.ts-empty` 间距；两列表格天然满足窄屏无横向滚动。

**不改**：`scripts/lib/task-settings.mjs`（存储结构、默认值、校验）、`scripts/server.mjs` 的设置读写接口、启动区全隐藏禁用与提示、历史任务/批次/讨论记录。

## 待确认事项核实记录（README「范围及待确认事项」，开发前核实）

原始需求未明确「是否进一步移除底层模型/档位存储字段、派发提示词参数并改用执行端默认值」。核实结果：

- **存储**：`<dataDir>/tasks/settings.json` 的 `models`（任务类别 × Agent 的 model/level）由 `loadTaskSettings/saveTaskSettings` 读写，局部合并语义下省略 `models` 键即保留现值（本单数据层测试 T3 固定该行为）。
- **消费方**：`scripts/server.mjs` 在 `/api/batch/create`（读 `ts.models.develop[agent]`）与 `/api/refine/create`（读 `ts.models.refine[mode]`）创建批次时把 model/level 注入派发提示词；批次创建后即为快照，改设置不影响运行中任务。
- **结论**：本单只删 UI 与文案、保存仅提交 agents；底层存储与派发参数链路原样保留（契约测试 T9 固定）。若后续确认改为「完全使用执行端默认值」，需另立需求处理存储迁移与派发参数移除，不在本单臆断实施。

## 风险与边界

- 旧 UI 保存会把四列表格值整体提交（含 models）；新 UI 只提交 agents，历史保存的模型/档位仍在存储与派发中生效——界面删除不等于配置删除，已在 README 待确认节如实标注。
- 两阶段渲染期间运行参数控件短暂禁用（加载完成即恢复），避免未加载完成用默认值覆盖配置；`/api/dispatch/settings` 失败仍走整页错误 + 重试（原行为）。
- Codex 存量面板（任务模块深链）的模型块/预检属 BUG-20260909-002 保留范围，本单不触碰。
- 测试影响：`tasks-panel-26.test.mjs` K10、`refine-ui.test.mjs` R12-7 由四列旧契约更新为两列新契约；`settings-simplify-20260909-002.test.mjs` T1/T6 兼容契约保持通过。
