# 测试用例 — BUG-20260922-006 创建版本的版本号和版本计划名称输入框要移到上方，便于输入

用例落盘于 `scripts/tests/bug-20260922-006.test.mjs`（TDD：先跑红后实现跑绿）。
纯 DOM 顺序调整、不改文案，无 i18n 用例（词条零变化）。

## U 前端静态契约（build.js renderPanel）

| 编号 | 用例 | 断言要点 |
| ---- | ---- | -------- |
| U1 | 顺序契约 | 提取 `renderPanel` 函数体：`bldNewName` / `bldNewVersion` 位于 panel body 顶部——在读取错误提示（`p.loadError`）之后、加载态文案「正在读取条目」与全选栏（`bld-pick-bar`）、候选行（`renderCandidateRows(`）之前；两框在函数体内各只渲染一次（无重复） |
| U2 | 守卫与行为不回归 | 两框仍带 `p === state.createPanel ?` 守卫（「添加条目」addPanel 不出现）；`q('#bldNewName')` / `q('#bldNewVersion')` 选择器与 input 监听绑定保留（填写路径不变） |

## 回归

`req-20260922-006.test.mjs`（含 U1 前端契约）、`bug-build-pick-all-render-20260914-002`、
`bug-build-candidates-done-only-20260913-001`、`bug-build-candidate-occupied-20260914-004`
（面板 DOM 级用例）全部通过；全量 `npm test` 332 个测试文件失败 0。
