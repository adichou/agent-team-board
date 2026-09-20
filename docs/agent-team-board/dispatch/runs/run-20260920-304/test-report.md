# BUG-20260920-001 测试报告

- runId：run-20260920-304（owner: zcode-batch-053-2）
- 日期：2026-09-20

## 修复内容

- 根因：`scripts/web/app.js` 的 `renderSettingsView()` 在 `/api/dispatch/settings` 读取失败时整页替换设置视图并提前返回；旧布局项目（无 `agent-team-board/` 数据目录）该接口在服务端必然失败（`/api/dispatch/*` 于 dataDir 缺失时报「未找到 agent-team-board，请先初始化」），并行发起且可成功的 `/api/layout/state` 结果被丢弃，「一键迁移到新布局」入口随整页错误消失。
- 修复（纯前端，服务端不动）：
  - 派发设置读取抽为 `loadDispatchSettings()`，失败只记录 `state.codex.settingsError`，不再中断整页渲染。
  - 设置页新增独立「派发设置」分区就近显示原因 + 重试（`#csRetry` 只重读该设置并重绘）。
  - 各分区（官网仓库 / 批量任务 / Git 工作流 / 数据布局迁移）失败反馈互相独立，迁移入口保留可用。
- 引入来源归因（经 `atb list` 核验）：REQ-20260909-001（整页失败早退模式）× REQ-20260916-007（迁移入口并入该视图），详见条目 design.md。

## 测试执行

新增 `scripts/tests/bug-20260920-001.test.mjs`（TDD：实现前 5/6 用例跑红，实现后全绿）：

- T1 旧布局 + 派发设置失败：不再整页替换；「数据布局迁移」卡片与「一键迁移到新布局」按钮保留可用；失败原因局部显示并可重试
- T2 布局检测失败：显示「布局检测失败」+ 重试，不误显示「无可迁移数据」；与派发设置失败互相独立
- T3 派发设置失败重试：成功后局部错误消失，迁移卡片照常
- T4 迁移链路（失败配置下）：取消不发起 `/api/migrate`；确认仅带当前项目路径、执行中按钮禁用；成功转「已是新布局」并刷新看板
- T5 迁移失败：就近显示具体错误并可重试，不误报成功
- T6 i18n：新增「派发设置」「派发设置加载失败：◇」中英词条同步（◇ 动态键不入静态词典）

存量契约同步：`scripts/tests/settings-runparams-removed-20260909-011.test.mjs` T3/T4 由「整页设置加载失败」更新为「局部失败 + 重试、整页不再替换」口径，全绿。

## 命令输出

```
$ node scripts/tests/bug-20260920-001.test.mjs
✓ T1 旧布局项目派发设置失败：不再整页替换设置视图，「数据布局迁移」卡片与「一键迁移到新布局」按钮保留可用，失败原因局部显示并可重试
✓ T2 布局检测失败：显示「布局检测失败」与重试，不误显示「无可迁移数据」；与派发设置失败同时可见（互相独立）
✓ T3 派发设置失败后点重试：重新读取成功则局部错误消失，迁移卡片照常渲染
✓ T4 迁移确认取消不发起 /api/migrate；确认后仅带当前项目路径、执行中按钮禁用；成功后转「已是新布局」并刷新看板
✓ T5 迁移失败：就近显示具体错误并可重试，不误显示「已是新布局」/成功态
✓ T6 新增界面文案中英同步：「派发设置」「派发设置加载失败：◇」均有英文词条（静态/动态各归其位）

全部通过

$ node scripts/tests/settings-runparams-removed-20260909-011.test.mjs
✓ T1–T5 全部通过（T3/T4 口径更新）

$ npm test
共 287 个测试文件，失败 0
```

## 改动清单

- `scripts/web/app.js`：renderSettingsView 分区化错误反馈；新增 loadDispatchSettings / dispatchSettingsAreaHtml / #csRetry 绑定
- `scripts/web/i18n.js`：+「派发设置」静态词条；「设置加载失败：◇」替换为「派发设置加载失败：◇」（中英同步）
- `scripts/tests/bug-20260920-001.test.mjs`：新增（6 用例）
- `scripts/tests/settings-runparams-removed-20260909-011.test.mjs`：T3/T4 契约同步
- 条目文档：README.md 引入来源行、design.md 归因/根因/方案/风险补全

## 边界说明

- 服务端 `/api/dispatch/*` 未初始化仍拒绝（派发能力本就要求已初始化看板）；`/api/layout/state`、`/api/migrate` 口径不变（无需已初始化）。
- 未执行真实项目迁移（遵循条目 README：不在用户唯一数据副本上验证）；迁移能力本体由 layout-migration-20260916-007 覆盖。
