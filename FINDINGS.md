# FINDINGS —— DSH 插件权限语义与沙箱边界的一致性（2026-09-19 本机实测）

> 本文记录一组**本机可复核**的观察：在使用 DSH 与一个第三方委派类插件时，**三层权限假定会同时不成立**。
> 所有步骤都在本机跑过，产物由报告者自己读回核验；**本文不含任何本机路径、账号或凭据**。
> 文中不评价任何第三方项目的优劣，诉求落在**宿主侧的口径**与**插件规范**上。

**English abstract:** A local, reproducible observation set: (1) a plugin tool parameter is described as
"tools to allow" while it actually auto-approves; (2) once that whitelist is used, the working-directory
boundary stops being enforced; (3) the DSH file sandbox constrains host tools but not the subprocesses the
plugin spawns. Verified on `@deepseek-ai/dsh` 0.1.2-rc.1 + `dsh-claude-code` 0.1.2, Windows 11, including a
control experiment. This is not a zero-day (a public issue was filed in the plugin repo on 2026-09-18);
no severity rating and no timeline are claimed.

## TL;DR

| 层 | 假定 | 实测 |
|---|---|---|
| ① 描述层 | 参数说明能让人判断「要不要询问」 | 三处说明只写「允许」，**没有一处**写「免确认」，还把 `Edit, Bash` 当示例 |
| ② 目录层 | `cwd` 会限制写入范围 | 白名单里有 `Write`/`Edit`/`Bash` 时，写入 `cwd` 之外**成功且无确认**；不传白名单才被拦 |
| ③ 宿主层 | 就算插件不可靠，宿主沙箱还会拦一道 | 同一条路径：**宿主自己的文件工具被沙箱拒绝**，而**插件拉起的子进程写入成功** |

## 0. 范围与方法

| 项 | 值 |
|---|---|
| DSH | `@deepseek-ai/dsh` **0.1.2-rc.1**（本机已安装；npm `latest` = 0.1.5-rc.2，本机未复测） |
| 插件 | `zhangjunjesse/dsh-claude-code`（第三方，**非官方**）npm `latest` = **0.1.2**（本机已安装版本相同） |
| 平台 | Windows 11；Node v22.23.2 |
| 方法 | ① 静态：读**已安装包**里的说明串（避免「仓库 main 已 0.6.0、npm 停在 0.1.2」的版本落差）；② 动态：派两个探针（传白名单 / 不传白名单）；③ **对照实验**：同一目标路径改用宿主自己的文件工具 |
| 可信度 | 所有产物由报告者**自己**读回核验，不采信子进程的自述 |

## 1. 描述层：把「自动批准」写成「允许」（可用本仓工具复现）

```bash
node lint-perm-docs.mjs <plugin-dir>
# → 3 处 SUSPECT：lib/index.js:14、lib/index.js:155、README.md:52
#   并正确放过 README.md:48（同为权限参数，但那一行写了「完全免确认」）
```

三处原文（逐字）：

| 位置 | 原文 |
|---|---|
| `lib/index.js:155`（**模型可见**的工具参数说明） | `Override the Claude Code built-in tools to allow (e.g. Read, Edit, Bash, Grep, Glob).` |
| `lib/index.js:14`（配置项说明） | `Claude Code built-in tools to allow.` |
| `README.md:52`（配置表） | `\| allowedTools \| 未设 \| 允许的 Claude Code 内置工具名列表 \|` |

也就是说：调用方看到的是「允许这些工具」，而实际效果是「这些工具**不再询问**」。

## 2. 目录层：白名单生效后，`cwd` 拦不住写入

**三步复现（脱敏版）**

1. 在 DSH 里用该插件派一个最小任务，`cwd` 指定为一个**独立目录**，`permissionMode: acceptEdits`，
   `allowedTools` 含 `Write` / `Edit` / `Bash`；
2. 让任务把内容写到 **`cwd` 之外的某个路径** → 观察是否成功、是否弹出确认；
3. 同样的任务，**不传** `allowedTools`，再写一次同一路径。

**观察**

- 第 2 步：写入**成功**，全程**没有任何确认提示**；
- 第 3 步：被插件自己的权限门拦住，原句——
  `Claude requested permissions to write to … but you haven't granted it yet.`

**结论**：`cwd` 拦的是**权限门**，不是**进程**。它只在「不传白名单」时才起拦阻作用。

## 3. 宿主层：DSH 文件沙箱约束宿主工具，但不约束插件拉起的子进程

**对照实验（同一条目标路径、同一会话、同一策略）**

| 谁在写 | 结果 |
|---|---|
| 宿主自己的文件工具 | **被 DSH 沙箱拒绝** |
| 该插件拉起、由子进程执行的写入 | **成功** |

**要提请确认的是**：这是**预期设计**（这条执行路径不在宿主沙箱覆盖范围内）还是需要处理的边界？
若为预期设计，建议在**插件开发文档**里写明这一层由谁负责。

> ⚠️ 措辞说明：这里说的是「**该路径不在沙箱覆盖范围内**」，**不是**「绕过沙箱」——没有用到任何绕过手法。

## 4. 这不是零日，也不是对第三方项目的评价

- 同一问题已于 **2026-09-18** 在插件仓库**公开**提过（`zhangjunjesse/dsh-claude-code#2`）；
- 该仓库没有 `SECURITY.md`、未开启 private vulnerability reporting、也没有公开的安全邮箱，所以走的是公开途径；
- 本文**不做严重度分级**（定级请由维护者判断），**不设时间表**；
- 诉求落在宿主侧口径与插件规范，**不是**评价那个插件本身。

## 5. 建议

**宿主侧（DSH）**

1. 在**插件开发文档**里写明：插件拉起的子进程是否在沙箱 / 权限约束内，以及这一层的责任归属；
2. 插件规范可以加一条：凡语义为「自动批准 / 免确认」的参数，工具描述**必须显式写明**。

**插件侧（第三方项目，供参考）**

3. 在工具 description / 配置描述 / README 配置表里写明该参数是**自动批准列表**，
   放行 `Write` / `Edit` / `Bash` 会同时解除 working-directory 边界与确认门；
4. 把 `Edit, Bash` 从「示例」里去掉，或注明「仅在必要时使用，并配合最小 `cwd`」。

## 6. 你可以怎么复核

- 第 1 节：直接跑本仓 `lint-perm-docs.mjs`（只读文本）；
- 第 2、3 节：按上面的三步复现，注意把 `cwd` 与目标路径都换成你自己的；
- 如果你复核出不同结果，或认定第 3 节是预期设计，请直接指出——我按结论修订本文。
