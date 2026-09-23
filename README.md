# dsh-plugin-perm-lint

> **一句话结论（可直接引用）**：DSH 插件把 `allowedTools` 这类参数描述成「允许（allow）」时，它实际是**自动批准** ——
> 调用方（模型）会以为"放行之后还会被问一声"，于是按**错误的权限模型**授权。
> 本仓提供一个**只读**检查器来找出这类措辞；完整实测（三层假定同时不成立：措辞落差 ＋ `cwd` 不拦子进程 ＋
> 宿主沙箱不覆盖插件拉起的进程）见 [`FINDINGS.md`](./FINDINGS.md)。

一个只读的小检查器：扫描 **DSH 插件**的文档与 schema 源码，找出**把「自动批准 / 免确认」写成「允许」**的权限类参数说明。

## 怎么用（三步，照着做就行）

### 0) 先确认你要有 Node

在终端（Windows 上是 PowerShell）里敲：

```powershell
node -v
```

能打印出版本号（例如 `v22.23.2`）就行。**如果报"不是内部或外部命令"**，说明没装 Node —— 去 <https://nodejs.org> 装 LTS 版，然后重开终端再试。

### 1) 拿到这个工具（二选一）

**方式 A：克隆整仓**（推荐，顺便得到本文档与 `FINDINGS.md`）

```powershell
git clone https://github.com/csh-ai-2026/dsh-plugin-perm-lint
cd dsh-plugin-perm-lint
```

**方式 B：只下这一个脚本**（不想用 git 时）

在本仓页面点开 `lint-perm-docs.mjs` → 右上角 **Raw** → 右键另存为（存到你想放的目录）。

### 2) 找到你要检查的“插件目录”

DSH 的插件装在：

```
<DSH 主目录>\profiles\<profile 名>\node_modules\<插件名>
```

Windows 上默认是（`$env:USERPROFILE` 就是你的用户目录）：

```powershell
$env:USERPROFILE\.dsh\profiles\web\node_modules\<插件名>
```

**不确定有哪些**？用下面这条命令列出**真正的包目录**（即含 `package.json` 的目录）：

> ⚠️ 直接看 `node_modules` 是**看不全**的：`@caob23/dsh-browser-control` 这种"带 @ 的包"实际在
> `node_modules\@caob23\dsh-browser-control`，比不带 @ 的包多一层；`node_modules` 下直接列出来的还会混着
> `.bin` / `.pnpm` 这类目录。

```powershell
$root = "$env:USERPROFILE\.dsh\profiles\web\node_modules"
Get-ChildItem $root -Directory | Where-Object { $_.Name -notlike '.*' } | ForEach-Object {
  if (Test-Path (Join-Path $_.FullName 'package.json')) { $_.FullName }
  else { Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue |
         Where-Object { Test-Path (Join-Path $_.FullName 'package.json') } | ForEach-Object FullName }
}
```

（输出里也会含插件的**依赖包**，例如 `js-yaml`、`undici`——它们不是 DSH 插件，扫到也无害。）

> 注意：本文档里的路径示例是 Windows 写法。**别照抄 Linux 教程里的 `~/...`**——那在 Windows 的 PowerShell 里不好使；
> 用 `$env:USERPROFILE`（PowerShell）或 `%USERPROFILE%`（cmd）代替。

### 3) 跑它

```powershell
node lint-perm-docs.mjs "C:\Users\你的用户名\.dsh\profiles\web\node_modules\某个插件"
```

⚠️ **路径带空格一定要加英文双引号**（例如 `E:\just for fun\...` 这种）。

**一次扫多个 / 扫全部**（把上一步那条命令的输出存进 `$pkgs`，再整批传给它）：

```powershell
$root = "$env:USERPROFILE\.dsh\profiles\web\node_modules"
$pkgs = Get-ChildItem $root -Directory | Where-Object { $_.Name -notlike '.*' } | ForEach-Object {
  if (Test-Path (Join-Path $_.FullName 'package.json')) { $_.FullName }
  else { Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue |
         Where-Object { Test-Path (Join-Path $_.FullName 'package.json') } | ForEach-Object FullName }
}
node lint-perm-docs.mjs @pkgs
```

> 本机实测：这样会扫到 **17 个包目录**，汇总为「候选 36 处 / 28 处 SUSPECT」——
> 数字比单独扫一个插件大，因为里面混进了不少依赖包。

## 输出怎么读

| 你看到的 | 含义 |
|---|---|
| `[SUSPECT] 文件 —— N/M 处未在附近写明「是否会免确认」` | 这个文件里有 N 处权限说明只写了"允许"，**且前后 2 行内没有**"自动批准 / 免确认"字样 → **需要人工确认** |
| `[ok] 文件（N 处权限类描述，语义已写明）` | 同一个文件里那些说明已经写明语义（例如 README 里 `permissionMode` 那行写了"完全免确认"） |
| `--- 汇总：候选 X 处；其中 Y 处未在邻近行写明 ---` | 一句话总结 |

