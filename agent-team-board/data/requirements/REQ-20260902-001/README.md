# REQ-20260902-001 收窄 agent-team-board SKILL.md 触发描述，仅保留强信号避免误触发

- 状态：submitted（待人工接受）
- 创建：2026-09-02T09:50:12.118Z

## 描述

背景（2026-09-02 Codex token 消耗归因结论）：SKILL.md 的 frontmatter 描述里「需求、提需求、Bug、缺陷、看板、认领任务、开发某个需求、状态流转、submitted/accepted/in-progress/done」全是日常开发高频词，任何项目会话聊到 bug/看板/状态都可能命中自动触发，把约 10KB 的 SKILL.md 正文灌进上下文，且注入后被后续每一轮重发（复利放大）。

方案：触发描述只保留强信号——/req /bug /dev /board、atb、agent-team-board、Status Board、REQ-/BUG- 编号；去掉上述泛化词。正文（数据规范、状态机铁律、CLI、流程）不动。

验收标准：
1. SKILL.md frontmatter description 不再包含「需求、Bug、缺陷、看板、认领任务、状态流转、submitted/accepted/in-progress/done」等泛化触发词；
2. 强信号完整保留（四个命令名、atb、agent-team-board、Status Board、REQ-/BUG- 编号格式）；
3. 描述仍能说明 skill 用途（一句话定位）；
4. ZCode 端四个 /命令 不受影响（命令是显式入口，不依赖自然语言触发）；
5. 改动后 bump 版本并在 Codex 端 remove+add 重装，验证迁移正常。

影响面：skills/agent-team-board/SKILL.md 的 frontmatter description；两端（ZCode/Codex）触发行为同步变化——自然语言弱提及（如"帮我记个 bug"）不再自动挂载本 skill，需显式 /bug 或提及 atb/编号。

## 验收标准

- [ ] （待补充）
