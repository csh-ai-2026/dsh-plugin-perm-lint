#!/usr/bin/env node
// lint-perm-docs.mjs —— 检查 DSH 插件的「权限语义」文档有没有把「自动批准 / 免确认」写成「允许」
//
// 为什么需要它：在 DSH 里，插件的工具参数说明是调用方（尤其是模型）判断「这个参数意味着什么权限」的
// 唯一依据。如果某个参数的实际效果是「免确认（自动批准）」，而描述只写「tools to allow」，
// 调用方会把「放行」理解成「允许但还会问」——这是本项目 FINDINGS.md 记录的第一个问题。
//
// 用法：
//   node lint-perm-docs.mjs <插件目录> [更多目录...]
//   # 例：node lint-perm-docs.mjs ~/.dsh/profiles/web/node_modules/dsh-claude-code
//
//   退出码：0 = 没发现可疑项；1 = 有可疑项；2 = 用法 / IO 错误
//
// 判定规则（刻意保守，宁少报不错报）：
//   1. 只扫文本文件（.js/.mjs/.cjs/.ts/.md/.json/.txt），只读不执行；
//   2. 同一行同时命中「权限类参数名」与「allow / 允许 / 放行」类措辞 → 记为一条候选；
//   3. 在**该行的前后各 2 行窗口内**找「自动批准 / 免确认 / 不再询问 / auto-approve / silently」等说明词：
//      · 找到 → [ok]（说明同一处已经写明语义）
//      · 没找到 → [SUSPECT]，并额外提示「同文件别处是否有说明词」（那些说明词很可能是给**别的参数**写的）
//   4. 它不判断插件好坏，也不给出严重度——只回答一个问题：这句话会不会让调用方误判权限语义。

import fs from 'node:fs'
import path from 'node:path'

const PERM_PARAM = /(allowed?Tools|allowed_tools|permissionMode|permission_mode|autoApprove|auto_approve|whitelist|allowlist|permissions?\b)/i
const ALLOW_WORD = /(\ballow(ed|s)?\b|\bpermit(s|ted)?\b|允许|放行|许可)/i
// 描述串本身就能暴露问题（哪怕参数名不在同一行）——踩过的坑：tool 参数的 description 常常写在
// 参数名下方第 2–4 行（`allowedTools: {` … `description: '… to allow (e.g. Read, Edit, Bash)'`），
// 只按「参数名 + 允许」配对会整条漏掉——而那一句恰恰是**模型唯一能看到**的说明。
const DESC_ALLOW = /(tools?\s+to\s+allow|built[- ]in\s+tools\s+to\s+allow|允许的[^\n]{0,12}工具|工具名列表|tools?\s+to\s+permit)/i
const CLARITY = /(自动批准|自动允许|自动放行|免确认|免询问|不再询问|静默(拒绝|通过|放行)|auto[-_ ]?approve[ds]?|without (any )?confirmation|no (confirmation|prompt)|non[- ]?interactive|silently)/i
const WINDOW = 2   // 命中行前后各看 2 行

const SKIP_DIR = new Set(['node_modules', '.git', '.pnpm', 'dist', 'coverage', '.cache'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.md', '.json', '.txt'])

function walk(dir, depth = 0, out = []) {
  if (depth > 6) return out
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1, out)
    // ⚠️ Dirent **没有 size 属性**（踩过：用 e.size 判断会恒为假，把所有文件都跳过 → 实测 0 命中）
    else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}

function scanFile(file) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return null }
  const lines = text.split(/\r?\n/)
  const fileHasClarity = CLARITY.test(text)
  const findings = []
  lines.forEach((line, i) => {
    const namedParam = PERM_PARAM.test(line) && ALLOW_WORD.test(line)
    const descOnly = DESC_ALLOW.test(line)
    if (!namedParam && !descOnly) return
    const lo = Math.max(0, i - WINDOW), hi = Math.min(lines.length - 1, i + WINDOW)
    let near = false
    for (let k = lo; k <= hi; k++) if (CLARITY.test(lines[k])) { near = true; break }
    findings.push({
      line: i + 1,
      text: line.trim().replace(/\s+/g, ' ').slice(0, 200),
      ok: near,
      fileHasClarity,
    })
  })
  return { findings }
}

const targets = process.argv.slice(2)
if (!targets.length) {
  console.error('用法: node lint-perm-docs.mjs <插件目录> [更多目录...]')
  process.exit(2)
}

let total = 0, suspects = 0
const out = []

for (const target of targets) {
  const root = path.resolve(target)
  if (!fs.existsSync(root)) { console.error(`跳过（不存在）: ${root}`); continue }
  out.push(`\n=== ${root} ===`)
  for (const file of walk(root)) {
    const res = scanFile(file)
    if (!res || !res.findings.length) continue
    const rel = path.relative(root, file)
    const bad = res.findings.filter(f => !f.ok)
    total += res.findings.length
    suspects += bad.length
    if (!bad.length) {
      out.push(`[ok]      ${rel}（${res.findings.length} 处权限类描述，语义已写明）`)
      continue
    }
    out.push(`[SUSPECT] ${rel} —— ${bad.length}/${res.findings.length} 处未在附近写明「是否会免确认」`)
    for (const f of bad) {
      out.push(`          L${f.line}: ${f.text}`)
      if (f.fileHasClarity) {
        out.push('            ↳ 同文件别处确实有「免确认 / 自动批准」类说明词，但不在这一行附近；')
        out.push('              若那些说明词是给**别的参数**写的，本行读起来仍然是「只是允许」。')
      }
    }
  }
}

console.log(out.join('\n'))
console.log(`\n--- 汇总：候选 ${total} 处；其中 ${suspects} 处未在邻近行写明「是否会免确认」---`)
if (suspects > 0) {
  console.log('说明：SUSPECT 只表示「这句话可能让调用方误判权限语义」，不代表插件有缺陷。')
  console.log('      请人工确认该参数是否真的会免确认，以及文档要不要写明。')
  process.exit(1)
}
process.exit(0)
