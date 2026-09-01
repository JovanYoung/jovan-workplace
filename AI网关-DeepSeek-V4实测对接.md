# DeepSeek V4 实测对接文档（AI 网关）

> 交接对象：主 Agent（PM）· 日期：2026-09-01 · 目的：用真实 API Key 实测 DeepSeek V4 Flash 连通性，供后续 AI 网关配置与降本决策。
> 实测用 Key 已由用户回收，本文档不含任何密钥。

---

## 一、一句话结论

**DeepSeek V4 Flash 跑通 ✅** —— 非流式与流式（SSE）均验证成功；模型名已确认，旧模板里的 `deepseek-chat` 已过时，需改用 `deepseek-v4-flash`。

---

## 二、实测结果

| 测试项 | 结果 |
|---|---|
| `GET /v1/models` | ✅ 返回 3 个模型 |
| 非流式 chat | ✅ 正常返回（含 `usage`） |
| 流式 chat（`stream:true`） | ✅ SSE 正常，结尾 `data: [DONE]` |
| `stream_options.include_usage` | ✅ 被支持，最后 chunk 带 usage |

**可用模型清单**（`GET /models` 实测返回）：
```
deepseek-v4-flash             → 文本主力（V4-Flash-0731）
deepseek-v4-pro               → 文本强推理（V4-Pro-0813）
deepseek-v4-flash-vision-exp  → 视觉实验版
```

---

## 三、官方价格（2026-09-01 核实自 api-docs.deepseek.com）

单位：RMB / 百万 token。**分时定价**（高峰 = 空闲 ×2），高峰时段 = 北京时间 **9:00–12:00、14:00–18:00**。

| 模型 | 输入·缓存命中 | 输入·缓存未命中 | 输出 |
|---|---|---|---|
| | 空闲 / 高峰 | 空闲 / 高峰 | 空闲 / 高峰 |
| **deepseek-v4-flash** | 0.05 / 0.10 | 1.5 / 3.0 | 4.5 / 9.0 |
| **deepseek-v4-pro** | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |
| deepseek-v4-flash-vision-exp | 同 Flash | 同 Flash | 同 Flash |

其他参数：上下文 **1M**、最大输出 **384K**、并发 Flash 2500 / Pro 500、支持 JSON Output / Tool Calls / Responses API / Anthropic API。

> ⚠️ 注意：第三方博客（阿里云开发者社区等）出现「Flash 输入 1 元 / 输出 2 元」等**旧价**，与官方现价不符，一律以官方 docs 为准。

---

## 四、流式响应格式（关键，已实测确认）

V4 是**推理模型（默认开启思考模式）**，流式分两段：

1. **先推 `reasoning_content`**（英文思维链），此时 `delta.content = null`；
2. **再推 `content`**（真正的回复），此时 `delta.reasoning_content = null`；
3. 最后一个 chunk 带 `usage`，随后 `data: [DONE]`。

实测片段：
```
data: {"choices":[{"delta":{"content":null,"reasoning_content":"We need answer in Chinese."}}],"usage":null}
...（大量 reasoning_content）...
data: {"choices":[{"delta":{"content":"苹果、香蕉、橙子。","reasoning_content":null}}],"usage":{"prompt_tokens":86,"completion_tokens":76,"total_tokens":162,...}}
data: [DONE]
```

**对现有代码的影响：无需改动**。`chat()` 里只取 `delta.content`、跳过 `reasoning_content`，逻辑天然兼容，思维链不会混进回复。

---

## 五、计费注意点（给 PM 的降本提示）

1. **reasoning token 计入 output**：实测 `completion_tokens=76` 中含 `reasoning_tokens=68`（近 9 成是思维链）。默认思考模式下实际输出费用会被思维链拉高，费用显示可能比"纯文本"预期高。
2. **缓存可大幅降本**：系统自动前缀缓存，命中价（0.05 元）仅为未命中价（1.5 元）的 1/30。稳定 system prompt 前缀有利于命中。
3. **可选关闭思考模式**：V4 支持非思考模式（FIM 补全仅在非思考模式生效）。如需极致降本可研究关闭思考的参数（M1 暂不实现，避免瞎加参数）。
4. 视觉默认仍走智谱 GLM-4.5V-Flash（免费），DeepSeek 的 vision-exp 是实验版、M1 不接入。

---

## 六、本次已同步的代码改动

| 文件 | 改动 |
|---|---|
| `app/ai.js` | deepseek 模型名 `deepseek-chat` → `deepseek-v4-flash`（默认）；新增 `deepseek-v4-pro`；价格更新为官方空闲·缓存未命中基准（flash 1.5/4.5，pro 4.5/13.5）；顶部注释补充分时/缓存说明 |

费用显示当前用**静态基准价（空闲·未命中）**，未做分时/缓存动态计算 —— M1 阶段可接受（金额 > 0 且量级合理），后续可加「分时 ×2、缓存命中识别」优化精度。

---

## 七、给主 Agent 的后续建议

- [ ] 验收时填 DeepSeek Key 后，默认模型已自动是 `deepseek-v4-flash`，直接可用。
- [ ] 若观察费用偏高，优先排查是否默认思考模式导致（见第五节），而非 bug。
- [ ] M2 若做工具循环，DeepSeek V4 支持 Tool Calls / JSON Output，可直接复用。
