# 测试用例 — REQ-20260908-017 创建完单后直接返回列表即可

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 修订 REQ-20260906-016 的自动导航：三类单创建成功后只关弹窗、进模块、刷列表、toast，不再自动打开详情 / 跳转。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| A1 | 基线播种：首轮 poll 只登记全部 id，不导航、不弹提示（保留原 REQ-20260906-016 基线机制） | 高 | 通过（new-item-nav N1） |
| A2 | CLI 新建检测：poll 出现新 REQ → 列表数据刷新（state.board 更新），不 openDrawer、不弹「已定位新建条目」 | 高 | 通过（new-item-nav N2） |
| A3 | 多条新单：全部登记进基线，无任何导航；后续轮询不补跳 | 高 | 通过（new-item-nav N3） |
| A4 | 无新单：数据变化不改变已打开抽屉，仅常规刷新（既有行为不回退） | 高 | 通过（new-item-nav N4） |
| A5 | 弹窗路径（需求/Bug）：创建成功后关闭弹窗、toast 成功、停留在需求模块（setView('status')）、poll 刷新列表，不调用 openDrawer；失败时弹窗保留、报错、不导航、按钮可重试 | 高 | 通过（new-item-nav N5） |
| A6 | 弹窗路径（讨论单）：创建成功后关闭弹窗、toast、进入讨论模块并 poll 刷新讨论列表，不调用 reveal 打开详情（REQ-20260908-013 U2 同步修订） | 高 | 通过（oncall-question-optional U2） |
| A7 | 护栏/边界：弹窗打开期间轮询不导航；关闭后不补跳；切换项目基线重置、既有条目不算新建 | 中 | 通过（new-item-nav N6/N7） |
| A8 | 静态契约：poll 接线 detectNewItem 仅登记基线、不调 openDrawer；submitNew 不含 openDrawer(st.id)/reveal；switchProject / btnInit 重置基线保留；ATBOncall 不再暴露 reveal | 高 | 通过（new-item-nav N8、workbench-layout W7） |
| M1 | 浏览器人工验收：宽屏创建后右栏保持空态/旧条目，窄屏不滑出抽屉；筛选/排序/搜索/勾选不变 | 中 | 待人工 |
| M2 | 浏览器人工验收：CLI 路径 2 秒内列表出新单、无跳转提示；手动点新单照常打开详情 | 中 | 待人工 |
