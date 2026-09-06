# Jovan's Workplace — Codex 项目交接文件（全量记忆迁移）

> 读此文件即可完整接手 JW 项目，无需历史对话。
> 交接日期：2026-09-06 · 交接人：WorkBuddy（主 PM 角色）· 给 Codex 执行会话
> 代码基址：`D:\Jovan's Workplace\`（git main 分支，已推 GitHub: JovanYoung/jovan-workplace）

---

## 一、项目是什么

**Jovan's Workplace（JW）**：个人 AI 助理桌面应用（定位从"工作台"演进为"AI 助理"，主页 = 操作台 + Agent 对话）。
- 数据本地优先：日程/任务/备忘(亲友/技能/词典/记忆)/学习 + 主 Agent 聊天 + 学科 AI
- AI 原生：内置多模型网关（DeepSeek 主力）、工具循环、记忆四层、技能库、主动检测、ask_user/plan 编排
- 技术栈：**Electron 44 + 纯 JS 零 npm 运行时依赖** + node:sqlite（内置）；electron-builder 打包绿色 zip
- 现状版本：1.2 完成（692f16a）；下一期 1.3 需求见 `1.3-更新交接.md`

## 二、目录结构

```
D:\Jovan's Workplace\
├── app\                      主程序源码（改动唯一目录）
│   ├── main.js               主进程：窗口/托盘/IPC（data:* ai:* conv:* mem:* skill:*）
│   ├── preload.js            contextBridge window.workplace
│   ├── ai.js                 AI 网关：厂商模板/价格表/流式 chat/runAgentLoop(工具循环/ask/plan/fallback)/thinking
│   ├── tools.js              工具集（读工具直执 + 写工具草稿待确认 + ask_user）+ 归一化函数
│   ├── parse.js              一句话解析 + detect 8 类意图 + 学习词典(dict.json) + todayCN
│   ├── conv.js               SQLite 会话管理器（conversations.db：会话/消息/facts+FTS5/LIKE 搜索/窗口压缩/档案注入/记忆注入）
│   ├── mem.js                L3 事实提炼（flash）
│   ├── skills.js             技能库（data\skills\{id}.json）
│   ├── data.js               workspace.json 原子写/快照10/每日备份30（含 conversations.db，WAL checkpoint）
│   ├── renderer\index.html   单文件 UI ~500KB（主页/日程/备忘/学习 4 Tab + 设置）
│   ├── check-html.js         内联 JS 语法检查工具
│   └── lib\lunar.js          农历
├── data\                     运行时数据（gitignore，不进 git）
│   ├── workspace.json        业务数据（rows 数组）
│   ├── conversations.db      聊天+记忆（SQLite）
│   ├── backups\              每日备份（workspace-*.json + conversations-*.db，各留 30）
│   ├── snapshots\            写前快照（10 份）
│   ├── dict.json             学习词典
│   └── skills\               技能文件
├── dist\                     打包产物（gitignore）
├── *.md                      全部文档/交接（见第七节索引）
└── .gitignore                排除 node_modules/dist/data/*.exe 等
```

## 三、架构关键点（改代码前必读）

1. **数据流**：renderer 经 contextBridge(window.workplace) → IPC → 主进程模块（data.js/conv.js/ai.js）。AI 工具执行在主进程，直接调 data.js（add/update/del/mutate）
2. **AI 网关**：厂商模板（deepseek/zhipu/moonshot/openai/qwen/volcengine/siliconflow/ollama）OpenAI 兼容；`deepseek-v4-flash`(默认)/`deepseek-v4-pro`；价格表分时/缓存；thinking 参数（off/shallow/normal/deep → thinking.type + reasoning_effort）
3. **工具循环**（ai.js runAgentLoop）：≤5 轮；并行工具；失败重试 1；**写工具一律返草稿**（{draft:true}）→ renderer 确认卡 → ai:confirm-draft → data.add；ask_user（≤3 次，串行 waitAsk/answerAsk）；fallbackModel（401/429/5xx 切同厂商下个模型→下一厂商）
4. **编排（1.2）**：main.js ai:agent = fixedSystem(纯常量前缀,缓存友好) + dynamicInjection(记忆/技能独立 user 消息) → shouldPlan 关键词命中 → plan 卡确认 → runAgentLoop
5. **记忆四层**：L1 窗口压缩(>40 条摘要) / L2 SQLite FTS5+LIKE 历史搜索 / L3 facts 表（自动存，带 source_conv 可追溯，设置→记忆可删）/ L4 技能库+学科档案注入
6. **会话**：主 Agent 每天一会话（subject='主Agent'）；学科 AI（subject=学科名）；1.1 起主 Agent 落库；会话树查看器按日期分组
7. **SQLite**：node:sqlite DatabaseSync（Electron 44 已验证可用）；FTS5 trigram + LIKE 兜底中文（unicode61/trigram 对 2 字中文词失效——**中文检索走 LIKE**）
8. **前端**：打字机效果(模拟流式) / renderMarkdown（自写、esc 防 XSS）/ AI 消息操作条（复制/朗读 speechSynthesis/重生成 hover 显示）/ 思考条 thinkBar / ask/plan 卡 / 主页 Agent dock

## 四、UI 结构与关键 id（renderer/index.html）

- Tab：主页(today)/日程(schedule)/备忘(memo)/学习(learn)，导航 data-tab
- 主页：`#homeDash`（4 张 .today-card 缩略仪表）+ `#agentDock`（Agent 悬浮区，1.2；**1.3 将回退改回普通布局**）
- 备忘（模块名常量 MODULE_MEMO_NAME，占位"备忘"）：4 子 Tab（亲友画像/技能/学习词典/记忆）
- Agent 对话元素：`#chatLog .chat-msg` / `#chatMeta`（费用）/ `#thinkBar`
- 学习模块：学期→科目→笔记/课件(tut/lect)；**1.3 要重新编排**（用户嫌乱）
- 历史查看器 `#historyMask`（会话树，可重命名/删除）

## 五、迭代与执行约定（很重要）

**每期 = 我（主 PM）写"对接文档" → 执行会话(Codex/WorkBuddy 等)读文档 → 九/七/八问复述经确认 → 免打断执行 → 交「交接文档 + 危险操作报告」 → 我验收。**

- 代码/注释英文、UI 文案中文；纯 JS 零新运行时 npm 依赖；renderer **禁 window.prompt/confirm**（用内行输入+modal）
- git：main 分支，commit 前缀 feat/fix/docs(版本)；push 前自测
- 数据文件（data/）是用户数据：**非明确指令不得删改**；测试数据用完清理
- 版本节奏：0.0.0(发) → M1-M4(1.0.0 功能) → 1.1(主页合并/备忘重组/会话落库) → 1.2(编排升级/悬浮dock) → **1.3 待办见 `1.3-更新交接.md`**

## 六、环境坑（WorkBuddy/桌面注入）

- 跑 Electron：`env -u ELECTRON_RUN_AS_NODE NODE_OPTIONS= ./node_modules/.bin/electron . --no-sandbox --disable-gpu --disable-gpu-compositing`（沙盒需 flags；真实桌面不需要）
- 带 BrowserWindow 的冒烟脚本 stdout 静默 → 断言写文件
- 测试脚本禁硬编码 API Key（env JW_TEST_KEY）；单跑脚本 safeStorage 需 `app.setName("Jovan's Workplace")` + userData 在 whenReady 前
- git push 网络波动：重试 / `-c http.proxy= -c https.proxy=`

## 七、文档索引（全部在 D:\Jovan's Workplace\）

| 文档 | 用途 |
|---|---|
| `AI功能蓝图.md` | 需求总账（v3.1+：版本节奏/多Agent/galgame/借鉴）|
| `dsh-借鉴清单.md` | dsh 架构借鉴清单 |
| `1.0.0-M2/M3/M4-开工对接.md` + `-交接.md` | 各里程碑（历史参考）|
| `1.1-大改版-对接/交接.md` | 1.1（历史参考）|
| `1.2-Agent编排升级-对接/交接.md` + 危险报告 | 1.2（历史参考）|
| `1.3-更新交接.md` | **下一期需求（最新）** |
| `封装开工PROMPT.md` | v0.0.0 封装（历史）|
| `README.md` | 面向用户的双语说明 |

## 八、常用命令

```bash
cd "D:/Jovan's Workplace"
git log --oneline | head -20        # 版本历史
git checkout <hash> -- app          # 回溯某版本代码
cd app && node check-html.js        # 语法检查
node --check <file>.js              # 单文件检查
```

## 九、执行自检清单（每期交付前）

- [ ] node --check 全部改动 js + check-html.js failures:0
- [ ] 数据文件未被误动（git status 无 data/）
- [ ] 零新增 npm 运行时依赖
- [ ] 提交已 push main
- [ ] 交接文档（验收对照/坑/代码清单）+ 危险操作报告 已交付
