# 测试用例 — REQ-20260913-004 支持版本删除

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B9a | 数据层：draft 版本 deleteVersion 成功——整目录 `builds/versions/<id>/` 移除，listVersions 不再返回，其余版本不受影响 | P0 | 通过 |
| B9b | 数据层：删除不存在的版本报「找不到版本计划：<id>」（AtbError） | P0 | 通过 |
| B9c | 数据层：merging 状态删除抛 BuildConflictError（错误文案含「合并中不可删除」），目录不动；merged / failed 状态均可删除 | P0 | 通过 |
| S11a | serve：POST /api/build/version/delete 删除 draft 成功 200 {ok,id}，落盘目录移除、state 列表不再返回；merged 版本同样可删 | P0 | 通过 |
| S11b | serve：删除不存在版本 400「找不到版本计划」；merging 版本 409（conflict:true，文案含「合并中」）且目录保留，恢复为 failed 后可删 | P0 | 通过 |
| N9a | UI：每张版本卡片操作区在「AI 完善 / 合并入 main」后渲染第三个「删除」键（quiet 弱化、data-ver-delete、aria-label）；merging 卡片禁用 title「合并中，不可删除」；mergeBusy 全局禁用口径含删除键 | P0 | 通过 |
| N9b | UI：确认弹窗沿用 rel-modal——标题「删除版本（<id>）」，正文列名称 / 状态 / 关联单数；draft/failed 提示删除后不可恢复、条目可重新纳入其他版本；merged 额外提示仅移除看板记录不影响已合并提交；取消关闭无改动 | P0 | 通过 |
| N9c | UI：确认删除执行期间按钮禁用防重复；成功 toast「✓ 已删除版本（<id>）」并刷新列表（选中失效回落最新 / 空态）；失败 toast「✕ 删除失败：<原因>」弹窗关闭、版本保留可重试 | P0 | 通过 |
| N9d | i18n：删除相关新文案入 EN / EN_DYNAMIC 词典（值无中文、无重复） | P1 | 通过 |

