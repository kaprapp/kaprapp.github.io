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

// ---------- Morava (MRS a ČRS Moravskoslezský ÚS): jen spolky, které zarybnění průběžně zveřejňují ----------
const DRUH_GEN = [
  [/^parm/, "Parma obecná"], [/^mník/, "Mník jednovousý"], [/^bolen/, "Bolen dravý"], [/^kapr/, "Kapr obecný"], [/^štik/, "Štika obecná"],
  [/^candát/, "Candát obecný"], [/^amur/, "Amur bílý"], [/^lín/, "Lín obecný"], [/^sum[ce]/, "Sumec velký"], [/^úhoř/, "Úhoř říční"],
  [/^pstruh\S* duhov/, "Pstruh duhový"], [/^pstruh/, "Pstruh obecný"], [/^ostroret/, "Ostroretka stěhovavá"], [/^podoust/, "Podoustev říční"],
  [/^tlou/, "Jelec tloušť"], [/^jesen/, "Jelec jesen"], [/^lipan/, "Lipan podhorní"], [/^siven/, "Siven americký"], [/^okoun/, "Okoun říční"],
  [/^hlavat/, "Hlavatka obecná"], [/^jeseter/, "Jeseter malý"], [/^síh|^marén/, "Síh maréna"], [/^tolstolob/, "Tolstolobik bílý"],
];
const druhNom = (t) => { const k = String(t).toLowerCase().trim(); const m = DRUH_GEN.find(([re]) => re.test(k)); return m ? m[1] : cap(k); };
const htmlText = (h) => decodeEntities(stripTags(String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
  .replace(/<\/(td|th)>/gi, "\t").replace(/<\/tr>|<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, "\n"))).replace(/ /g, " ");
const isoLoose = (d) => { const m = String(d).match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
const mnoz = (t) => { const m = String(t).match(/([\d\s.,]+)\s*(kg|ks)/i); return m ? { mn: num(m[1].replace(/\./g, "")), j: m[2].toLowerCase() } : { mn: null, j: "" }; };

// MRS PS Boskovice – tabulka „Datum | Revír | Ev. číslo | Druh | Množství | Velikost“
async function boskovice(idx, log) {
  const url = "https://www.rybariboskovice.cz/zarybneni/";
  const html = await get(url); const out = []; let datum = null;
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const td = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map((c) => decodeEntities(stripTags(c)).replace(/\s+/g, " ").trim());
    if (td.length < 4 || /^datum$/i.test(td[0])) continue;
    const d = isoLoose(td[0]); if (d) datum = d; else td.unshift(""); if (!datum) continue;
    const [, rn, ev, druh, mnozstvi, vel = ""] = td; const c = (ev || "").replace(/\s/g, "");
    if (!/^\d{6,8}$/.test(c) || !druh) continue;
    const rv = idx.byC.get(c) || idx.find("MRS", rn); const { mn, j } = mnoz(mnozstvi);
    out.push({ svaz: "MRS", zdroj: "MRS Boskovice", datum, revir: rv?.c || null, rn: rv?.n || rn, druh: druhNom(druh), kat: vel, mn, j, lat: rv?.lat ?? null, lon: rv?.lon ?? null, url });
  }
  log("zarybnění MRS Boskovice", out.length);
  return out;
}

// MRS PS Hodonín – zprávy „Dne 4. 10. 2026 proběhlo vysazování parmy obecné … Morava 4 – vysazeno 1000 ks“
async function hodonin(idx, log) {
  const url = "https://www.mrshodo.cz/";
  const t = htmlText(await get(url)); const out = [];
  for (const m of t.matchAll(/Dne\s+(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})\s+proběhlo\s+vysazování\s+([^\n]*?)(?:\s+(?:do|v)\s+naš[^\n]*?)?:\s*\n([\s\S]*?)(?=\n\s*(?:Vysazování|Dne\s+\d|RYBÁŘSKÉ|Aktuální|🚨|$))/gi)) {
    const datum = isoLoose(m[1]); let sp = m[2].trim(); let kat = "";
    const km = sp.match(/\s+([A-Z][a-z]?\d)\s*$/); if (km) { kat = km[1]; sp = sp.slice(0, km.index); }
    const druh = druhNom(sp);
    for (const l of m[3].split("\n")) {
      const r = l.match(/^\s*([A-ZÁ-Ža-zá-ž][^–\-:]*?\d+[A-Z]?)\s*[–-]\s*vysazeno\s+([\d\s.,]+\s*(?:kg|ks))/i); if (!r) continue;
      const rv = idx.find("MRS", r[1].trim()); const { mn, j } = mnoz(r[2]);
      out.push({ svaz: "MRS", zdroj: "MRS Hodonín", datum, revir: rv?.c || null, rn: rv?.n || r[1].trim(), druh, kat, mn, j, lat: rv?.lat ?? null, lon: rv?.lon ?? null, url });
    }
  }
  log("zarybnění MRS Hodonín", out.length);
  return out;
}

