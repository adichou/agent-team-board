# 测试用例 — REQ-20260920-003 构建和发布流程整改。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现：`scripts/tests/req-20260920-003.test.mjs`（L1 纯逻辑 / L2 数据层 / L3 Git 隔离 /
> L4 服务接口 / L5 前端静态契约，共 22 例）；受影响既有测试同步更新（见 test-report.md）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | 版本号提取：`BLD-20260920-001 → 20260920-001`，前导零保留；非法输入 null | 高 | 通过 |
| L1-2 | 发布文档清单：四类 × 双语共八文件，命名与人工确认一致 | 高 | 通过 |
| L1-3 | README 互链：按语言链接 CHANGELOG 与 FEATURES；其余无链接要求 | 高 | 通过 |
| L1-4 | AI 写作提示词：技术写作角色 + 子代理流程 + 项目路径 / 计划号 / 版本号 / 关联范围 / 八文档 / 写作约束（不编造） | 高 | 通过 |
| L1-5 | 官网提示词：官网仓库执行、读已发布 CHANGELOG/FEATURES、提交消息含完整计划号 | 高 | 通过 |
| L1-6 | 计划号精确匹配：边界标识，`BLD-…-0010` 不冒充 `…-001`；左无边界不命中 | 高 | 通过 |
| L1-7 | 官网时间窗扫描：起点缺失 waiting；窗口内 hit 带证据；早于起点不参与；等于边界参与；相似编号不命中；无命中 missed | 高 | 通过 |
| L1-8 | 扫描预算：未读完窗口 scanning（不当未命中）；读完才 missed | 高 | 通过 |
| L1-9 | 文档状态机：未编写 / 已写未提交 / 已提交 / 外部修改未提交（逐文件原因） | 高 | 通过 |
| L1-10 | 五步门禁：空计划锁合并（提示先关联）；文档未完成锁合并；merged 解锁正式发布 | 高 | 通过 |
| L2-1 | 范围指纹随条目增删 / 换 commit 变化 | 高 | 通过 |
| L2-2 | 文档提交记录；增删条目后 scopeStale + 变化来源，已写内容与提交记录保留；无记录时门禁拒绝 | 高 | 通过 |
| L2-3 | 推送起点：成功持久保存；同基准重试不重置；基准变化重置官网证据 | 高 | 通过 |
| L3-1 | dev 前置：main / detached / 其他分支阻止并提示自行切回；dev 放行 | 高 | 通过 |
| L3-2 | 隔离合并：dev 上 A（未选）先于 B（所选），main 只得 B 的变更（无 A 文件）；重放证据 original→replayed；dev 不动；脏文件保留 | 高 | 通过 |
| L3-3 | 依赖冲突：B 依赖 A（同文件同行）时 cherry-pick 冲突中止，main 不变、现场保留、原因含冲突 | 高 | 通过 |
| L3-4 | 混合提交（同一 commit 关联多条目）被分析阻止并解释 | 高 | 通过 |
| L3-5 | 主分支推送：只推 main（不推 dev）、不强推；master-only 以 master 为目标 | 高 | 通过 |
| L3-6 | 官网主分支读取：main 优先、无 main 回退 master；输出提交者时间 | 高 | 通过 |
| L4 | 服务接口全链路：publish-plan 版本号 / 五步 / 提示词；文档未提交合并 409；文档保存（白名单外 400）；pathspec 提交只含八文档不夹带业务草稿；无变化 noop；外部修改后未提交再拦；隔离合并 main 无 A；非 dev 阻止；推送主分支记录起点且不推 dev；官网未配置 failed 带原因；窗口内未命中 missed、命中 hit（hash/分支/检测时间）+ 常驻提示；PREL from-build 认可重放证据 | 高 | 通过 |
| L5-1 | 前端：顶栏「发布」；五步导航与文档 / 发布页关键入口（AI 写作 / TRAE CN / TRAE / 提交文档到 Git / 官网 AI 写作 / 立即检测） | 高 | 通过 |
| L5-2 | i18n：发布流程新增文案中英文同步 | 高 | 通过 |

回归（受影响既有测试同步更新后全绿）：`npm test` 290 个测试文件 0 失败（含 build-ui /
build-serve / product-release-serve / product-release-git / product-release-pipeline /
product-release-store / bug-release-tab-inplace / bug-build-ver-card-acts /
bug-build-ver-published-chip / bug-commit-hash-display / build-release-card-items-search /
mgt-auto-commit / i18n-dict / i18n-coverage 等）。
