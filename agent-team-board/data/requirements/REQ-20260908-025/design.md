# 设计 — REQ-20260908-025 完善文档指纹算法版本化，避免基线口径不一致导致误报

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

见 README「现状」节：`docsFingerprint` 返回裸 40 位 sha1，四处冻结点（创建 L458 / 吸收 L656 /
重排队 L675 / 领取 L735）落盘裸哈希，三处比对点（`finishRefineRun` done 核验、server precheck、
server settle）用「当前代码算法重算 === 裸基线」直比。冻结方（CLI / server 短进程）与比对方
（server 常驻进程）算法版本漂移时（如 REQ-20260908-021 给 DOC_FILES 增加第四个文件），
旧基线对新算法重算必然不等——「人工编辑」判定失真，产生 RFB-20260908-010/011 共 4 条
「冻结后文档已被人工编辑，基线失效」误报 skipped。

## 方案

### 1. 版本形态：字符串前缀 `v<N>:<40hex>`（定案）

基线继续落在 `batch.candidates[].baseline` 的既有字符串位，**不改账本 schema**：
`docsFingerprint(dir)` 返回 `v2:<sha1-hex>` 形态。选前缀而非结构化字段，理由：
账本零迁移（JSON 字符串位不变）、正则可判、人眼可读，且与「裸哈希兼容识别」（见第 3 点）
天然共用一套前缀判别。

### 2. 版本注册表 + 按版本重算（refine-store.mjs）

- 新增 `FINGERPRINT_VERSIONS` 注册表（唯一事实源）：
  - `v1`：三文档口径 `['README.md','design.md','test-cases.md']`（REQ-20260908-021 之前的历史口径）；
  - `v2`：四文件口径（含 `ui-demo.html`，REQ-20260908-021 起，即本次版本化时的当前口径）。
- `FINGERPRINT_VERSION = 2`（当前口径常量）；`DOC_FILES` 常量删除，由注册表派生（单一事实源）。
- `docsFingerprintAt(dir, version)`：按注册表内指定版本的文件集与哈希构造（构造本身不变：
  sha1 over `name \u0000 content \u0001` 序列，缺失记 `<missing>`）重算，返回裸 hex；未登记版本抛错。
- `docsFingerprint(dir)` = `v{FINGERPRINT_VERSION}:{docsFingerprintAt(dir, FINGERPRINT_VERSION)}`。
  四处冻结点全部经 `docsFingerprint` 落盘，**不改调用代码即自动携带版本**。
- 新增唯一比对助手 `docsUnchangedSince(dir, baseline)`，三处比对点统一改用：
  1. `finishRefineRun`（zcode done 核验）：`docsFingerprint(dir) === (cand ? cand.baseline : docsFingerprint(dir))`
     → `cand ? docsUnchangedSince(dir, cand.baseline) : true`（cand 缺失仍按「一致」拒绝，语义不变）；
  2. server.mjs precheck：`refine.docsFingerprint(dir) !== cand.baseline`
     → `!refine.docsUnchangedSince(dir, cand.baseline)`；
  3. server.mjs settle：`changed = cand ? refine.docsFingerprint(dir) !== cand.baseline : false`
     → `changed = cand ? !refine.docsUnchangedSince(dir, cand.baseline) : false`。

### 3. 存量裸哈希兼容/迁移规则（确定性，双通道）

`docsUnchangedSince` 对基线形态分派：

- **带版本前缀 `v<N>:<hex>`** → 按该版本口径重算比对（算法演进后旧版本基线仍可比对）。
- **裸 40 位 sha1（本次上线前冻结的存量基线）** → 裸哈希无版本标识，无法区分冻结时是 v1/v2
  口径：按注册表**全部已知口径逐一重算、任一匹配即视为未编辑**（「冻结后人工未编辑」的
  判定只放宽不收紧；真编辑的文档在任一已知口径下都不可能再等于旧哈希，sha1 碰撞忽略）。
- **带版本前缀但版本未登记**（代码回退到旧版本读到新基线的异常场景）→ 视为已变更：
  宁可出局/拒绝记完成，也不在无法重算的口径下静默通过「文档确有变更」核验；由
  `atb serve` 版本检测自动重启机制把代码拉回最新后自愈。
- **其他非法形态**（null/undefined/非哈希串）→ 视为已变更（与旧逻辑「重算≠基线」方向一致）。

迁移通道（不需任何回填脚本）：
- 比对侧：上述裸哈希兼容规则，保证发布瞬间存量未结束批次 / 在途运行不新增误报出局；
- 冻结侧：BUG-20260908-011 的领取时重冻结（`nextRefineItem` L735）与 BUG-20260908-010 的
  重排队重冻结（L675）本就以当前 `docsFingerprint` 落盘——条目下次领取时裸基线**就地升级**
  为 `v2:` 形态，兼容窗口自然收敛。
