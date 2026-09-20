# 设计 — BUG-20260909-019 左上角有元素遮挡，请修复

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- **引入来源：BUG-20260905-003**（`atb list` 核验存在，in-progress）——该单引入 insertCSS 让位机制本身。
  失效的确切环节在机制引入时即存在（见根因分析），并非后续布局改动造成；REQ-20260907-004 把品牌区
  （logo + 标题 + 路径）移到顶栏最左，使该潜在缺陷以「交通灯压 logo」的形态显性化。

## 根因分析

**失效环节：insertCSS 注入的让位规则在层叠中败给了页面自己的同特异性规则，注入从未真正生效。**

- 注入侧：`electron/shell-css.mjs` 的 `.topbar { padding-left: 78px; }` 经 `webContents.insertCSS`
  以默认 `cssOrigin: 'author'` 注入（`electron/main.mjs` `did-finish-load` 回调）。
- 页面侧：`scripts/web/index.html` 头部 `<link rel="stylesheet" href="/style.css">`，其中
  `.topbar { padding: 10px 18px }`（≤640px 时 `@media` 覆盖为 `8px 12px`）同为 author origin、
  同 specificity（0,0,1,0），且同样设置 `padding-left`。
- 同 origin 同 specificity 时按**样式表顺序**决胜。Chromium/Electron 对 insertCSS 注入表的排位
  并不保证在页面 `<link>` 之后：官方文档仅说明 `cssOrigin` 设定层叠 origin、默认 `'author'`
  （electronjs.org/docs/latest/api/web-contents）；社区与标准侧有多份记录表明注入的 author
  表在同特异性竞争下会输给页面样式（W3C webextensions #906、Chromium #41350947、
  electron#22055：`'user'` origin 注入表「位于 UA 样式表与页面样式之间」）。实测证据即本单
  截图：页面呈现与「无注入」完全一致（padding-left 18px 生效），注入规则被 `padding: 10px 18px`
  压制。
- 排除其他候选环节：
  - 时序不是根因——`did-finish-load` 每次加载（含 Cmd-R 重载）都会重新注入，监听器挂在
    webContents 上跨重载存活；
  - promise 被吞（`.catch(() => {})`）只是掩盖了潜在报错、加大排查难度，不是层叠失败的原因
    （注入成功也会输掉层叠）；本次一并改为打印错误，不再静默。
  - 深浅色外观、宽度分支不影响层叠胜负，只影响被波及元素。
- V4 契约测试为何没拦住：它只静态断言「源码文本存在 78px / main.mjs 调 insertCSS」，
  不验证层叠结果——「源码在、效果无」正是该盲区的表现（README 核实依据末条已预判）。

## 方案

**让位声明加 `!important`，以层叠规范保证取胜，不依赖注入表顺序；取值 78px 不变。**

1. `electron/shell-css.mjs`：`.topbar { padding-left: 78px !important; }`
   - 依据 CSS 层叠规范：author important 恒胜 author normal（与样式表顺序无关），可覆盖
     基础规则与 ≤640px 竖屏 `@media` 分支的 `padding` 简写（仅 `padding-left` 一项被覆盖，
     其余方向内边距、换行、路径隐藏等竖屏行为不变）。规则不包 `@media`，全宽度生效。
   - 这是注入式覆盖（扩展/壳层改写宿主页样式）的通行官方做法；浏览器直连不加载该规则，
     `scripts/web/style.css` 零改动。
2. `electron/main.mjs`：注入失败由静默吞错改为 `console.error` 输出，消除「注入失败不可见」
   的排查盲区；注入时机（`did-finish-load`，含重载）与调用方式不变。
3. 测试同步（`scripts/tests/electron-shell.test.mjs` V4）：
   - 让位声明必须带 `!important`（防止回退为同特异性裸竞争）；
   - 让位规则不得包进 `@media`（保证竖屏分支同样让位）；
   - 既有断言保留：注入值 ≥70px、web 业务样式不含 78px、`.topbar` 基础内边距保持 `10px 18px`。

**已评估并放弃的替代方案**：

- `cssOrigin: 'user'`：CSS 层叠中 normal user 位于 normal author 之下（user important 才在其上），
  不带 `!important` 仍会输给页面 normal 规则；带 `!important` 则与 author important 等效但覆盖面
  更大，无收益。
- 提高选择器特异性（如 `body .topbar`）：今日可赢但仍依赖「页面不再出现更高特异性/important 的
  padding 规则」，语义不如 `!important` 明确。
- `executeJavaScript` 往 `document.head` 末尾追加 `<style>`：靠元素顺序取胜，可行但引入转义与
  时序复杂度，且偏离既有 insertCSS 契约。
- `trafficLightPosition` 显式定位：只移动交通灯自身位置，不产生内容让位，页面仍需左内边距配合。
- 放大 padding 数值（如 100px+）：README 明确禁止——掩盖根因且 18px 生效时数值再大也一样遮挡。

## 风险与边界

- **竖屏（≤640px）**：78px 让位在窄窗口同样生效（期望行为）；`flex-wrap` 换行与右对齐不受影响，
  顶栏整体内容可用宽度减少 66px（18→78），极窄时操作区换行增多——属让位的必然代价，非回退。
- **覆盖面**：`!important` 使壳层让位优先于页面任何 normal 的 `.topbar` padding 规则；若未来页面
  主动想覆盖壳层让位（目前无此需求），需在页面侧使用更高特异性或 important——预期由 V4 契约先行
  约束，风险可接受。
- **浏览器直连**：`style.css` 零改动，V4 既有断言（无 78px、基础内边距 `10px 18px`）不变，无回归。
- **实测边界**：按约定未自动运行 app；层叠胜负依据规范（author important > author normal，与顺序
  无关）为确定性结论，静态契约已锁定该保证。深浅色外观不影响属性值，无需分支处理。真机验收
  （首载 / Cmd-R / ≤640px / 深浅色）留待人工按 README 验收清单执行 `npm run app` 核对。
- **与 BUG-20260905-003 的收口**：两单共用同一处让位代码（shell-css.mjs + main.mjs 注入），本修复
  即该单预期效果的达成；建议人工确认时将 BUG-20260905-003 与本单一并收口（本单不代操作其状态）。
