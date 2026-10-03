// Ranní aktualizace dat aplikace Kapr. Spouští GitHub Actions (viz .github/workflows/update.yml).
// Každý krok běží samostatně: když jeden zdroj selže, ostatní data se i tak obnoví.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { buildStanice } from "./stanice.mjs";
import { zarybneniSvazy } from "./zarybneni-svazy.mjs";
import { get, pool, pragueNow, encodeGeom, stripTags, decodeEntities, parseCzDate, parseStockingText } from "./lib.mjs";

const DATA = new URL("../data/", import.meta.url).pathname;
const now = pragueNow();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const readJSON = async (f, d = null) => { try { return JSON.parse(await readFile(DATA + f, "utf8")); } catch { return d; } };
const writeJSON = async (f, o) => { await mkdir(DATA + f.split("/").slice(0, -1).join("/"), { recursive: true }); await writeFile(DATA + f, JSON.stringify(o)); };
const ONLY = process.argv.slice(2); // volitelně: node update.mjs prutoky aktuality
const want = (k) => !ONLY.length || ONLY.includes(k);
const result = {};

const RIS = "https://ris.rybsvaz.cz";
const API = RIS + "/proxy/api/public";
const SVAZ = (n = "") => /Jihočesk/i.test(n) ? "JČ" : /Moravskoslez/i.test(n) ? "MS" : /Severočesk/i.test(n) ? "SČ" : /Středočesk/i.test(n) ? "STČ"
  : /Východočesk/i.test(n) ? "VČ" : /Západočesk/i.test(n) ? "ZČ" : /Prahy|Praha/i.test(n) ? "PHA" : "";

// ---------- 1) Revíry ČRS z RIS (polohy úseků) ----------
async function reviry() {
  const tiles = [];
  const X0 = -910000, X1 = -430000, Y0 = -1235000, Y1 = -930000, NX = 6, NY = 4;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++)
    tiles.push([X0 + ((X1 - X0) * i) / NX, Y0 + ((Y1 - Y0) * j) / NY, X0 + ((X1 - X0) * (i + 1)) / NX, Y0 + ((Y1 - Y0) * (j + 1)) / NY].map(Math.round));
  const bySid = new Map();
  // RIS občas pošle useknutou/poškozenou odpověď; velkou dlaždici pak rozdělíme na čtvrtiny
  const fetchTile = async (t, depth = 0) => {
    try {
      const j = await get(`${API}/reviry?filter.bbox=${t.join(",")}&output.uzemniVymezeni=true`, { json: true, tries: 2 });
      for (const x of j.items || []) bySid.set(x.sid, x);
      log("revíry dlaždice", t.join(","), (j.items || []).length);
    } catch (e) {
      if (depth >= 3) throw e;
      log("dlaždice selhala, dělím", t.join(","), String(e).slice(0, 80));
      const [x0, y0, x1, y1] = t, mx = Math.round((x0 + x1) / 2), my = Math.round((y0 + y1) / 2);
      for (const q of [[x0, y0, mx, my], [mx, y0, x1, my], [x0, my, mx, y1], [mx, my, x1, y1]]) await fetchTile(q, depth + 1);
    }
  };
  for (const t of tiles) await fetchTile(t);
  const list = [...bySid.values()].filter((x) => x.typReviru && x.cislo).map((x) => [
    x.cislo, x.oficialniNazev, x.typReviru.kod === "PSTRUHOVY" ? "P" : "M", SVAZ(x.uzemniSvaz?.nazev), x.organizace?.nazev || "",
    x.friendlyUrl, x.sid, encodeGeom(x.uzemniVymezeni),
  ]);
  // Revíry bez mapy v RIS (bbox je nevrátí): doplníme z úplného seznamu a umístíme přibližně
  // do středu ostatních revírů téže organizace (9. položka = 1 → poloha přibližná).
  try {
    const all = await get(`${API}/reviry?size=5000`, { json: true });
    const have = new Set(list.map((r) => r[6]));
    const center = new Map();
    for (const r of list) { const g = r[7]?.[0]; if (!g) continue; const k = r[4]; const c = center.get(k) || { x: 0, y: 0, n: 0 }; c.x += g[0]; c.y += g[1]; c.n++; center.set(k, c); }
    let add = 0;
    for (const x of all.items || []) {
      if (!x.typReviru || !x.cislo || have.has(x.sid)) continue;
      const org = x.organizace?.nazev || ""; const c = center.get(org);
      list.push([x.cislo, x.oficialniNazev, x.typReviru.kod === "PSTRUHOVY" ? "P" : "M", SVAZ(x.uzemniSvaz?.nazev), org, x.friendlyUrl, x.sid,
        c ? [[Math.round(c.x / c.n), Math.round(c.y / c.n)]] : [], 1]);
      add++;
    }
    log("revíry bez mapy doplněny", add, "z úplného seznamu", (all.items || []).length);
  } catch (e) { log("úplný seznam revírů chyba", e.message); }
  list.sort((a, b) => a[1].localeCompare(b[1], "cs"));
  if (list.length < 500) throw new Error("podezřele málo revírů: " + list.length);
  await writeJSON("reviry.json", { aktualizovano: now.iso, zdroj: "RIS Portál ČRS", reviry: list });
  log("revíry uloženy", list.length);
  return list;
}