- 已结束（finished）批次不回溯迁移（无比对需求，边界与非目标）。

### 4. 算法演进纪律（成文落点：refine-store.mjs 注册表注释，本节为书面策略）

- **版本常量**：`FINGERPRINT_VERSIONS`（口径演进史）+ `FINGERPRINT_VERSION`（当前口径），
  位于 refine-store.mjs，与实现同处、即改即生效。
- **升级登记要求**：调整参与指纹的文件集（DOC_FILES 演进）或哈希构造时，必须
  (1) 在注册表**追加**新版本条目（不得修改/删除既有条目）；(2) 同步 bump `FINGERPRINT_VERSION`；
  (3) 保留全部历史版本的重算能力（注册表条目即重算依据）；(4) 在对应条目 design.md 登记演进原因。
- **旧版本重算实现的废弃时机**：仅当确认不再有任何未结束批次或在途运行可能携带该版本基线
  （含裸哈希——裸哈希兼容依赖全部历史口径）时方可删条目；实践口径：**至少保留最近两个版本**，
  且删除历史口径条目属于破坏存量基线可比性的变更，需人工确认。
- 不落 SKILL.md：该文件面向看板使用方（命令与流程），算法内部演进纪律与实现强绑定，
  落 refine-store.mjs 注释（单一事实源）；本 design.md 留书面策略副本。

### 5. 人工编辑检测语义不变（回归口径）

版本化只消除「算法不同」假阳性：同版本口径下领取后文档确实被改动的，codex precheck 仍以
「冻结后文档已被人工编辑，基线失效」出局；zcode 领取后未改文档的 done 仍按
「文档内容与冻结基线一致：未检测到补全变更，不能记完成」拒绝（文案均不变）。

## 测试

- 新增 `scripts/tests/refine-fingerprint-version.test.mjs`（F1~F5）：利用注册表内**真实的
  v1/v2 两口径**模拟「旧口径冻结 → 算法升级（当前 v2）→ 比对」事故序列——不引入测试专用的
  动态版本注册钩子（保持注册表封闭、追加式）。
- 既有断言形态兼容：refine-store S9/S12、refine-claim-baseline B1~B6、refine-reaccept 等
  断言「baseline === docsFingerprint()」与指纹变更方向，与版本前缀形态无关，预期不改即绿；
  refine-serve / refine-cli / refine-ui / tasks-refine 不直接断言指纹，回归通过即可。

## 风险与边界

- codex 后台逐项执行（server.mjs `createRefineRunner` 的 precheck/settle）自 REQ-20260908-020
  起已无路由入口（`refineRunnerFor` 未被调用），但仍按验收标准同步改为版本化比对，
  未来若恢复接线即为正确口径。
- 常驻 server 进程代码陈旧（不认识新版本前缀）导致的口径漂移，由既有 `atb serve` 版本检测
  自动重启兜底（README 边界：不做热重载）。
- 裸哈希「任一口径匹配」理论上的误放行仅限 sha1 碰撞，忽略；判定只对「未编辑」方向放宽。

## 实施记录（2026-09-09，zcode-batch-018-1）

- `scripts/lib/refine-store.mjs`：新增 `FINGERPRINT_VERSIONS`（v1 三文档 / v2 四文件）与
  `FINGERPRINT_VERSION=2` 注册表（删除原 `DOC_FILES` 常量，单一事实源，升级纪律见注释）；
  `docsFingerprint` 改返回 `v2:<40hex>`；新增 `docsFingerprintAt(dir, version)`（按版本口径
  重算裸哈希）与 `docsUnchangedSince(dir, baseline)`（统一比对助手，含存量裸哈希兼容与
  未登记版本保守判定）；`finishRefineRun` done 核验改走 `docsUnchangedSince`。
  四处冻结点（创建/吸收/重排队/领取）均经 `docsFingerprint` 落盘，不改调用代码即携带版本；
  领取/重排队重冻结（BUG-20260908-011/010 既有机制）使存量裸基线下次领取就地升级。
- `scripts/server.mjs`：codex precheck（L882 附近）与 settle（L960 附近）两处比对改走
  `refine.docsUnchangedSince`，出局/changed 方向与文案不变。
- 新增 `scripts/tests/refine-fingerprint-version.test.mjs`（F1~F6，先红后绿）；既有
  refine-store / refine-claim-baseline / refine-reaccept / refine-serve / refine-cli / refine-ui /
  tasks-refine 回归不改即绿；全量 `npm test` 96 个测试文件 0 失败。
- 新问题登记：无（实施过程中未发现新缺陷）。

