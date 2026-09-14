# 设计 — REQ-20260910-005 支持项目管理

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

看板已是「单服务多项目」形态：`scripts/server.mjs` 维护项目注册表（`~/.agent-team-board/projects.json`，
可用 `ATB_REGISTRY` 覆盖），`?project=<绝对路径>` 指定项目，`resolveProject` 会对首访项目隐式登记，
`/api/init` 可初始化数据目录。缺口：

1. 网页上没有管理入口——初始化只在「当前项目未初始化」空态按钮上，导入只能靠深链隐式登记；
2. 没有「移出」能力，误注册的项目永远留在切换列表里；
3. 移出的最大语义风险是**自动重现**：`resolveProject` 对任何存在的目录请求都会隐式登记，
   轮询/过期深链会把刚移出的项目悄悄注册回来；`defaultProjectRoot` 在注册表清空时还会以启动目录重新播种。

## 方案

### 服务端（scripts/server.mjs）

**注册表 schema v1 追加 `removed` 数组**（不升版本号，旧文件缺省视为空）：

```json
{ "version": 1, "projects": ["/abs/a"], "removed": ["/abs/b"] }
```

`removed` 记录被用户显式移出的真实路径，**只用于两处闸门**，不承载其他语义：

- `resolveProject` 隐式登记前检查：路径在 `removed` 中则跳过登记（数据仍可读——过期深链按现状展示，
  但「不得无提示恢复注册」）；显式入口（导入 / 初始化）不受影响，成功时从 `removed` 清除（重新导入语义）。
- `defaultProjectRoot` 注册表清空时不播种 `cwd` 的条件：播种目标自身在 `removed` 中
  （否则保持现状：空表播种启动目录，兼容单项目首启）。

新增/调整接口（均放在 `resolveProject` 之前，保证空注册表状态下也可用）：

| 接口 | 行为 |
| ---- | ---- |
| `POST /api/project/preview` `{path}` | 校验绝对路径 + 目录存在；返回 `{root(realpath), name, dataDir(向上解析的已有数据目录), wouldWrite(git 根或本目录下的数据目录), initialized}`。供初始化前「展示实际将写入的目标位置」。 |
| `POST /api/project/remove` `{path}` | 校验绝对路径 + realpath 在 `projects` 中；从 `projects` 移除、记入 `removed`、返回 `{ok, removed, projects, defaultProject}`。不触碰磁盘任何文件。 |
| `POST /api/register`（前移） | 新增可选 `requireInitialized:true`：目录无看板数据时报错并提示改用初始化（导入语义）；返回补上 `root`（解析后真实路径，前端据此切换）。显式登记清除 `removed` 标记。 |
| `POST /api/init`（前移） | 改为接受 `body.path` 或 `?project=`；校验绝对路径 + 目录存在后 `core.initData`（已有数据即报错，不覆盖），并显式登记 + 清除 `removed`；返回 `{ok, dataDir, root, projects}`。 |

空态（注册表为空且无可播种默认项目）时 `?project=` 缺省的 `/api/board` 返回
`{noProject:true, initialized:false, dataDir:null, projectRoot:null, items:[]}`；
其余数据接口返回 400「当前没有已注册项目」，指引从「管理项目」入口初始化/导入。

不动活动批次/运行账本/子代理会话（README 待确认项按「不阻止、不终止」处理）。

### 前端（scripts/web/index.html / app.js / style.css）

- 顶栏 `#projectSel` 旁新增「管理项目」按钮，打开 `#projModalWrap` 弹窗（复用 .modal 体系）：
  - 操作区：初始化/导入切换 + 绝对路径输入 + 提交按钮。初始化两步走——提交先 `preview`
    展示「将写入 `<wouldWrite>`」（git 根或已有数据导致的差异明示），再点「确认初始化」才执行；
    preview 发现已有数据则提示改用导入，不执行覆盖。导入直接 `register(requireInitialized)`，
    未初始化目录报错提示改用初始化。
  - 列表区：项目名 + 完整路径（换行不截断）+ 当前标记 + 「切换」「移出」。同名目录靠完整路径区分。
  - 移出走弹窗内确认区：展示项目名、完整路径与「仅从列表移出，目录及需求、Bug 文档保留」；
    取消无变化；确认成功后：移出当前项目→切换到剩余首项，最后一项移出→进入无项目空态。
  - busy 态禁用提交与列表操作；失败就地显示原因、保留输入与列表。
- 无项目空态：`#emptyState` 内拆两张卡（`#initCard` 原初始化卡 / `#noProjectCard` 引导卡），
  `noProject` 载荷时显示后者并引导打开管理弹窗；`clearProjectState()` 清 `state.project`、
  `localStorage['atb.project']`、URL 参数与旧条目画面（关抽屉、清 board 签名）。
- 深链/记忆指向已移出项目：服务端不再隐式登记（见上）；前端按现状展示该深链数据，
  具体提示方式沿用 README「待确认」，不阻塞本期。

### 影响面

- `scripts/server.mjs`：注册表读写、resolveProject/defaultProjectRoot、4 个接口位置与签名。
- `scripts/web/index.html` / `app.js` / `style.css`：顶栏按钮、管理弹窗、无项目空态、Esc 链。
- 兼容性：`multi-project.test.mjs` M3（`POST /api/init?project=`）与 M6（register）签名保持；
  注册表旧文件（无 `removed`）自动兼容。

**开源选型（REQ-20260909-015）**：本需求为纯 Node http / 原生 DOM 内的流程编排，无合适且必要的
第三方库可引入（路径解析、realpath、注册表读写均为标准库能力），自研理由：无合适库。

## 风险与边界

- **移出不删数据**：remove 只改注册表文件；项目目录、需求/Bug 文档、批次账本原样保留（测试断言）。
- **不终止任务**：移出不触碰批次/运行/锁，也不阻止正在进行的实施（README 待确认项的最小闭环）。
- **自动重现防线**：`removed` 闸门只防「隐式」登记；显式导入/初始化（用户意图）允许恢复。
- **多窗口同步**：另一窗口的旧状态轮询已移出项目仍可读数据（不隐式登记）；列表以各窗口下次
  `refreshHealth`/操作后刷新为准（README「多窗口同步」待确认项按此最小口径）。
- **部分完成**：初始化成功但登记失败不可能发生（同接口内先 initData 后登记，登记是本地 JSON 写）；
  initData 抛错（已初始化/权限）时整体 400，不产生半截状态。
