// Automatický výběr vodoměrných stanic ČHMÚ k revírům daného typu (P = pstruhové, M = mimopstruhové).
// Stanice se bere, když leží na řece, podle které se jmenuje revír daného typu, a je od něj nejvýš MAX_KM.
import { get, pool, stripTags } from "./lib.mjs";

const MAX_KM = 8;
export const riverKey = (s) => String(s || "").toLowerCase()
  .replace(/\s*[-–(].*$/, "")          // "Labe 47 - Les Království" → "labe 47"
  .replace(/\s+\d+[a-z]?\b.*$/i, "")   // "mohelka 1" → "mohelka"
  .replace(/\s+(horní|dolní|horni|dolni)$/i, "")
  .split(/\s+/).filter(Boolean).sort().join(" ");

export function decodeParts(parts) {
  return (parts || []).map((f) => { const p = []; let x = 0, y = 0; for (let i = 0; i < f.length; i += 2) { x += f[i]; y += f[i + 1] || 0; p.push([x / 1000, y / 1000]); } return p; }).filter((p) => p.length);
}
export function distKm(segs, pt) {
  const K = Math.cos(pt.lat * Math.PI / 180) * 111.32, L = 110.57; let best = 1e9;
  for (const seg of segs) for (let i = 0; i < seg.length; i++) {
    const a = seg[i], b = seg[i + 1] || a;
    const ax = (a[0] - pt.lon) * K, ay = (a[1] - pt.lat) * L, bx = (b[0] - pt.lon) * K, by = (b[1] - pt.lat) * L;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy; let t = len ? -(ax * dx + ay * dy) / len : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy); if (d < best) best = d;
  }
  return best;
}

export async function buildStanice({ typ, reviry, seed, extra = [], extraQaMin = 4, log = console.log }) {
  const extraSet = new Set(extra.map(riverKey));
  // řeky s revíry daného typu
  const byRiver = new Map();
  for (const [c, n, t, , , , , parts] of reviry) {
    if (t !== typ) continue;
    const k = riverKey(n); if (!k) continue;
    if (!byRiver.has(k)) byRiver.set(k, []);
    byRiver.get(k).push(decodeParts(parts));
  }
  // všechny hlásné profily ČHMÚ
  const rows = [];
  for (let p = 1; p <= 16; p++) {
    let html;
    try { html = await get(`https://floodmaps.chmi.cz/hppsoldv/hpps_oplist.php?sort=0&sort_type=asc&startpage=${p}`); } catch (e) { log("ČHMÚ strana", p, e.message); continue; }
    let n = 0;
    for (const r of html.split(/<tr[\s>]/i).slice(1)) {
      const m = r.match(/seq=(\d+)/); if (!m) continue;
      const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => stripTags(x[1]));
      if (tds.length < 6) continue; n++;
      const tok = tds[1], st = tds[2];
      if (byRiver.has(riverKey(tok)) || extraSet.has(riverKey(tok))) rows.push({ seq: m[1], tok, stanice: st });
    }
    if (!n) break;
  }
  log("kandidátů stanic", rows.length);
  const out = [];
  await pool(rows, 4, async (s) => {
    try {
      const html = stripTags(await get(`https://hydro.chmi.cz/hppsevlist/download.php?seq=${s.seq}`));
      const g = html.match(/([\d.]+)\s*v\.\s*d\.\s*([\d.]+)\s*s\.\s*š/);
      const qa = html.match(/Průměrný roční průtok:?\s*([\d.,]+)/i);
      if (!g) return;
      const pt = { lat: +g[2], lon: +g[1] };
      const q = qa ? +qa[1].replace(",", ".") || null : null;
      const segsList = byRiver.get(riverKey(s.tok)) || [];
      const d = segsList.length ? Math.min(...segsList.map((segs) => distKm(segs, pt))) : 1e9;
      const okExtra = extraSet.has(riverKey(s.tok)) && q >= extraQaMin;
      if (!(d <= MAX_KM) && !okExtra) return;
      let ob = "", bd = 1e9;
      for (const z of seed) { const dd = Math.hypot((z.lat - pt.lat) * 111, (z.lon - pt.lon) * 72); if (dd < bd) { bd = dd; ob = z.oblast; } }
      out.push({ ...s, ...pt, qa: q, oblast: ob });
    } catch (e) { log("ev. list", s.seq, e.message); }
  });
  const order = [...new Set(seed.map((z) => z.oblast))];
  out.sort((a, b) => order.indexOf(a.oblast) - order.indexOf(b.oblast) || a.tok.localeCompare(b.tok, "cs") || (b.qa || 0) - (a.qa || 0));
  return out;
}
// výběr stanic: řeky s mimopstruhovými revíry do 8 km
