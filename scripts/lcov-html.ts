// Self-contained LCOV → HTML converter (no dependencies)
const lcov = await Bun.file("coverage/lcov.info").text()

type FileCov = {
  path: string
  lines: Map<number, number>
  fns: Array<{ name: string; line: number; hits: number }>
  branches: Array<{ line: number; hits: number }>
}

const files: FileCov[] = []
let cur: FileCov | null = null

for (const raw of lcov.split("\n")) {
  const line = raw.trim()
  if (line.startsWith("SF:")) {
    cur = { path: line.slice(3), lines: new Map(), fns: [], branches: [] }
  } else if (line.startsWith("DA:") && cur) {
    const [ln, hits] = line.slice(3).split(",").map(Number)
    cur.lines.set(ln, hits)
  } else if (line.startsWith("FN:") && cur) {
    const [ln, ...rest] = line.slice(3).split(",")
    cur.fns.push({ name: rest.join(","), line: Number(ln), hits: 0 })
  } else if (line.startsWith("FNDA:") && cur) {
    const [hits, ...rest] = line.slice(5).split(",")
    const name = rest.join(",")
    const fn = cur.fns.find((f) => f.name === name)
    if (fn) fn.hits = Number(hits)
  } else if (line.startsWith("BRDA:") && cur) {
    const parts = line.slice(5).split(",")
    cur.branches.push({ line: Number(parts[0]), hits: parts[3] === "-" ? 0 : Number(parts[3]) })
  } else if (line === "end_of_record" && cur) {
    files.push(cur)
    cur = null
  }
}

function pct(hit: number, total: number) {
  if (total === 0) return "N/A"
  return `${((hit / total) * 100).toFixed(1)}%`
}

function color(hit: number, total: number) {
  if (total === 0) return "#888"
  const p = (hit / total) * 100
  if (p >= 80) return "#4caf50"
  if (p >= 50) return "#ff9800"
  return "#f44336"
}

function bar(hit: number, total: number) {
  if (total === 0) return ""
  const p = Math.round((hit / total) * 100)
  return `<div style="background:#333;border-radius:3px;height:8px;width:100px;display:inline-block;vertical-align:middle"><div style="background:${color(hit, total)};border-radius:3px;height:8px;width:${p}px"></div></div>`
}

let totalLines = 0,
  hitLines = 0,
  totalFns = 0,
  hitFns = 0,
  totalBr = 0,
  hitBr = 0

const rows = files
  .map((f) => {
    const tl = f.lines.size
    const hl = [...f.lines.values()].filter((v) => v > 0).length
    const tf = f.fns.length
    const hf = f.fns.filter((fn) => fn.hits > 0).length
    const tb = f.branches.length
    const hb = f.branches.filter((b) => b.hits > 0).length
    totalLines += tl
    hitLines += hl
    totalFns += tf
    hitFns += hf
    totalBr += tb
    hitBr += hb
    const short = f.path.replace(/\\/g, "/").replace(/.*\/src\//, "src/")
    return `<tr>
    <td style="text-align:left;padding:4px 12px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.path}">${short}</td>
    <td style="color:${color(hl, tl)}">${pct(hl, tl)}</td><td>${bar(hl, tl)}</td><td>${hl}/${tl}</td>
    <td style="color:${color(hf, tf)}">${pct(hf, tf)}</td><td>${hf}/${tf}</td>
    <td style="color:${color(hb, tb)}">${pct(hb, tb)}</td><td>${hb}/${tb}</td>
  </tr>`
  })
  .join("\n")

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Coverage Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; padding: 24px; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    .summary { display:flex; gap:24px; margin:16px 0 24px; }
    .stat { background:#16213e; padding:12px 20px; border-radius:8px; text-align:center; }
    .stat .val { font-size:28px; font-weight:700; }
    .stat .lbl { font-size:12px; color:#aaa; margin-top:4px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th { background:#16213e; color:#aaa; text-align:center; padding:8px 12px; position:sticky; top:0; }
    th:first-child { text-align:left; }
    td { text-align:center; padding:4px 12px; border-bottom:1px solid #222; }
    tr:hover { background:#16213e44; }
    input { background:#16213e; border:1px solid #333; color:#eee; padding:6px 12px; border-radius:4px; width:300px; margin-bottom:12px; }
  </style>
</head>
<body>
  <h1>Coverage Report</h1>
  <div class="summary">
    <div class="stat"><div class="val" style="color:${color(hitLines, totalLines)}">${pct(hitLines, totalLines)}</div><div class="lbl">Lines (${hitLines}/${totalLines})</div></div>
    <div class="stat"><div class="val" style="color:${color(hitFns, totalFns)}">${pct(hitFns, totalFns)}</div><div class="lbl">Functions (${hitFns}/${totalFns})</div></div>
    <div class="stat"><div class="val" style="color:${color(hitBr, totalBr)}">${pct(hitBr, totalBr)}</div><div class="lbl">Branches (${hitBr}/${totalBr})</div></div>
  </div>
  <input type="search" placeholder="Filter files…" oninput="filter(this.value)">
  <table>
    <thead><tr><th>File</th><th colspan="3">Lines</th><th colspan="2">Functions</th><th colspan="2">Branches</th></tr></thead>
    <tbody id="tbody">${rows}</tbody>
  </table>
  <script>
    function filter(q) {
      const rows = document.querySelectorAll('#tbody tr')
      for (const r of rows) r.style.display = r.children[0].textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none'
    }
  </script>
</body>
</html>`

await Bun.write("coverage/html/index.html", html)
console.log(`✅ Coverage report generated: coverage/html/index.html (${files.length} files)`)
