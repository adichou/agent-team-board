# 测试用例 — REQ-20260927-002 版本计划添加条目时自动关联该条目的全部提交

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：scripts/tests/req-20260927-002.test.mjs（U=后端 lib 单元 / S=服务端接口 / F=前端 vm / I=i18n）

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| U1 | autoAssociationIndex：回归样本型——条目 4 个提交主题末尾单号均为本条目 → 全部进自动集（source=attribution），按旧→新排序、主题随带 | P0 | 通过 |
| U2 | autoAssociationIndex：账本核验——账本登记的 hash 进自动集（source=ledger），同 hash 既有归属标注被升级为 ledger；历史缺失的账本 hash 排末尾、主题留空 | P0 | 通过 |
| U3 | autoAssociationIndex：大杂烩提交——主题中段单号只进 broad，仅主题末尾单号（括号外最后一个）自动归属；括号内引用单号不算归属、进 broad | P0 | 通过 |
| U4 | autoAssociationIndex：纯宽口径条目——无账本、无严格归属，主题含单号的命中全在 broad，auto 为空；broad 亦按旧→新 | P1 | 通过 |
| S1 | GET /api/build/candidates：候选条目附 commitMeta（hash/subject/source）与 broadCommits，commits / lastCommittedAt 既有键保留 | P0 | 通过 |
| S2 | POST /api/build/version（及 items add）：commits 数组整组落盘（版本条目行 commits 与自动关联一致）；空数组与非 40 位元素被拒绝（既有文案口径） | P0 | 通过 |
| F1 | 创建面板：勾选条目即整组自动关联——保存 payload items[0].commits 为全部自动口径提交（含 feat 主提交），无逐个提交下拉/删除控件；行内展开只读清单（短 hash + 主题 + 来源徽标） | P0 | 通过 |
| F2 | 自动集为空回退：仅宽口径命中的条目勾选后回退关联最新 1 个提交，徽标「回退·宽口径」，payload commits=[该 hash] | P0 | 通过 |
| F3 | 宽口径折叠行：「另有 N 个宽口径命中未关联」只读提示可展开查看 hash+主题，不可勾选、不计入 M | P1 | 通过 |
| F4 | 计数与全选：操作条「已选 N 项 · M 个提交」实时联动（M 为自动关联提交数之和，回退计入）；全选/全不选仅作用于可勾选条目，自动集与宽口径皆空的行禁用并提示暂无关联提交 | P1 | 通过 |
| F5 | 两面板一致：添加条目面板与创建面板同口径（payload 整组 commits、取消勾选整组移除） | P1 | 通过 |
| I1 | i18n：新增文案（关联提交区块头 / 宽口径折叠行 / 三枚来源徽标 / 计数句）EN 与 EN_DYNAMIC 词条同步，动态键可编译 | P1 | 通过 |

> 备注：F4 中「取消勾选整组移除」由 pickAll 全不选路径覆盖（F5 断言 payload 整组与计数归零）；
> 全部用例先行跑红（实现前 11/12 失败，S2 为既有后端口径回归护栏）后实现跑绿；
> `npm test` 全量 361 个测试文件通过（含契约迁移后的 bug-build-pick-all-render-20260914-002）。