// ---------- 2) Podmínky lovu každého revíru ----------
const plat = (a) => (a || []).filter((x) => x.platny !== false);
function condense(p) {
  return {
    doba: plat(p.denniDobaLovu).map((x) => ({ od: x.datumOd, do: x.datumDo, h: x.hodOd && x.hodDo ? `${x.hodOd}–${x.hodDo}` : "", zakaz: !!x.jeZakazano })),
    kratkodobe: plat(p.kratkodobeHajeni).map((x) => ({ od: x.datumOd, do: x.datumDo, duvod: (x.duvod || "").trim() })),
    miry: plat(p.miryAHajeni).map((x) => ({ d: x.druhRyby?.popis || "", min: x.dolniMira ?? null, max: x.horniMira ?? null, hajen: !!x.jeHajen, od: x.datumOd, do: x.datumDo, pozn: (x.poznamka || "").trim() })),
    limity: plat(p.limitPonechanychRyb).map((x) => (x.popis || "").trim()).filter(Boolean),
    lov: plat(p.podminkaLovu).map((x) => ({ co: (x.druhPodminkyLovu?.popis || "").trim(), zakaz: !!x.jeZakazano, od: x.datumOd, do: x.datumDo })),
    technika: plat(p.rybolovnaTechnika).map((x) => ({ co: (x.druhRybolovneTech?.popis || "").trim(), zakaz: !!x.jeZakazano })),
  };
}
async function podminky(list) {
  const monday = new Date().getUTCDay() === 1;
  let ok = 0, fail = 0;
  await pool(list, 6, async ([c, n, t, s, o, url, sid]) => {
    const f = `podminky/${c}.json`;
    const prev = await readJSON(f, {});
    const out = { ...prev, c, n, t, s, o, url, stav: now.date };
    try {
      if (!prev.popis || monday) {
        const d = await get(`${API}/reviry/by-friendly-url/${encodeURIComponent(url)}`, { json: true });
        Object.assign(out, { popis: (d.popis || "").trim(), delka: d.delka ?? null, rozloha: d.rozloha ?? null,
          lat: d.gpsSouradniceSirka ? +d.gpsSouradniceSirka : null, lon: d.gpsSouradniceDelka ? +d.gpsSouradniceDelka : null,
          mo_web: d.organizace?.webUrl || "", mo_tel: d.organizace?.telefon || "", mo_mail: d.organizace?.email || "" });
      }
      const p = await get(`${API}/reviry/by-sid/${sid}/podminky?datum=${now.date}`, { json: true });
      Object.assign(out, condense(p));
      await writeJSON(f, out); ok++;
    } catch (e) { fail++; if (fail < 5) log("podmínky chyba", c, String(e).slice(0, 120)); }
  });
  log("podmínky", ok, "ok,", fail, "chyb");
  if (!ok) throw new Error("žádné podmínky nestaženy");
  return { ok, fail };
}

