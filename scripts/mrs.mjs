// Revíry Moravského rybářského svazu (MRS) – veřejné rozhraní webu mrsbrno.cz a veřejná mapa revírů MRS.
// Podmínky lovu se skládají z Bližších podmínek MRS 2026 (pstruhové / mimopstruhové vody)
// a z místních pravidel v popisu revíru (míry, lov z loděk, přívlač od 16. 4. …).
import { stripTags, decodeEntities } from "./lib.mjs";

const BASE = "https://mrsbrno.cz";
const KML = "https://www.google.com/maps/d/kml?mid=15FSr1J9DydKmj-fxUsVPQ9cjhI9G9MLM&forcekml=1";
const UA = "Mozilla/5.0 (compatible; iryba.cz ranni aktualizace; +https://iryba.cz)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, headers = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "cs", ...headers } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.text();
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}

// ---------- obecná pravidla MRS 2026 ----------
// hájení: [MM-DD od, MM-DD do] (může přecházet přes Nový rok)
const H = {
  mnik: ["01-01", "03-15"], dravci: ["01-01", "06-15"], hlavatka: ["01-01", "09-30"], jaro: ["03-16", "06-15"],
  po: ["09-01", "04-15"], uhor: ["09-01", "11-30"], lipan: ["12-01", "07-31"],
};
const SP_MP = [
  ["Amur bílý", 50], ["Bolen dravý", 40, H.dravci], ["Candát obecný", 45, H.dravci], ["Hlavatka obecná", 65, H.hlavatka],
  ["Jelec jesen", 25, H.jaro], ["Jelec tloušť", 25, H.jaro], ["Jeseter malý", 30, H.jaro], ["Kapr obecný", 45], ["Lín obecný", 25],
  ["Lipan podhorní", 30, H.lipan], ["Losos obecný", 50], ["Mník jednovousý", 30, H.mnik], ["Okoun říční", null, H.dravci],
  ["Ostroretka stěhovavá", 30, H.jaro], ["Parma obecná", 40, H.jaro], ["Podoustev říční", 25, H.jaro], ["Pstruh duhový", 25],
  ["Pstruh obecný", 25, H.po], ["Síh maréna", 30], ["Siven americký", 25], ["Sumec velký", 70, H.dravci], ["Štika obecná", 50, H.dravci],
  ["Tolstolobik bílý", 50], ["Úhoř říční", 55, H.uhor],
];
const SP_P = [
  ["Amur bílý", 50], ["Hlavatka obecná", 65, H.hlavatka], ["Jelec jesen", 25], ["Jeseter malý", 30, H.jaro], ["Kapr obecný", 40],
  ["Lín obecný", 25], ["Lipan podhorní", 30, H.lipan], ["Losos obecný", 50], ["Mník jednovousý", 30, H.mnik],
  ["Ostroretka stěhovavá", 30, H.jaro], ["Parma obecná", 40, H.jaro], ["Podoustev říční", 25, H.jaro], ["Pstruh duhový", 25],
  ["Pstruh obecný", 25, H.po], ["Síh maréna", 30], ["Siven americký", 25], ["Tolstolobik bílý", 50], ["Úhoř říční", 55, H.uhor],
];
const DOBA_P = [["04-16", "04-30", "06:00–20:00"], ["05-01", "05-31", "06:00–21:00"], ["06-01", "07-31", "05:00–22:00"],
  ["08-01", "08-31", "06:00–22:00"], ["09-01", "09-30", "07:00–20:00"], ["10-01", "10-31", "07:00–19:00"], ["11-01", "11-30", "07:00–17:00"]];
