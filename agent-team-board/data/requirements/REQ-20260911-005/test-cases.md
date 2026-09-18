# 测试用例 — REQ-20260911-005 支持英文国际化资源

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1 | 语言检测：`navigator.languages` 含任意 `en-*`（如 `['en-US','zh-CN']`）→ en；仅 `zh-*`/其他语言/空 → zh | P0 | ✅ |
| L2 | 持久化与优先级：`localStorage['atb.lang']='en'` 时忽略系统语言用 en；手动切换写入存储；非法值视为未设置按检测初始化 | P0 | ✅ |
| L3 | `t()` 语义：lang=zh 时一律原样返回；lang=en 时精确词典命中返回英文；动态正则命中回填 `$1`；都不命中返回原文（降级） | P0 | ✅ |
| R1 | `translateTree`：文本节点全文命中被译（保留前后空白）；属性 `title`/`placeholder`/`aria-label` 同口径；不命中节点保持原样 | P0 | ✅ |
| R2 | 跳过规则：`SCRIPT`/`STYLE`/`CODE`/`PRE` 内文本与 `data-i18n-skip` 子树不翻译 | P1 | ✅ |
| R3 | 动态文案：`已选 3 项` → `3 selected`；`接受 REQ-20260911-005` → `Accept REQ-20260911-005`（捕获组回填） | P0 | ✅ |
| R3b | 长模板优先：`编辑 REQ-x 标题与描述` 整句翻译，不被 `编辑 ◇` 短模板部分吞译（正向与反向） | P0 | ✅ |
| R4 | 双语往返：en 译出后切回 zh 精确/动态均能还原；已是中文文本原样返回 | P0 | ✅ |
| R4b | DOM 往返：同一节点 en 译出、zh 译回原中文 | P0 | ✅ |
| D1 | 词典完整性：EN 值不含中文；无重复键；EN_DYNAMIC 键都含 ◇ 且可编译为锚定正则；英文模板捕获组引用数 ≤ ◇ 数 | P0 | ✅ |
| D1e | EN 值唯一：反向映射（切回中文）无歧义 | P0 | ✅ |
| D2 | 词典安全：EN 键均含中文；英文译文不为空串 | P1 | ✅ |
| C1 | 覆盖卡点：扫描器实时扫描 `app.js`+`index.html` 提取全部中文片段（文本+属性，884 条），每条命中 EN / EN_DYNAMIC / ALLOWLIST 之一 | P0 | ✅ |
| C2 | 豁免白名单：ALLOWLIST 每条带原因，且与词典无冗余 | P1 | ✅ |
| W1 | 接线：index.html 在 app.js 之前引入 i18n.js；顶栏 #btnLang（快捷键按钮左侧）；`app.js` 零改动（不引用 i18n 机制） | P0 | ✅ |
| W2 | `<html lang>`：初始 zh 场景为 zh-CN；applyLang('en') 后为 en，document.title 同步为英文 | P1 | ✅ |
| V1 | 浏览器实测：系统语言 en 打开 → 可见界面全英文（仅用户数据保持中文）；点按钮往返切换完整还原；2 秒轮询刷新内容跟随当前语言；需求/任务/设置/新建/项目管理/全局面板残留审计为零（用户数据除外） | P1 | ✅ |

自动化映射：L→`i18n-lang.test.mjs`，R→`i18n-runtime.test.mjs`，D→`i18n-dict.test.mjs`，
C→`i18n-coverage.test.mjs`，W→`i18n-wiring.test.mjs`；V1 在 test-report 记录实测过程。