// ---------- 3) Průtoky ČHMÚ ----------
// Seznam stanic se sestaví automaticky (řeky s revíry tohoto typu) a jednou měsíčně obnoví.
const TYP = "M";
async function prutoky() {
  let meta = await readJSON("stanice.json");
  let nove = 0;
  if (!meta?.stanice?.length || !meta.vytvoreno || (Date.now() - Date.parse(meta.vytvoreno)) > 30 * 864e5) {
    try {
      const rv = await readJSON("reviry.json"); const seed = await readJSON("oblasti-seed.json", []);
      // revíry Moravského rybářského svazu v RIS nejsou → hlavní moravské řeky přidáme podle průtoku
      const extra = ["Dyje", "Svratka", "Jihlava", "Svitava", "Oslava", "Rokytná", "Jevišovka", "Morava", "Bečva", "Haná", "Dřevnice", "Olšava", "Moravská Dyje", "Thaya", "Litava", "Kyjovka"];
      const out = await buildStanice({ typ: TYP, reviry: rv.reviry, seed, extra, extraQaMin: 2, log });
      if (out.length < 20) throw new Error("málo stanic: " + out.length);
      await writeJSON("stanice.json", { vytvoreno: now.date, stanice: out }); nove = out.length; meta = await readJSON("stanice.json");
      log("stanice", out.length);
    } catch (e) { log("stanice chyba", e.message); if (!meta?.stanice?.length) throw e; }
  }
  const want = new Set(meta.stanice.map((s) => String(s.seq)));
  const vals = new Map();
  for (let p = 1; p <= 14; p++) {
    let html;
    try { html = await get(`https://floodmaps.chmi.cz/hppsoldv/hpps_oplist.php?sort=0&sort_type=asc&startpage=${p}`); } catch (e) { log("ČHMÚ strana", p, e.message); continue; }
    const rows = html.split(/<tr[\s>]/i).slice(1);
    let n = 0;
    for (const r of rows) {
      const m = r.match(/hpps_prfdyn\.php\?seq=(\d+)/); if (!m) continue; n++;
      if (!want.has(m[1])) continue;
      const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
      if (tds.length < 4) continue;
      const trendHtml = tds[tds.length - 1], q = stripTags(tds[tds.length - 2]), h = stripTags(tds[tds.length - 3]), cas = stripTags(tds[tds.length - 4]);
      const alt = (trendHtml.match(/alt="([^"]*)"/) || [])[1] || "";
      const trend = /stoup/i.test(alt) ? "stoupa" : /kles/i.test(alt) ? "klesa" : "ustaleny";
      vals.set(m[1], { h: h === "" ? null : +h.replace(",", "."), q: q === "" ? null : +q.replace(",", "."), trend, cas });
    }
    if (!n) break;
  }
  if (!vals.size) throw new Error("ČHMÚ: žádné hodnoty");
  const stanice = meta.stanice.map((s) => { const v = vals.get(String(s.seq)) || {}; return { ...s, h: isFinite(v.h) ? v.h : null, q: isFinite(v.q) ? v.q : null, trend: v.trend || "ustaleny", cas: v.cas || "" }; });
  await writeJSON("prutoky.json", { aktualizovano: now.iso, zdroj: "ČHMÚ – hlásné profily (floodmaps.chmi.cz)", stanice });
  log("průtoky", vals.size, "stanic");
  return { stanic: vals.size, noveStanice: nove };
}

// ---------- karty aktualit (RIS i weby územních svazů běží na stejném systému) ----------
function parseCards(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a class="ris-card[^"]*" href="([^"]+)"[\s\S]*?<\/a>/g)) {
    const a = m[0];
    const pick = (cls) => { const x = a.match(new RegExp(`class="ris-card__${cls}"[^>]*>([\\s\\S]*?)<\\/span>`)); return x ? stripTags(x[1]) : ""; };
    const badges = [...a.matchAll(/<gov-chip[^>]*>([\s\S]*?)<\/gov-chip>/g)].map((x) => stripTags(x[1]));
    out.push({ url: new URL(decodeEntities(m[1]), base).href, titul: pick("title"), text: pick("text"), datum: parseCzDate(pick("date")), stitky: badges });
  }
  return out;
}

// ---------- 4) Kapří aktuality ----------
const ZDROJ = (u) => { const h = new URL(u).hostname; return /^vcus/.test(h) ? "ČRS Východočeský ÚS" : /^smas/.test(h) ? "ČRS Moravskoslezský ÚS" : /^zcus/.test(h) ? "ČRS Západočeský ÚS"
  : /^jcus/.test(h) ? "ČRS Jihočeský ÚS" : /^scus/.test(h) ? "ČRS Severočeský ÚS" : /^(stcus|sus)/.test(h) ? "ČRS Středočeský ÚS" : /praha/.test(h) ? "ČRS ÚS města Prahy" : "ČRS (RIS)"; };