const DOBA_MP = [["01-01", "03-31", "05:00–22:00"], ["04-01", "09-30", "04:00–24:00"], ["10-01", "12-31", "05:00–22:00"]];
const LIM_MP = "V jednom dni si lze přisvojit nejvýše 7 kg ryb, i při lovu na více revírech. Kapr, štika, candát, sumec, bolen a amur: nejvýše 1 kus každého druhu, dohromady nejvýše 2 kusy; jejich přisvojením denní lov končí. Lín nejvýše 3 kusy. Lososovité ryby včetně lipana nejvýše 3 kusy. Do limitů se nepočítá karas stříbřitý, hlaváčovití a sumečci.";
const LIM_P = "Lososovité ryby včetně lipana lze lovit nejvýše 3 dny v týdnu a přisvojit si nejvýše 3 kusy denně; tím denní lov končí. Při lovu nedravých ryb nejvýše 7 kg denně, z toho nejvýše 1 kus kapra a 1 kus amura (dohromady 2 kusy). Štika, tloušť, okoun, sumec, bolen a candát se nezapočítávají do limitů a nesmí být vráceny zpět do vody. Lov je povolen jen na jednoháčky bez protihrotu.";

// genitivy v popisech revírů („Míra štiky 60 cm, candáta 50 cm“)
const GEN = [
  [/^štik/, "Štika obecná"], [/^candát/, "Candát obecný"], [/^kapr/, "Kapr obecný"], [/^sumc/, "Sumec velký"], [/^amur/, "Amur bílý"],
  [/^lín/, "Lín obecný"], [/^bolen/, "Bolen dravý"], [/^pstruha? duhov/, "Pstruh duhový"], [/^pstruh/, "Pstruh obecný"],
  [/^lipan/, "Lipan podhorní"], [/^ostroret/, "Ostroretka stěhovavá"], [/^podoust/, "Podoustev říční"], [/^parm/, "Parma obecná"],
  [/^tlou/, "Jelec tloušť"], [/^jesen/, "Jelec jesen"], [/^okoun/, "Okoun říční"], [/^úhoř/, "Úhoř říční"], [/^siven/, "Siven americký"],
  [/^hlavat/, "Hlavatka obecná"], [/^mník/, "Mník jednovousý"], [/^tolstolob/, "Tolstolobik bílý"], [/^síh|^marén/, "Síh maréna"],
];
export function parseOverrides(text) {
  const out = {};
  for (const m of text.matchAll(/Míra\s+([^.]*?)(?:\.|$)/gi)) {
    for (const part of m[1].split(/,|\sa\s/)) {
      const mm = part.trim().match(/^([a-záčďéěíňóřšťúůýž ]+?)\s+(\d{2,3})(?:\s*[-–]\s*(\d{2,3}))?\s*cm(\s*max)?/i);
      if (!mm) continue;
      const g = mm[1].toLowerCase().trim(); const sp = GEN.find(([re]) => re.test(g)); if (!sp) continue;
      out[sp[1]] = mm[3] ? { min: +mm[2], max: +mm[3] } : mm[4] ? { max: +mm[2] } : { min: +mm[2] };
    }
  }
  return out;
}
// „Parma hájena celoročně“, „Lipan hájen celoročně“
export function parseYearRound(text) {
  const out = [];
  for (const m of text.matchAll(/([A-Za-zÁ-Žá-ž]+)(?:\s+[a-zá-ž]+)?\s+(?:je\s+)?hájen[aáýé]?\s+celoročně/g)) {
    const g = m[1].toLowerCase(); const sp = GEN.find(([re]) => re.test(g)); if (sp && !out.includes(sp[1])) out.push(sp[1]);
  }
  return out;
}

