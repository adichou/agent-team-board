# BUG-20260907-007 状态守卫改写意图检测缺口：node -e 写入与 find -delete 删除 status.json 均放行

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-07T09:00:50.772Z

## 现象

## 现象
hasRewriteIntent 只识别 tee/cp/mv/rm/chmod、非 /dev/null 重定向、sed -i/危险脚本、perl -pi、python -c。以下改删 status.json 的命令全部放行（stdin 喂入实测 exit 0）：
- node -e "require('fs').writeFileSync('<项目>/docs/agent-team-board/requirements/REQ-x/status.json','{}')"
- find <项目>/docs/agent-team-board -name status.json -delete

## 建议
改写意图判定补 node --eval/-e、ruby -e 等脚本解释器形态；补 find 的 -delete/-fprint 等写动作；或对「触碰 status.json 路径」的段采用更保守的默认拒绝（白名单放行只读命令）。

## 影响
与引号拆词绕过（另一单）共同构成守卫假阴性面；status.json 事实源可被绕过改写/删除。

## 复现步骤

1. 向 `state-guard.mjs` bash 模式喂入（stdin）`{"tool_name":"Bash","cwd":"/tmp","tool_input":{"command":"node -e \"require('fs').writeFileSync('<项目>/docs/agent-team-board/requirements/REQ-x/status.json','{}')\""}}` → 实测 exit 0（放行），而该命令实际会覆盖 status.json；应 exit 2。
2. 向 `state-guard.mjs` bash 模式喂入 `{"tool_name":"Bash","cwd":"/tmp","tool_input":{"command":"find <项目>/docs/agent-team-board -name status.json -delete"}}` → 实测 exit 0（放行），shell 真实语义是删除看板全部 status.json；应 exit 2。

## 期望行为

- 脚本解释器内联代码形态计为改写意图：`node -e/--eval/-p`、`ruby -e`、`perl -e`、`osascript -e`、`php -r`、`python -c`（既有）等解释器带内联代码选项时，命令文本不再出现任何写动词也可改写文件；选项扫描到首个非选项操作数（脚本路径）即止，`node atb.mjs …` 类「解释器 + 脚本文件」正常调用不受影响。
- find 的写动作谓词计为改写意图：`-delete`、`-fprint`、`-fprint0`、`-fprintf`、`-fls`（含 `=` 附参形态）；只读谓词（`-name`/`-print` 等）不受影响。
- status.json 目标形态补充 find 按名定位形态：`find <看板> -name status.json -delete` 段中文件名与目录路径分离，原「/ 前缀路径形态」匹配不到目标。
- 只读回归不新增误拦：`node <插件>/scripts/atb.mjs show`、`node --version`、`python3 -m json.tool …/status.json`、只读 `find … -name status.json`、命令文本中「提及」node -e / find -delete 字样均放行。
- 触碰插件源码的同形态命令（如 `node -e "rmSync(<SRC>)"`、`find <插件>/scripts -name '*.mjs' -delete`）在无认领锁时同样拦截（规则 4 自动受益）。

## 关联（引入来源）

- 引入来源：REQ-20260901-003。该条 design.md 将 Bash 改写意图定义为封闭动词枚举（`sed|tee|cp|mv|rm|>|>>`，后经 BUG-20260905-001 修复面确认扩展为 `perl -pi`、`python -c`），test-report.md 亦按该枚举验收——解释器内联代码（node -e 族）与 find 写动作谓词（-delete/-fprint 族）自始不在枚举内，构成假阴性缺口。