// ČRS MO Šumperk – text „25.9.2026 / Amur bílý : / 471163 Benátky 100 kg / cca 1,5kg kus /“
async function sumperk(idx, log) {
  const url = "https://www.crsmosumperk.cz/informace/";
  const t = htmlText(await get(url)); const out = []; let datum = null, druh = null;
  const i0 = t.search(/Zarybnění\s+mimopstruhových/i); if (i0 < 0) return out;
  for (const raw of t.slice(i0).split("\n")) {
    const l = raw.trim(); if (!l) continue;
    if (/Vytvořeno službou|Cookies/i.test(l)) break;
    const d = l.match(/^(\d{1,2}\.\d{1,2}\.\s*\d{4})$/); if (d) { datum = isoLoose(d[1]); continue; }
    const sp = l.match(/^([A-ZÁ-Ž][a-zá-ž]+(?:\s+[a-zá-ž]+)?)\s*:\s*$/); if (sp) { druh = druhNom(sp[1]); continue; }
    const r = l.match(/^(\d{3}\s?\d{3})\s+(.+?)\s+([\d\s.,]+)\s*(kg|ks)\b(.*)$/i);
    if (!r || !datum || !druh) continue;
    const c = r[1].replace(/\s/g, ""); const rv = idx.byC.get(c);
    const kat = (r[5].match(/cca\s*([\d,]+\s*(?:dkg|kg))/i) || r[5].match(/([\d,]+\s*dkg)/i) || [])[1] || "";
    out.push({ svaz: "Moravskoslezský", zdroj: "ČRS MO Šumperk", datum, revir: rv ? c : null, rn: rv?.n || r[2], druh, kat: kat ? `${kat}/ks` : "", mn: num(r[3]), j: r[4].toLowerCase(), lat: rv?.lat ?? null, lon: rv?.lon ?? null, url });
  }
  log("zarybnění MO Šumperk", out.length);
  return out;
}

export async function zarybneniSvazy({ reviry, prev, today, log = console.log }) {
  const idx = revirIndex(reviry);
  const res = { aktualizovano: new Date().toISOString(), zaznamy: [], zpravy: [], kroky: {} };
  const keep = (a, days) => { const lim = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10); return a.filter((z) => z.datum && z.datum >= lim); };
  const ZDR = { praha: (z) => z.svaz === "Praha", jihocesky: (z) => z.svaz === "Jihočeský", boskovice: (z) => z.zdroj === "MRS Boskovice", hodonin: (z) => z.zdroj === "MRS Hodonín", sumperk: (z) => z.zdroj === "ČRS MO Šumperk" };
  for (const [k, fn] of [["praha", () => praha(idx, log)], ["jihocesky", () => jihocesky(idx, log)], ["boskovice", () => boskovice(idx, log)], ["hodonin", () => hodonin(idx, log)], ["sumperk", () => sumperk(idx, log)]]) {
    try { const r = await fn(); res.zaznamy.push(...r); res.kroky[k] = r.length;
      // spolky mažou starší záznamy ze stránky – ponecháme si je z minula
      if (["boskovice", "hodonin", "sumperk"].includes(k)) res.zaznamy.push(...(prev?.zaznamy || []).filter(ZDR[k])); }
    catch (e) { res.kroky[k] = "chyba: " + String(e).slice(0, 120); res.zaznamy.push(...(prev?.zaznamy || []).filter(ZDR[k])); }
  }
  const prevZ = prev?.zpravy || [];
  try { res.zpravy.push(...await zpravySus(prevZ.filter((z) => z.svaz === "Středočeský"), today, log)); res.kroky.sus = "ok"; } catch (e) { res.kroky.sus = "chyba: " + String(e).slice(0, 120); res.zpravy.push(...prevZ.filter((z) => z.svaz === "Středočeský")); }
  try { res.zpravy.push(...await zpravyUsti(log)); res.kroky.usti = "ok"; } catch (e) { res.kroky.usti = "chyba: " + String(e).slice(0, 120); res.zpravy.push(...prevZ.filter((z) => z.svaz === "Severočeský")); }
  // bez duplicit, jen poslední rok / 90 dní
  const seen = new Set(); res.zaznamy = keep(res.zaznamy, 400).filter((z) => { const k = [z.svaz, z.datum, z.rn, z.druh, z.kat, z.mn].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
  const seenU = new Set(); res.zpravy = keep(res.zpravy, 90).filter((z) => !seenU.has(z.url) && seenU.add(z.url)).sort((a, b) => b.datum.localeCompare(a.datum));
  return res;
}
export { parseJcLine, revirIndex, boskovice, hodonin, sumperk };