function tag(t) {
  if (/vysaz|zaryb|násad/i.test(t)) return "zarybneni";
  if (/zákaz|hájen|omezení (lovu|rybolovu|vstupu)|uzavř/i.test(t)) return "zakaz";
  if (/sucho|nízk\w* (stav|hladin)|úhyn|průtok/i.test(t)) return "sucho";
  if (/kapr|kaprař|závod|noční lov|rybník|nádrž|přehrad|štik|candát|sumec|amur|dravc/i.test(t)) return "kaprarina";
  return null;
}
async function aktuality() {
  const prev = await readJSON("aktuality.json", { polozky: [] });
  const items = new Map(prev.polozky.map((x) => [x.url, x]));
  for (let p = 1; p <= 5; p++) {
    const html = await get(`${RIS}/aktuality?category=&page=${p}&pageSize=9`);
    for (const c of parseCards(html, RIS)) {
      const st = tag(c.titul + " " + c.text);
      if (!st || !c.datum || items.has(c.url)) continue;
      let text = c.text.replace(/\s*\.\.\.$/, "…");
      if (text.length > 180) text = text.slice(0, 177).replace(/\s\S*$/, "") + "…";
      items.set(c.url, { datum: c.datum, titul: c.titul, text, zdroj: ZDROJ(c.url), url: c.url, stitek: st });
    }
  }
  const limit = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const polozky = [...items.values()].filter((x) => x.datum >= limit).sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 40);
  await writeJSON("aktuality.json", { aktualizovano: now.iso, zdroje: "RIS Portál ČRS (celostátní aktuality a zprávy územních svazů)", polozky });
  log("aktuality", polozky.length, "(nových", polozky.length - prev.polozky.filter((x) => x.datum >= limit).length, ")");
  return { polozek: polozky.length };
}

// ---------- 5) Zarybnění – týdenní zprávy Východočeského ÚS ----------
async function zarybneni() {
  const VC = "https://vcus.rybsvaz.cz";
  const prev = await readJSON("zarybneni.json", { zaznamy: [] });
  const done = new Set([...prev.zaznamy.map((z) => z.url), ...(prev.zpracovane || [])]);
  const cards = [];
  for (let p = 1; p <= 2; p++) cards.push(...parseCards(await get(`${VC}/aktuality?category=&page=${p}&pageSize=9`), VC));
  const nove = cards.filter((c) => /vysazov/i.test(c.titul) && c.datum && !done.has(c.url));
  const add = [];
  for (const c of nove) {
    const html = await get(c.url);
    const body = html.split(/Mohlo by vás zajímat|Fotogalerie/)[0];
    const text = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1])).join("\n");
    const tyden = +((c.titul.match(/(\d+)\.?\s*týd/i) || [])[1] || 0) || null;
    const recs = parseStockingText(text).map((r) => ({ tyden, datum: c.datum, ...r, url: c.url }));
    log("vysazování", c.titul, recs.length, "záznamů");
    add.push(...recs);
  }
  const limit = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10); // rok zpět kvůli „poslednímu známému zarybnění“
  const zaznamy = [...prev.zaznamy, ...add].filter((z) => z.datum >= limit);
  const doDatum = zaznamy.reduce((m, z) => (z.datum > m ? z.datum : m), "");
  const zpracovane = [...new Set([...(prev.zpracovane || []), ...nove.map((c) => c.url)])].slice(-60);
  await writeJSON("zarybneni.json", { ...prev, aktualizovano: now.iso, do: doDatum, zpracovane, zaznamy });
  return { novych: add.length, celkem: zaznamy.length };
}

// ---------- běh ----------
const steps = [];
let list = null;
if (want("reviry")) steps.push(["reviry", async () => { list = await reviry(); return { reviru: list.length }; }]);
if (want("podminky")) steps.push(["podminky", async () => {
  if (!list) { const r = await readJSON("reviry.json"); list = r?.reviry?.filter((x) => x[6]) || []; }
  return podminky(list);
}]);
if (want("prutoky")) steps.push(["prutoky", prutoky]);
if (want("aktuality")) steps.push(["aktuality", aktuality]);
if (want("zarybneni")) steps.push(["zarybneni", zarybneni]);
if (want("zarybneni")) steps.push(["zarybneniSvazy", async () => {
  const rv = await readJSON("reviry.json"); const prev = await readJSON("zarybneni-svazy.json", {});
  const r = await zarybneniSvazy({ reviry: rv.reviry, prev, today: now.date, log });
  await writeJSON("zarybneni-svazy.json", r);
  return { zaznamu: r.zaznamy.length, zprav: r.zpravy.length, ...r.kroky };
}]);

for (const [k, fn] of steps) {
  const t0 = Date.now();
  try { result[k] = { ok: true, ...(await fn()), s: Math.round((Date.now() - t0) / 1000) }; }
  catch (e) { result[k] = { ok: false, chyba: String(e).slice(0, 300) }; log("CHYBA", k, e); }
}
const meta = (await readJSON("meta.json", {})) || {};
await writeJSON("meta.json", { ...meta, posledniBeh: now.iso, kroky: { ...(meta.kroky || {}), ...result } });
log("hotovo", JSON.stringify(result));