const inRange = (md, [a, b]) => (a <= b ? md >= a && md <= b : md >= a || md <= b);
const addDay = (y, md, k) => { const d = new Date(`${y}-${md}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
// období (od–do) pro dnešek: hájen, nebo volno mezi hájeními
function period(today, h) {
  const y = +today.slice(0, 4), md = today.slice(5);
  if (!h) return { hajen: false, od: `${y}-01-01`, do: `${y}-12-31` };
  const [a, b] = h;
  if (inRange(md, h)) {
    const od = a <= b || md >= a ? `${y}-${a}` : `${y - 1}-${a}`; const doo = a <= b || md <= b ? `${y}-${b}` : `${y + 1}-${b}`;
    return { hajen: true, od, do: doo };
  }
  const od = md > b ? addDay(y, b, 1) : addDay(y - 1, b, 1); const doo = md < a ? addDay(y, a, -1) : addDay(y + 1, a, -1);
  return { hajen: false, od, do: doo };
}

export function mrsConditions(today, t, flags) {
  const y = today.slice(0, 4);
  const sp = t === "P" ? SP_P : SP_MP;
  const miry = sp.map(([d, min, h]) => {
    const o = flags.miry?.[d] || {}; const yr = (flags.celorocne || []).includes(d); const p = yr ? { hajen: true, od: `${y}-01-01`, do: `${y}-12-31` } : period(today, h);
    return { d, min: o.min ?? min ?? null, max: o.max ?? null, hajen: p.hajen, od: p.od, do: p.do, pozn: yr ? "na tomto revíru hájen celoročně" : o.min || o.max ? "místní míra podle popisu revíru" : "" };
  });
  for (const [d, o] of Object.entries(flags.miry || {})) if (!sp.some((s) => s[0] === d)) miry.push({ d, min: o.min ?? null, max: o.max ?? null, hajen: false, od: `${y}-01-01`, do: `${y}-12-31`, pozn: "místní míra podle popisu revíru" });
  const doba = (t === "P" ? DOBA_P : DOBA_MP).map(([a, b, h]) => ({ od: `${y}-${a}`, do: `${y}-${b}`, h, zakaz: false }));
  const lov = [{ co: "lov pod ledem", zakaz: true, od: `${y}-01-01`, do: `${y}-12-31` }, { co: "lov z plavidla", zakaz: !flags.lodky, od: `${y}-01-01`, do: `${y}-12-31` }];
  if (t === "P") lov.push({ co: "lov ryb", zakaz: true, od: `${y}-01-01`, do: `${y}-04-15` }, { co: "lov ryb", zakaz: false, od: `${y}-04-16`, do: `${y}-11-30` }, { co: "lov ryb", zakaz: true, od: `${y}-12-01`, do: `${y}-12-31` });
  else lov.push({ co: "lov ryb", zakaz: false, od: `${y}-01-01`, do: `${y}-12-31` });
  if (t !== "P" && !flags.hlubinna) lov.push({ co: "hlubinná přívlač", zakaz: true, od: `${y}-01-01`, do: `${y}-12-31` });
  const privOd = t === "P" ? "04-16" : flags.privlac164 ? "04-16" : "06-16";
  const md = today.slice(5);
  const technika = t === "P"
    ? [{ co: "Muškaření", zakaz: false }, { co: "Přívlač", zakaz: false }, { co: "Plavaná", zakaz: false }, { co: "Položená", zakaz: false }]
    : [{ co: "Položená", zakaz: false }, { co: "Plavaná", zakaz: false }, { co: "Přívlač", zakaz: md < privOd }, { co: "Muškaření", zakaz: false }, { co: "Čeřínkování", zakaz: md < "06-16" || !!flags.cerinekZakaz }];
  return { doba, kratkodobe: [], miry, limity: [t === "P" ? LIM_P : LIM_MP], lov, technika };
}

// ---------- geometrie z veřejné mapy MRS (KML) ----------
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]; let idx = 0, md = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]; const dx = bx - ax, dy = by - ay; const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); if (d > md) { md = d; idx = i; }
  }
  if (md <= tol) return [pts[0], pts[pts.length - 1]];
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
}
const enc = (line) => { const f = []; let px = 0, py = 0; for (const [lon, lat] of line) { const X = Math.round(lon * 1000), Y = Math.round(lat * 1000); if (f.length && X === px && Y === py) continue; f.push(X - px, Y - py); px = X; py = Y; } return f; };
const coords = (s) => s.trim().split(/\s+/).map((c) => c.split(",").map(Number)).filter((c) => isFinite(c[0]) && isFinite(c[1]));
export function parseKml(kml) {
  const by = new Map();
  for (const m of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const p = m[1]; const nm = (p.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || "";
    const cm = decodeEntities(nm).match(/(\d{3})\s?(\d{3})/); if (!cm) continue;
    const code = cm[1] + cm[2]; const arr = by.get(code) || [];
    for (const g of p.matchAll(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) { const l = dp(coords(g[1]), 0.0012); if (l.length) arr.push(l); }
    for (const g of p.matchAll(/<Polygon>[\s\S]*?<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      const ring = coords(g[1]); if (ring.length < 3) continue;
      const [x0, y0] = ring[0]; let far = 0, fd = 0; ring.forEach(([x, y], i) => { const d = Math.hypot(x - x0, y - y0); if (d > fd) { fd = d; far = i; } });
      arr.push(dp(ring.slice(0, far + 1), 0.0012));
    }
    if (!arr.length) for (const g of p.matchAll(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) { const c = coords(g[1]); if (c.length) arr.push([c[0]]); }
    by.set(code, arr);
  }
  return by;
}

// Dočasné zákazy lovu, které pobočné spolky vyhlašují na svých webech (zatím MRS Hodonín)
const ZAKAZY = [{ ps: "Hodonín", url: "https://www.mrshodo.cz/" }];
const isoD = (d) => { const m = String(d).match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
export function parseZakazy(html, ps) {
  const t = decodeEntities(stripTags(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, "\n"))).replace(/\u00a0/g, " ");
  const out = [];
  // oznámení končí podpisem spolku; v každém bloku se zákazem hledáme revír a data
  for (let b of t.split(/Moravský rybářský svaz,?\s*z\.\s*s\./i)) {
    const i0 = b.search(/ZÁKAZ\s+RYBOLOVU/i); if (i0 < 0) continue; b = b.slice(i0);
    const why = ((b.match(/(Z\s+důvodu[^\n]*?)(?:\s+je\s+na\s+revíru|:|\n)/i) || [])[1] || "").trim();
    const od = isoD((b.match(/Od[^\d\n]{0,20}(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/i) || [])[1]);
    const doo = isoD((b.match(/do[^\d\n]{0,20}(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/i) || [])[1]);
    if (!od || !doo) continue;
    for (const c of b.matchAll(/(?:^|\n)\s*(\d{3})\s?(\d{3})\s+([A-ZÁ-Ž][^\n]*)/g))
      out.push({ code: c[1] + c[2], od, do: doo, duvod: `Zákaz lovu – vyhlásil PS ${ps}${why ? ": " + why.replace(/\s+/g, " ") : ""}` });
  }
  return out;
}

const clean = (html) => decodeEntities(stripTags(String(html || "").replace(/<\/p>|<br\s*\/?>/gi, "\n"))).replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const cap = (s) => s.toUpperCase();

// Hlavní funkce: vrátí řádky do reviry.json a podmínky revírů MRS.
export async function mrsAll({ today, log = console.log }) {
  const cfg = JSON.parse(await req(`${BASE}/appsettings.json`));
  const H = { WebApiKey: cfg.api.apiKey, Accept: "application/json" };
  const list = JSON.parse(await req(`${BASE}/api/public-district?current_page=1&page_size=1000&sort_column=code&sort_direction=asc&search=`, H)).items || [];
  log("MRS revírů v seznamu", list.length);
  let geo = new Map();
  try { geo = parseKml(await req(KML)); log("MRS mapa revírů", geo.size); } catch (e) { log("MRS mapa chyba", e.message); }
  const rows = [], pod = [];
  let i = 0;
  for (const it of list) {
    i++;
    let d = it;
    try { d = JSON.parse(await req(`${BASE}/api/public-district/${it.id}`, H, 2)); } catch (e) { log("MRS detail chyba", it.code, e.message); }
    await sleep(process.env.MRS_FAST?0:200);
    const code = String(d.code || it.code || "").replace(/\s/g, ""); if (!/^\d{6,8}$/.test(code)) continue;
    const t = d.isTroutType ? "P" : "M";
    const g = d.belongsToGroup || it.belongsToGroup || {};
    const org = (g.name || "").replace(/,?\s*z\.\s?s\.?$/i, "").trim();
    const note = clean(d.note).replace(/^Popis revíru:\s*/i, "");
    let parts = (geo.get(code) || []).map(enc).filter((f) => f.length);
    let approx = 0;
    const loc = (d.locations || []).filter((l) => isFinite(l.latitude) && isFinite(l.longitude));
    if (!parts.length && loc.length) { parts = [enc(loc.map((l) => [l.longitude, l.latitude]))]; approx = 1; }
    if (!parts.length) approx = 2; // poloha se doplní podle ostatních revírů spolku
    const flags = {
      miry: parseOverrides(note), celorocne: parseYearRound(note), lodky: /lov z lod[ěe]k povolen/i.test(note), hlubinna: /hlubinn\S* přívlač\S* povolen/i.test(note),
      privlac164: /přívla\S*[^.]{0,40}od\s*16\.\s*4/i.test(note), cerinekZakaz: /zákaz\S*[^.]{0,30}čeřín/i.test(note),
    };
    const extra = [];
    if (d.isLocalMrsDistrict) extra.push("Místní revír pobočného spolku.");
    if (d.includedInAssociationPermit === false) extra.push("Revír není součástí svazové povolenky MRS.");
    if (d.flyFishing) extra.push("Revír je vhodný pro muškaření.");
    rows.push([code, cap(d.name || it.name || ""), t, "MRS", org, `mrs:${it.id}`, `mrs${it.id}`, parts, approx]);
    pod.push({
      c: code, n: cap(d.name || ""), t, s: "MRS", o: org, url: `mrs:${it.id}`, stav: today, mrs: { id: it.id, flags },
      popis: [note, ...extra].filter(Boolean).join("\n"), delka: d.length || null, rozloha: d.acreage || null,
      lat: loc[0]?.latitude ?? null, lon: loc[0]?.longitude ?? null,
      mo_web: g.webLink || "", mo_tel: "", mo_mail: g.email || "",
      ...mrsConditions(today, t, flags),
    });
    if (i % 50 === 0) log("MRS detaily", i, "/", list.length);
  }
  // revíry bez mapy: přibližně do středu ostatních revírů téhož pobočného spolku
  const cen = new Map();
  for (const r of rows) { if (r[8] === 2 || !r[7][0]) continue; const c = cen.get(r[4]) || { x: 0, y: 0, n: 0 }; c.x += r[7][0][0]; c.y += r[7][0][1]; c.n++; cen.set(r[4], c); }
  let drop = 0;
  for (let k = rows.length - 1; k >= 0; k--) {
    const r = rows[k]; if (r[8] !== 2) continue;
    const c = cen.get(r[4]);
    if (!c) { rows.splice(k, 1); pod.splice(pod.findIndex((p) => p.c === r[0]), 1); drop++; continue; }
    r[7] = [[Math.round(c.x / c.n), Math.round(c.y / c.n)]]; r[8] = 1;
  }
  log("MRS revíry", rows.length, "(bez jakékoli polohy vynecháno", drop + ")");
  for (const z of ZAKAZY) {
    try {
      const list = parseZakazy(await req(z.url), z.ps).filter((k) => k.do >= today);
      for (const k of list) { const p = pod.find((x) => x.c === k.code); if (p) p.kratkodobe.push({ od: k.od, do: k.do, duvod: k.duvod }); }
      log("MRS zákazy", z.ps, list.length);
    } catch (e) { log("MRS zákazy chyba", z.ps, e.message); }
  }
  return { rows, pod };
}
