// Zarybnění z dalších územních svazů ČRS (doplňuje týdenní zprávy Východočeského ÚS).
//  - ÚS města Prahy: průběžné PDF „Zarybnění RRRR“ (datum, číslo revíru, druh) – WordPress API
//  - Jihočeský ÚS: sezónní PDF tabulky (datum, revír, druh, kategorie, ks, kg) – WordPress API
//  - Středočeský a Severočeský ÚS: krátké zprávy o vysazení (bez revírů) – jen jako „zprávy svazů“
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { get, stripTags, decodeEntities } from "./lib.mjs";
import { decodeParts } from "./stanice.mjs";

const UA = { "User-Agent": "Kapr/1.0 (+https://kaprapp.github.io)" };
async function pdfText(url) {
  const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  writeFileSync("/tmp/z.pdf", Buffer.from(await r.arrayBuffer()));
  execFileSync("pdftotext", ["-layout", "/tmp/z.pdf", "/tmp/z.txt"]);
  return readFileSync("/tmp/z.txt", "utf8");
}
const iso = (d) => { const m = d.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
const num = (s) => +String(s).replace(/\s/g, "").replace(",", ".");
const nkey = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

function revirIndex(reviry) {
  const byC = new Map(), byName = new Map();
  for (const r of reviry) {
    const [c, n, t, s, o, , , parts] = r; const seg = decodeParts(parts)[0]; const q = seg && seg[Math.floor(seg.length / 2)];
    const x = { c, n, t, s, o, lon: q ? q[0] : null, lat: q ? q[1] : null };
    byC.set(c, x); const k = s + "|" + nkey(n); if (!byName.has(k)) byName.set(k, x);
  }
  const find = (svaz, rn) => {
    const k = nkey(rn); const hit = byName.get(svaz + "|" + k); if (hit) return hit;
    const un = k.match(/^(?:un|udolni nadrz)\s+(.+)$/);
    for (const [kk, x] of byName) {
      if (!kk.startsWith(svaz + "|")) continue; const n = kk.slice(svaz.length + 1);
      if (n.startsWith(k + " -") || n.startsWith(k + " (") || n.startsWith(k + ",")) return x;
      if (un && n.includes("udolni nadrz " + un[1])) return x;
    }
    return null;
  };
  return { byC, byName, find };
}

async function praha(idx, log) {
  const media = JSON.parse(await get("https://www.rybaripraha.cz/wp-json/wp/v2/media?search=zarybneni&per_page=20&orderby=date"));
  const pdf = media.find((m) => /zarybneni-\d{4}.*\.pdf$/i.test(m.source_url)) || media.find((m) => /\.pdf$/i.test(m.source_url));
  if (!pdf) return [];
  const txt = await pdfText(pdf.source_url); const out = [];
  for (const line of txt.split("\n")) {
    const f = line.trim().split(/\s{2,}/);
    if (f.length < 4 || !/^\d{2}\.\d{2}\.\d{4}$/.test(f[0]) || !/^\d{6}$/.test(f[1])) continue;
    const druhy = f[f.length - 1], c = f[1], rv = idx.byC.get(c);
    for (const d of druhy.split(/,\s*/)) out.push({ svaz: "Praha", datum: iso(f[0]), revir: c, rn: rv?.n || f[f.length - 2], druh: cap(d.trim()), lat: rv?.lat ?? null, lon: rv?.lon ?? null, url: "https://www.rybaripraha.cz/rybolov/zarybneni/" });
  }
  log("zarybnění Praha", out.length, pdf.source_url);
  return out;
}

function parseJcLine(line) {
  const m = line.match(/^\s*(\d{2}\.\d{2}\.\d{4})\s+(.+)$/); if (!m) return null;
  const f = m[2].trim().split(/\s{2,}/); if (f.length < 3) return null;
  const [rn, druh, ...rest] = f; let kat = "", ks = null, kg = null;
  const isNum = (s) => /^\d{1,3}( \d{3})*$/.test(s) || /^\d+$/.test(s);
  let r = rest.slice();
  if (r.length === 1) { const mm = r[0].match(/^([0-3]) (\d{1,3}( \d{3})*)$/); if (mm && !isNum(r[0].replace(/^[0-3] /, "x"))) r = [mm[1], mm[2]]; }
  if (r.length && (!isNum(r[0]) || (/^[0-3]$/.test(r[0]) && r.length >= 2))) kat = r.shift();
  if (r.length === 2) { ks = num(r[0]); kg = num(r[1]); }
  else if (r.length === 1) { if (/kg/i.test(kat)) kg = num(r[0]); else ks = num(r[0]); }
  else return null;
  if (/^[0-3]$/.test(kat)) kat = kat === "0" ? "plůdek" : `K${kat}`;
  return { datum: iso(m[1]), rn: rn.trim(), druh: cap(druh.trim()), kat, ks, kg };
}
async function jihocesky(idx, log) {
  const posts = JSON.parse(await get("https://www.jcus.cz/wp-json/wp/v2/posts?categories=50&per_page=4"));
  const out = [];
  for (const p of posts) {
    for (const u of [...new Set(p.content.rendered.match(/https?:[^"']+\.pdf/g) || [])]) {
      let txt; try { txt = await pdfText(u); } catch (e) { log("JčÚS PDF", u, e.message); continue; }
      let n = 0;
      for (const line of txt.split("\n")) {
        const z = parseJcLine(line); if (!z || !z.datum) continue;
        const rv = idx.find("JČ", z.rn);
        const mn = z.kg != null ? z.kg : z.ks, j = z.kg != null ? "kg" : "ks";
        out.push({ svaz: "Jihočeský", datum: z.datum, revir: rv?.c || null, rn: rv?.n || z.rn, druh: z.druh, kat: z.kat, mn, j, ks: z.ks, lat: rv?.lat ?? null, lon: rv?.lon ?? null, url: p.link });
        n++;
      }
      log("zarybnění JčÚS", u, n);
    }
  }
  return out;
}

async function zpravySus(prev, today, log) {
  const html = await get("https://www.crs-sus.cz/");
  const links = [...new Set([...html.matchAll(/href="(\/1\/(\d+)\/[^"]+)"/g)].filter((m) => /vysaz|zarybn|nasad|vysadil/i.test(m[1])).map((m) => m[1]))].slice(0, 12);
  const out = [];
  for (const l of links) {
    const url = "https://www.crs-sus.cz" + l; const old = prev.find((z) => z.url === url);
    if (old) { out.push(old); continue; }
    try {
      const h = await get(url);
      const t = decodeEntities((h.match(/property="og:title" content="([^"]*)"/) || [])[1] || "");
      const d = decodeEntities((h.match(/name="og:description"[^>]*content="([^"]*)"/) || h.match(/property="og:description" content="([^"]*)"/) || [])[1] || "");
      out.push({ svaz: "Středočeský", datum: today, titul: t, text: d, url });
    } catch (e) { log("SÚS", url, e.message); }
  }
  return out;
}
async function zpravyUsti(log) {
  const x = await get("https://www.crsusti.cz/rss");
  const out = [];
  for (const it of x.split("<item>").slice(1)) {
    const t = decodeEntities(stripTags((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""));
    if (!/distribu|vysaz|zarybn|násad/i.test(t)) continue;
    const d = stripTags(decodeEntities(((it.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "")));
    const pd = new Date((it.match(/<pubDate>([^<]+)/) || [])[1] || Date.now());
    out.push({ svaz: "Severočeský", datum: pd.toISOString().slice(0, 10), titul: t, text: d.replace(/\s+/g, " ").slice(0, 300), url: (it.match(/<link>([^<]+)/) || [])[1] });
  }
  log("zprávy SčÚS", out.length);
  return out;
}

export async function zarybneniSvazy({ reviry, prev, today, log = console.log }) {
  const idx = revirIndex(reviry);
  const res = { aktualizovano: new Date().toISOString(), zaznamy: [], zpravy: [], kroky: {} };
  const keep = (a, days) => { const lim = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10); return a.filter((z) => z.datum && z.datum >= lim); };
  for (const [k, fn] of [["praha", () => praha(idx, log)], ["jihocesky", () => jihocesky(idx, log)]]) {
    try { const r = await fn(); res.zaznamy.push(...r); res.kroky[k] = r.length; }
    catch (e) { res.kroky[k] = "chyba: " + String(e).slice(0, 120); res.zaznamy.push(...(prev?.zaznamy || []).filter((z) => z.svaz === (k === "praha" ? "Praha" : "Jihočeský"))); }
  }
  const prevZ = prev?.zpravy || [];
  try { res.zpravy.push(...await zpravySus(prevZ.filter((z) => z.svaz === "Středočeský"), today, log)); res.kroky.sus = "ok"; } catch (e) { res.kroky.sus = "chyba: " + String(e).slice(0, 120); res.zpravy.push(...prevZ.filter((z) => z.svaz === "Středočeský")); }
  try { res.zpravy.push(...await zpravyUsti(log)); res.kroky.usti = "ok"; } catch (e) { res.kroky.usti = "chyba: " + String(e).slice(0, 120); res.zpravy.push(...prevZ.filter((z) => z.svaz === "Severočeský")); }
  // bez duplicit, jen poslední rok / 90 dní
  const seen = new Set(); res.zaznamy = keep(res.zaznamy, 400).filter((z) => { const k = [z.svaz, z.datum, z.rn, z.druh, z.kat, z.mn].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
  const seenU = new Set(); res.zpravy = keep(res.zpravy, 90).filter((z) => !seenU.has(z.url) && seenU.add(z.url)).sort((a, b) => b.datum.localeCompare(a.datum));
  return res;
}
export { parseJcLine, revirIndex };
