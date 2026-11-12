# awu-ui

给编码 Agent 用的界面规范：**让 AI 写出来的界面不像模板拼的。** 覆盖 Web 页面和桌面窗口（WPF/WinUI、Electron/Tauri、Qt/QML）。

三句话概括：先定调这一屏要干什么，再删掉一切能用布局表达的文字，最后用扫描器和验收清单收口。

## 快速开始

```bash
node scripts/slop-scan.mjs src/            # 先拿客观清单
node scripts/slop-scan.mjs src/ --quiet    # 只列 P0；有则退出码 1，可直接进 CI
node scripts/slop-scan.mjs src/ --json     # 给 agent 或看板读
```

然后按 [SKILL.md](SKILL.md) 走：定调 → 删 → 八条判据 → 只修 P0/P1 → 截图验收。

## 文件

```
awu-ui/
├─ SKILL.md                  主流程与判据
├─ references/
│  ├─ layout-speaks.md       第一原则「让布局说话」：删什么、边界在哪、怎么用结构替代
│  ├─ ai-tells.md            破绽目录（37 条：29 条自动 + 8 条人工）+ 替代模板
│  ├─ desktop.md             桌面：密度、窗口 chrome、键盘、主题、WPF/Electron/Qt
│  └─ review.md              三档处置、评审顺序、报告模板、复审纪律
├─ scripts/slop-scan.mjs     扫描器：21 条行级规则 + 8 项文件级检查，零依赖
└─ examples/                 before / after，用来验证扫描器
```

## 扫描器

零依赖，Node 18+，按扩展名认文件：`html htm css scss less jsx tsx vue svelte astro cshtml xaml axaml qml`。跳过 `node_modules`、`dist`、`build`、`bin`、`obj` 等目录。

输出按文件分组，`P0` 硬门槛 / `P1` 默认值 / `P2` 工艺。表格里每个 id 与代码里的规则一一对应。

## 放哪儿

目录本身就是交付物，放到 Agent 认的位置即可：

| 工具 | 位置 |
| --- | --- |
| Claude Code | `.claude/skills/awu-ui/` |
| Codex | `~/.codex/skills/awu-ui/` |
| 项目内通用 | `skills/awu-ui/`，在规则文件里指向 `SKILL.md` |
| 任意 Agent | 把 `SKILL.md` 与 `references/` 直接当上下文 |

## 边界

- 扫描器只抓可判定的；层级、间距体系、容器选择、内容真伪靠人工。
- 桌面规则覆盖 XAML/AXAML/QML 的颜色与间距字面值、分组框、窗口页脚、无拖拽区；Electron/Tauri 的拖拽区与快捷键需人工核对。
- 中英混排的字重与基线问题，扫描器不判断。
