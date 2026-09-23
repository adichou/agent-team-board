# 设计：md-rich mermaid 图表配色随看板深浅色外观自适应

## 背景与问题

BUG-20260923-002 落地了看板文档预览的 mermaid 渲染（vendor 11.17.2 + md-rich.js 懒加载）。当前两处配色来源冲突：

1. `md-rich.js` initialize 按 `prefers-color-scheme` 切 `theme: dark | default`，外观切换已有重渲染监听；
2. 发布文档（README.md / DESIGN.md）图内写死 `%%{init}%%` 指令，强制 base 主题 + 灰字静态配色，指令优先级高于 initialize——深色模式下灰字（#4b5563）落在深色页面上，图表整体偏暗难读。

## 方案

### 1. md-rich.js：initialize 增加 themeVariables（深浅两套）

保留现有结构与懒加载，仅把 initialize 扩展为：

- `theme` 不变：`darkMode() ? 'dark' : 'default'`；
- 新增 `themeVariables`，随 `darkMode()` 取两套之一：

| 变量 | 深色模式 | 浅色模式 |
| --- | --- | --- |
| primaryColor | transparent | transparent |
| clusterBkg | transparent | transparent |
| edgeLabelBackground | transparent | transparent |
| primaryTextColor | `#d1d5db` | `#475569` |
| primaryBorderColor | `#a5b4fc` | `#818cf8` |
| lineColor | `#94a3b8` | `#9ca3af` |
| clusterBorder | `#374151` | `#e2e8f0` |
| titleColor | `#e5e7eb` | `#334155` |

透明底延续「无底色」要求；文字、边框、连线按外观取亮/深两档；靛蓝边框贴近产品品牌色（#4F46E5 系）。

### 2. 发布文档：移除写死的 %%{init}%% 指令

README.md（1 处）、DESIGN.md（4 处）删除全部 `%%{init: ...}}}%%` 行。效果：

- 看板预览：完全随外观自适应（本次改动主体）；
- GitHub 等外部渲染：走 mermaid 默认主题（用户已在方案选择时接受）。

顺序依赖：先落 md-rich（1），再删文档指令（2）；顺序颠倒会让深色预览短暂回到带底色默认主题。

## TDD

新增 `scripts/tests/req-20260923-003.test.mjs`，参照 BUG-20260923-002 的 vm + 假 DOM + mermaid 桩模式：

- 红 1：initialize 未带 themeVariables / 深浅两套取值不符 → 断言失败（stub.calls.init[0]）。
- 红 2：README.md / DESIGN.md 仍含 `%%{init}` → 断言失败。
- 深色分支注入 `sandbox.matchMedia = () => ({ matches: true })` 驱动 darkMode()；浅色分支用现有缺省（无 matchMedia）。

用例清单：

1. themeVariables 深色套：注入 matchMedia matches:true，断言 primaryTextColor=#d1d5db、primaryBorderColor=#a5b4fc、primaryColor=transparent。
2. themeVariables 浅色套：缺省沙箱，断言 primaryTextColor=#475569、primaryBorderColor=#818cf8、primaryColor=transparent。
3. 两套共有项：clusterBkg / edgeLabelBackground 均 transparent。
4. 发布文档无写死配色：README.md、DESIGN.md 不匹配 /%%\{init/。

## 验收

- `node scripts/tests/req-20260923-003.test.mjs` 先红后绿；`npm test` 全量通过。
- 看板深浅两种外观下打开 README / DESIGN 预览：图表文字、连线、边框清晰，无底色。
