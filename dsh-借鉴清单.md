# dsh（DeepSeek Harness）借鉴总清单

> 定稿 2026-09-03 · 来源：dsh 生态架构拆解（Cordis/Node 宿主 + 可替换 agent loop + seam 体系）
> 原则：抄设计模式，不抄代码。映射到 Jovan's Workplace 蓝图，标注 ✅已有 / ⬜排期。

---

## A. 架构级（决定 Agent 智能，最高优先）

| # | dsh 设计 | 抄到 JW | 状态 |
|---|---|---|---|
| A1 | **Agent loop 可替换**（默认循环可换成 phase 循环）| runAgentLoop 升级双模式：默认快速循环 + 复杂任务走分阶段循环 | ⬜ M5 编排升级 |
| A2 | **分阶段 loop**：spec → discuss → plan → execute → verify → ship | 复杂委托：先 discuss/plan（**主动向你确认需求与计划**）→ 你点头 → execute | ⬜ M5 |
| A3 | **ask_user 澄清**（discuss 阶段问恰到好处的问题）| 工具集加 `ask_user`：模型拿不准 → 弹 1-2 个关键问题 → 回答续上下文 | ⬜ M5 |
| A4 | **Subagent seam**（官方子代理接口：工具范围/persona/委派深度/可中断）| 学科 AI / 定时任务 / 后台长任务 = 子 agent（复用同一 LLM 网关，per-subject 上下文已具备）| ⬜ M5+ |
| A5 | **ctx.\* 扩展点规范化**（ctx.memory / ctx.web / ctx.tools.guard / ctx.llm / ctx.logger）| 把现有 tools/mem/conv/ai 规范成统一 seam 接口，新增能力挂 seam 即可 | ⬜ 重构日 |
| A6 | **Session 体系**（workspace/preset/fork/子会话/分支）| 会话树（1.1 按日期）✅ 基础；**分支/回溯** → galgame 对话 | ✅部分 ⬜分支 |
| A7 | **Background agents**（后台子代理：启动/看进度/随时中断）| 定时任务 + 后台长任务（Hermes cron 同款）| ⬜ 远期 |

## B. 工程级（省成本/提质量，低成本高回报）

| # | dsh 实践 | 抄到 JW | 状态 |
|---|---|---|---|
| B1 | **前缀缓存友好 prompt 布局**（固定 system+tools 在前，动态在后）| prompt 组装重构：固定 base+tools 最前 → 历史 → 动态注入（记忆/日期/数据）最后。**动态内容越靠后越省钱**（输入价 1.5→0.05 元/百万）| ⬜ 顺手做（小改）|
| B2 | **Provider 路由/fallback** | 模型调用失败自动切备用模型（已有多 Key 体系，加自动 fallback）| ⬜ 顺手做 |
| B3 | **会话可回放**（JSONL + 回放）| 会话落库后提供"导出/回放"（复用 conversations.db）| ✅ 存储 ⬜ 回放 |
| B4 | **工具治理 ctx.tools.guard**（敏感工具权限控制）| 写工具草稿确认已有 ✅；可扩展为"读敏感数据也要确认"开关 | ✅ 部分 |
| B5 | **reasoning effort 分级** | 思考滑块 ✅（off/shallow/normal/deep）| ✅ |
| B6 | **subagent 模型覆盖**（子任务可指定不同模型）| 学科 AI 用 flash、深度任务用 pro（parse 已有 pro 切换，扩展）| ✅ 部分 |

## C. 生态级（远期可选，按需求触发）

| # | dsh 能力 | 说明 | 触发信号 |
|---|---|---|---|
| C1 | **MCP client** | 接入外部 MCP 工具生态（网页/日历/邮件等）| 想要官方连接器时 |
| C2 | **ACP / A2A** | 把 JW agent 暴露给其他 agent/编辑器 | 多工具协作时 |
| C3 | **Skills 安装生态** | 技能市场（类似 EduHub）| 技能库跑顺后 |

## 已具备、无需抄（确认我们同构）
- 多模型网关 / 工具集（乐高块）/ 记忆四层 / 技能库 / draft 确认（human-in-the-loop）/
  主动检测 / 上下文窗口压缩 / 学科独立会话 / 前缀缓存已受益（M2 实测 ¥0.0015/轮）

## 下一步落点（建议）
1. **M5 = Agent 编排升级**（A1+A2+A3+ask_user+plan 确认）——1.1 交付后第一个里程碑
2. **顺手做批**（B1 前缀布局 + B2 fallback）——可随任意小版本带上
3. A4 subagent / C1 MCP → 等"定时任务/多 Agent 协作"真实需求出现再排
