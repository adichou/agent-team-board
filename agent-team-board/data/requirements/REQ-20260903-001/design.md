# 设计 — REQ-20260903-001 取消对齐这个流程，要求在需求中要讲清楚 UI 和交互设计（如果涉及的话）

> 由 Agent 在 /dev 阶段一补充，人可随时批注。**状态：待对齐（方案初稿，未经人工确认不得实施）。**
> README 描述为空；标题即两项指令：① 取消「对齐」流程；② 需求必须讲清 UI/交互设计（如涉及）。

## 背景

对齐闸门（REQ-20260831-001）实践中摩擦大于收益：每条目多一次人工往返，且本会话多轮修订（REQ-20260901-001 四改）说明「方案写了也会改」，对齐的把关价值有限。改为**把设计质量前置到需求阶段**：登记需求时写清楚 UI/交互设计（涉及 UI 时），接受即视为设计认可，Agent 认领后直接实施。

## 方案（初稿，待对齐）

### 1. 状态机回退（`core.mjs`）

- `TRANSITIONS.accepted` 恢复为 `['in-progress']`；`pending-alignment` 保留定义但**移出主流程**（不再有进入边；历史含该状态的旧条目不受影响，仍可 pending-alignment → in-progress 人工确认放行——存量兼容）。
- `claim` 恢复 accepted → in-progress 直达（owner+锁）；对 pending-alignment 存量条目 claim 视为续认（异 owner 冲突、同 owner 幂等）。
- `HUMAN_ONLY_TO` 回退为 `accepted / done`（in-progress 不再人工专属；钩子拦截清单同步移除 in-progress）。

### 2. 守卫（`state-guard.mjs`）

bash 拦截清单从 accepted/in-progress/done 收回为 accepted/done；server 的 `boardTransitionAllowed` 恢复 accepted→in-progress 为网页允许边（或网页不提供该按钮、仅 Agent claim——**取后者**：恢复到 REQ-20260831-001 之前的分工，认领是 Agent 动作）。

### 3. /dev 单阶段化（`commands/dev.md` + SKILL.md）

- 删除阶段一/二划分与 `implement` 参数；恢复：读文档 → `claim --by <会话名>` → TDD 实施 → report → 请确认。方案仍写 design.md（作为实施记录，非闸门）。
- loop 恢复「认领→实施→report→下一个，直到没有 accepted；失败跳过」；批量对齐条款删除。
- SKILL.md：状态机图、铁律 2/3/5、CLI、TDD 流程、调度规则全部回退到单阶段语义；**保留**会话名约定（REQ-20260901-005）与源码保护铁律（REQ-20260901-003）。

### 4. Status Board 前端

- 移除「待对齐」列与「▶ 对齐」按钮（前端 STATES 回四列）；存量待对齐条目由迁移处理（见 6）。
- 抽屉 accepted 状态提示改回「等待 Agent 认领」。

### 5. 需求模板加 UI/交互设计要求（指令②）

- `commands/req.md`：登记时若涉及 UI，必须在描述中写清**界面布局、交互行为、状态与反馈**（至少一句话级别；复杂交互列点）；SKILL.md 数据规范同步「README 描述需含 UI/交互设计（如涉及）」；验收标准模板加一条占位。
- 已在途条目不回溯。

### 6. 存量迁移（唯一需要写数据的点）

当前 1 条 pending-alignment（BUG-20260902-001，方案已写好）：迁移方式=**人工**在看板把它确认到 in-progress（对齐确认按钮保留至本次实施时移除，正好用作最后一次人工放行）——零脚本迁移，符合铁律。

### 7. 测试

- `pending-alignment.test.mjs` 改造：P1/P2/P3/P4/P5 按回退后语义改写（accepted→in-progress 恢复、钩子不再拦 in-progress、claim 直达）；存量兼容断言保留。
- `loop-mode.test.mjs`：移除批量对齐断言，恢复「认领→实施→report→下一个」断言。
- 全量回归（前端五列回四列，layout T6 恢复 minmax(220px,1fr) 四列契约）。

## 影响面

`core.mjs`、`state-guard.mjs`、`server.mjs`、`web/app.js`+`style.css`、`commands/dev.md`、`commands/req.md`、`SKILL.md`、`pending-alignment.test.mjs`、`loop-mode.test.mjs`、`layout.test.mjs`。**本需求会实质回退 REQ-20260831-001 的交付**（其状态保持 in-progress，历史可溯，不删数据）。

## 风险与边界

- 回退后「方案未对齐就实施」的风险改由需求质量承担——依赖指令②的 UI/交互设计前置，非 UI 需求则依赖 README 描述完整度。
- 存量待对齐条目需人工放行一次（迁移设计 6）。
- 若日后想恢复对齐闸门，REQ-20260831-001 的历史与测试改造记录可溯。

## 待对齐确认点

1. `pending-alignment` 状态定义保留（仅移出主流程，存量可放行）还是彻底删除？（推荐前者）
2. 网页端是否保留「接受」按钮？（推荐保留——接受仍是人工动作）
3. 指令②的 UI/交互设计要求落在 req.md + SKILL.md（本方案），还是也要加进 README 模板生成器（core.createItem 的模板文本）？
