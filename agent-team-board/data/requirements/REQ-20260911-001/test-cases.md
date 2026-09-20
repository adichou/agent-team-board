# 测试用例 — REQ-20260911-001 修改需求的对话框改为使用侧拉框，参考新建条目界面

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/edit-side-panel-20260911-001.test.mjs`（静态契约 + vm 沙箱行为断言，
> 模式对齐 edit-content.test.mjs；窄屏布局 / 深浅色 / 连续点击按验收标准人工核对）。
> 既有迁移：edit-content.test.mjs 与 rename-reject.test.mjs 的 U2/U3（居中弹窗契约）随本项改为侧拉面板口径；
> shortcuts-20260910-007 / new-shot-preview-20260910-017 沙箱把 `#editModalWrap` 纳入初始隐藏清单。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| E1 | 面板结构：index.html 常驻 `#editModalWrap`（`.side-panel hidden role="dialog"`，无全屏遮罩节点）；头部常驻（动态标题「编辑 <编号>」`#editItemTitle`、说明 `#editScope`、✕ `#editClose` 带 aria-label 与 title）；内容区三态：`#editLoading` 加载提示 / `#editError`（`#editErrorText` + `#editRetry` 重试 + `#editErrorClose` 关闭）/ `#editForm`，表单顺序为标题（maxlength=120）→ 描述 textarea → 反馈 `#editMsg`（role=status aria-live）→ 取消/保存 `.modal-foot` | P0 | 通过 |
| E2 | 旧居中弹窗下线：app.js 不再含 `uiEditForm` / `promptActive`（居中编辑弹窗 + 同屏互斥旧机制整体移除）；编辑改由 `editItem` 驱动 `#editModalWrap`；卡片与详情入口仍为 `data-rename-id` 且 `stopPropagation`（点卡片编辑不误开详情） | P0 | 通过 |
| E3 | 开合与焦点：打开移除 hidden；重复点击同一条目幂等（不叠加面板、不重置已填内容）；读取完成预填标题与描述并聚焦标题；关闭（✕ / 取消 / Esc）恢复 hidden 且焦点返回入口按钮（入口被重渲染移除时按 `data-rename-id` 回落找回）；从详情打开时关闭编辑仍保留详情 | P0 | 通过 |
| E4 | Esc 链与快捷键让位：编辑面板纳入 `anyModalOpen`；Escape 链中编辑面板层位于详情抽屉之前（一次只关一层，详情保留）；保存中 Esc 不关闭编辑层、也不关其他层 | P0 | 通过 |
| E5 | 读取态：打开即显示「正在读取描述…」并禁用表单与保存（保留关闭入口）；读取失败或 README 缺「## 描述 / ## 现象」节 → 错误态显示原因 + 重试/关闭，不出现可提交的伪空表单；重试成功进入表单 | P0 | 通过 |
| E6 | 项目与条目绑定：读取和保存请求携带打开时快照的 `editSide.project` / `editSide.id`；面板关闭或改开后旧请求序号失效，迟到响应不写入新面板（无跨条目污染） | P0 | 通过 |
| E7 | 预填与校验：标题与描述预填当前已保存内容；标题 Enter 发起保存、描述 Enter 换行；空白标题在面板反馈区提示「标题不能为空」且不发写请求；无变化提示「标题与描述均无变化」且不发写请求、面板保持 | P0 | 通过 |
| E8 | 保存中锁定与失败恢复：保存期间禁用标题/描述/取消/✕/保存（按钮「保存中…」）；保存失败解锁恢复可编辑、反馈区显示错误且草稿保留可重试 | P0 | 通过 |
| E9 | 成功路径：toast「✓ <编号> 标题与描述已更新」+ `poll()` 刷新看板 + 详情打开该条目时 `refreshDrawer()`；面板关闭、焦点返回入口；`uiConfirm` 居中确认弹窗（删除等）不受影响 | P0 | 通过 |
| E10 | 样式形态：面板几何复用 `.side-panel`（右缘通高 / 头部常驻 / 内容区独立滚动 / ≤640px 全宽）；新增样式仅反馈与错误文案，颜色走 CSS 变量；不新增居中编辑弹窗样式 | P1 | 通过 |
| E11 | 遮罩形态取消：编辑面板不挂「点击面板外关闭」监听（点击主界面不关闭），仅 ✕ / 取消 / Esc 关闭 | P1 | 通过 |
| E12 | 既有契约迁移与 Bug 不回归：edit-content / rename-reject 的 U2/U3 改侧拉面板口径后全绿；shortcuts / new-shot-preview 沙箱初始隐藏 `#editModalWrap`；Bug 编辑仍写「## 现象」节、非 submitted 不开面板不发写请求 | P0 | 通过 |