**退出码**：`0` = 没发现可疑项 · `1` = 有可疑项 · `2` = 用法或文件读取出错
（可以直接接进你自己的脚本或 CI：`if ($LASTEXITCODE -eq 1) { ... }`）

## 实测输出（对某第三方委派插件 0.1.2）

```
=== <plugin-dir> ===
[SUSPECT] lib\index.js —— 2/2 处未在附近写明「是否会免确认」
          L14: allowedTools: z.array(z.string()).description('Claude Code built-in tools to allow.'),
          L155: description: 'Override the Claude Code built-in tools to allow (e.g. Read, Edit, Bash, Grep, Glob).',
[SUSPECT] README.md —— 1/2 处未在附近写明「是否会免确认」
          L52: | `allowedTools` | 未设 | 允许的 Claude Code 内置工具名列表 |
            ↳ 同文件别处确实有「免确认 / 自动批准」类说明词，但不在这一行附近；
              若那些说明词是给**别的参数**写的，本行读起来仍然是「只是允许」。

--- 汇总：候选 4 处；其中 3 处未在邻近行写明「是否会免确认」---
```

注意最后一段：同一个 README 里**另一个**参数（`permissionMode`）写了「自动放行 / 完全免确认」，所以那一行被正确放过——
而 `allowedTools` 那行没有。**这正是这个工具存在的意义：同一个文件里写没写清楚，要按参数分别看。**

## 常见问题

- **报一堆 `[SUSPECT]`，但我看不出哪里不对** —— 这是正常的。它只提示"这句话可能让调用方误判权限语义"，**不下结论**；
  某个参数到底会不会自动批准，要看插件源码的调用链，必要时做一次动态验证（`FINDINGS.md` 第 2、3 节演示了做法）。
- **全是 `[ok]`** —— 好事：说明这些插件的权限文档写清楚了。
- **报"跳过（不存在）"** —— 路径写错了。回到第 2 步，用 `Get-ChildItem` 把真实目录名列出来（注意 profile 名可能是 `web` 以外的值）。
- **它会不会动我的系统？** —— 不会。**只读文本文件，不联网，不执行任何插件代码**，也不修改任何文件。

## 为什么需要它

在 DSH 里，插件的工具参数说明是调用方（尤其模型）判断「这个参数意味着什么权限」的**唯一依据**。
如果某个参数的实际效果是**免确认（自动批准）**，而描述只写 `xxx to allow`，调用方会把「放行」理解成
「允许，但还会问我一声」——这两种语义在触发确认门时完全相反。

这个检查器只回答一个问题：**这句话会不会让调用方误判权限语义？**它不评价插件好坏，也不给严重度。

## 它检查什么

1. 只扫文本文件（`.js` / `.mjs` / `.cjs` / `.ts` / `.md` / `.json` / `.txt`），**只读，不执行任何插件代码**；
2. 同一行同时命中「权限类参数名」（`allowedTools` / `permissionMode` / `autoApprove` / `whitelist` …）
   与「allow / 允许 / 放行」类措辞 → 记为一条候选；
   另外，**描述串本身**命中也算（因为 tool 的 `description:` 常常写在参数名下方第 2–4 行，
   而那一句恰恰是**模型唯一能看到**的说明）；
3. 在该行**前后各 2 行的窗口内**查找「自动批准 / 免确认 / 不再询问 / `auto-approve` / `silently`」等说明词：
   - 找到 → `[ok]`（同一处已写明语义）
   - 没找到 → `[SUSPECT]`，并提示「同文件别处是否有说明词」（那些说明词很可能是给**别的参数**写的）

## 局限（请一并读）

- 它只做**措辞**判断，不判断参数的**真实语义**——真实语义要看调用链，甚至要动态验证（见 `FINDINGS.md` 第 2、3 节的做法）。
- 行级窗口是刻意保守的折中：太宽会把「别的参数的说明」当成命中（假 ok），太窄会漏掉表格/多行 schema。
- 它不是沙箱、不是权限检查器，也不做任何执行与拦截。

## 相关

- `FINDINGS.md` —— 本机实测：这类措辞落差叠加上「`cwd` 不拦进程」「宿主沙箱不覆盖插件拉起的子进程」之后，
  三层假定会同时不成立（含可自行复核的步骤与对照实验）。
- 免责：本工具只读文本、不含任何攻击能力，也不针对任何具体插件；发现结果请人工确认后再下结论。

MIT License.
