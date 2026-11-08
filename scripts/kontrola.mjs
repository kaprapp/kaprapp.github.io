// Ranní sebekontrola dat (běží hned po update.mjs). Výsledek: data/kontrola.json.
// Pořadí důvěry: 1) Rybářský řád (PDF ČRS, data/rad.json) → 2) podmínky a upřesnění svazů z RIS → 3) popis revíru → 4) ruční poznámky → 5) odhady aplikace.
import fs from "fs/promises";
const D = new URL("../data/", import.meta.url);
const rd = async (f, d = null) => { try { return JSON.parse(await fs.readFile(new URL(f, D), "utf8")); } catch { return d; } };
const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
const prev = await rd("kontrola.json", {});
const meta = await rd("meta.json", {});
const rv = (await rd("reviry.json", {}))?.reviry || [];
const rad = await rd("rad.json", {});
const P = [], I = []; // problémy (k řešení) a informace
const prob = (t, x) => P.push(x ? { t, x } : { t }); const info = (t, x) => I.push(x ? { t, x } : { t });

// 1) kroky ranní aktualizace
for (const [k, v] of Object.entries(meta.kroky || {})) if (v && v.ok === false) prob(`Krok „${k}“ selhal`, v.chyba);
if ((meta.posledniBeh || "").slice(0, 10) !== today) prob("Ranní aktualizace dnes neproběhla", meta.posledniBeh || "");
// 2) počty proti minule
const nRv = rv.length;
if (prev.pocty?.reviry && nRv < prev.pocty.reviry * 0.97) prob(`Ubylo revírů: ${prev.pocty.reviry} → ${nRv}`);
const pk = meta.kroky?.podminky; if (pk && pk.fail > Math.max(5, (pk.ok || 0) * 0.02)) prob(`Podmínky nestaženy u ${pk.fail} revírů`);
// 3) Rybářský řád – nejmenší lovné míry (nejvyšší priorita)
const MIN = { P: {}, M: {} }; let cur = null;
const walk = (o) => { if (typeof o === "string") { const h = o.match(/Nejmenší lovné míry .* v (mimo)?pstruhovém rybářském revíru jsou/i); if (h) { cur = h[1] ? "M" : "P"; return; }
  const m = cur && o.match(/^[a-z]\)\s*(.+?)\s*\(.*?\)\s*[–-]\s*(\d+)\s*cm/i); if (m) MIN[cur][m[1].replace(/\s*\(.*$/, "").toLowerCase()] = +m[2]; else if (cur && /^\(\d+\)/.test(o)) cur = null; }
  else if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") Object.values(o).forEach(walk); };
walk(rad.casti || rad);
if (Object.keys(MIN.P).length < 5 || Object.keys(MIN.M).length < 5) prob("Z Rybářského řádu se nepodařilo načíst tabulku nejmenších lovných měr");
const key = (d) => d.toLowerCase().replace(/\s*\(.*$/, "").trim();
let nizsi = [], bezUpr = [], stare = 0, chybi = 0;
const jenCastL = [], techCastL = [], ponechL = [], stojNejasne = [], bezUprPotvrz = [], bezUprOverit = [];
const CELY = /cel[ýé]\s+revír[^.]{0,80}(chovn|chráněn|CHRO|zakáz)|(chovn|chráněn)[^.]{0,40}cel[ýé]\s+revír/i;
const seen = new Set();
for (const r of rv) { const [c, n, t, s] = r; if (seen.has(c)) continue; seen.add(c);
  const p = await rd(`podminky/${c}.json`); if (!p) { if (s !== "MRS") chybi++; continue; }
  if (s !== "MRS" && p.stav && p.stav < today) stare++;
  for (const m of p.miry || []) { const z = MIN[t]?.[key(m.d)]; if (z && m.min > 0 && m.min < z && !m.hajen) nizsi.push(`${n}: ${m.d} ${m.min} cm (řád ${z} cm)`); }
  const sez = t === "P" ? today.slice(5) >= "04-16" && today.slice(5) <= "11-30" : true;
  const lr = (p.lov || []).find((l) => /^lov ryb/i.test(l.co) && (!l.od || l.od <= today) && (!l.do || l.do >= today));
  if (sez && lr?.zakaz && !lr.pozn) bezUpr.push(n);
  // co aplikace „vyčte“ z textu (stejná pravidla jako index.html) – k občasnému ověření
  if (sez && lr?.zakaz && !lr.pozn) (CELY.test(p.popis || "") ? bezUprPotvrz : bezUprOverit).push(n);
  if (lr?.zakaz && lr.pozn && !/celý\s+revír|celého\s+revíru|hlavní\s+tok|mimo\s+provoz|závod|místenk|neplatí\s+pro|kromě|vyjma|mimo\s+(rybník|nádrž|vodní)|povolen\w*\s+pouze|pouze\s+(pro|s|se|členům|držitel)/i.test(lr.pozn) && /úsek|úseku|v\s+části|část\w*\s+revíru|pásm|v\s+prostoru|\d+\s*m\s+(nad|pod|od|kolem|okolo)|od\s+\S.*\s+(po|až\s+(k|po|na))\s|na\s+\S+\s+(jezeru|rybníku|nádrži|ploše)/i.test(lr.pozn)) jenCastL.push(`${n}: ${lr.pozn.slice(0, 140)}`);
  for (const tq of p.technika || []) if (tq.zakaz && /(?:pouze|jen)\s+(?:na|v)\s/i.test(tq.pozn || "")) techCastL.push(`${n} – ${tq.co}: ${tq.pozn.slice(0, 120)}`);
  for (const m of p.miry || []) if (/povinnost ponechat|nesmí vrátit|nesmí být vrácen|nevrací/i.test(m.pozn || "")) ponechL.push(`${n} – ${m.d}: ${m.pozn.slice(0, 100)}`);
  if (t === "P") { const jmeno = /nádrž|rybník|jezer|pískovn|vodní ploch/i.test(p.n || "") || /^\s*Odlov lze provozovat na vodní ploše/i.test(p.popis || "");
    if (jmeno && +p.delka > 0) stojNejasne.push(`${n} (délka ${p.delka} km, bere se jako nádrž)`); }
}
if (nizsi.length) prob(`RIS uvádí nižší lovnou míru než Rybářský řád (${nizsi.length}×) – aplikace má použít přísnější`, nizsi.slice(0, 30));
if (chybi > 5) prob(`Chybí podmínky u ${chybi} revírů`);
if (stare > 20) prob(`Podmínky nebyly dnes obnoveny u ${stare} revírů`);
if (bezUprPotvrz.length) info(`Lov ryb dnes zakázán bez upřesnění, popis potvrzuje celý revír (chovný / CHRO): ${bezUprPotvrz.length} revírů`);
if (bezUprOverit.length) info(`Lov ryb dnes zakázán bez upřesnění a popis to výslovně nepotvrzuje (${bezUprOverit.length}) – ověřit u svazu, zda jde o celý revír`, bezUprOverit.slice(0, 40));
if (jenCastL.length) info(`Aplikace bere zákaz lovu jen jako část revíru podle upřesnění (${jenCastL.length}) – ověřit, že upřesnění opravdu říká jen úsek`, jenCastL.slice(0, 40));
if (techCastL.length) info(`Technika zakázána s upřesněním „jen/pouze na…“ – aplikace ji ukazuje s hvězdičkou (${techCastL.length})`, techCastL.slice(0, 30));
if (ponechL.length) { const u = {}; for (const x of ponechL) { const k = x.replace(/^.*?: /, ""); u[k] = (u[k] || 0) + 1; } info(`Poznej rybu: povinnost ponechat vyčtená z upřesnění lovné míry (${ponechL.length} řádků, ${Object.keys(u).length} různých znění)`, Object.entries(u).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v}× „${k}“`)); }
if (stojNejasne.length) info(`Pstruh: revír podle názvu/popisu brán jako nádrž, ale má délku toku (${stojNejasne.length}) – ověřit nabídku nástrah`, stojNejasne.slice(0, 30));
// 4) průtoky a aktuality
const pr = await rd("prutoky.json", {}); const st = Object.keys(pr.stanice || pr.data || {}).length || (pr.items || []).length;
if (prev.pocty?.prutoky && st && st < prev.pocty.prutoky * 0.8) prob(`Méně stanic průtoků: ${prev.pocty.prutoky} → ${st}`);
// 5) polohy revírů (update.mjs → polohy.json): přibližné, opravené podle GPS a zákresy, které nesedí s GPS
const po = await rd("polohy.json", {});
const nesedi = po.nesedi || [], pribl = po.pribl || [];
if (po.datum !== today) prob("Kontrola poloh revírů dnes neproběhla");
else {
  const nove = nesedi.filter((x) => !(prev.polohyNesedi || []).includes(x));
  if (nove.length) prob(`Nově nesedí zákres revíru s GPS z popisu/RIS (${nove.length}×) – ověřit`, nove);
  const zname = nesedi.filter((x) => !nove.includes(x));
  if (zname.length) info(`Zákres nesedí s GPS (${zname.length}×, už hlášené) – u řek může GPS v popisu patřit k tůni či přítoku`, zname);
  if (po.opraveno?.length) info(`Poloha opravena podle GPS z popisu i RIS (${po.opraveno.length}×)`, po.opraveno);
  if (po.katastr?.length) info(`Poloha odhadnuta podle obce/katastru (${po.katastr.length}×)`, po.katastr.slice(0, 40));
  if (prev.pocty?.pribl != null && pribl.length > prev.pocty.pribl) prob(`Přibylo revírů jen s přibližnou polohou: ${prev.pocty.pribl} → ${pribl.length}`);
  if (pribl.length) info(`Revíry jen s přibližnou polohou (${pribl.length}) – v RIS chybí zákres, GPS i katastr`, pribl.slice(0, 60));
}
// 7) zarybnění – zprávy svazů, které aplikace nepřiřadila k revíru (stejné párování jako index.html)
try {
  const zs = await rd("zarybneni-svazy.json", {}); const od = new Date(Date.now() - 42 * 864e5).toISOString().slice(0, 10);
  const SVK = { "Středočeský": "STČ", "Severočeský": "SČ" }, nrm = (x) => String(x || "").toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " "), isL = (ch) => !!ch && /[\p{L}\d]/u.test(ch);
  const nepr = [], moznaL = [];
  for (const z of (zs.zpravy || []).filter((x) => x.datum >= od)) { const sk = SVK[z.svaz]; if (!sk) continue; const tx = nrm(z.titul + ". " + z.text);
    const hit = rv.some((r) => { if (r[3] !== sk || r[1].length < 4) return false; const n = nrm(r[1]), i = tx.indexOf(n); return i >= 0 && !isL(tx[i - 1]) && !isL(tx[i + n.length]); });
    if (hit) continue;
    const zmin = [...String(z.titul + ". " + z.text).matchAll(/(?:vodní ploch[ay]|revír[ua]?|nádrž[ei]?|rybník[a]?|pískovn[ya]|do)\s+((?:SÚS\s+)?[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][\p{L}]+(?:\s+\d+[A-Z]?)?)/gu)].map((m) => m[1].replace(/^SÚS\s+/, ""));
    if (!zmin.length) continue; // obecná zpráva bez jména revíru – přiřadit nejde
    const kand = zmin.map((w) => { const k = rv.filter((r) => r[3] === sk && nrm(r[1]).startsWith(nrm(w).slice(0, Math.max(4, nrm(w).length - 2)))).map((r) => `${r[1]} (${r[2]})`); return k.length ? `${w} → možná ${[...new Set(k)].slice(0, 3).join(", ")}` : `${w} → v RIS nenalezeno`; });
    nepr.push(`${z.datum} ${z.svaz}: ${z.titul} | ${kand.join("; ")}`); }
  if (nepr.length) info(`Zarybnění: zpráva svazu jmenuje vodu, ale aplikace ji nepřiřadila k revíru (${nepr.length}) – je jen dole ve „Zprávách svazů“`, nepr.slice(0, 20));
  const sus = (zs.zpravy || []).filter((x) => x.svaz === "Středočeský" && x.datum >= new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)).length;
  if (sus >= 12) info(`Zarybnění SÚS: za 14 dní ${sus} zpráv – robot čte jen 12 nejnovějších odkazů z úvodní stránky, mohl něco přeskočit`);
  for (const [k, v] of Object.entries(zs.kroky || {})) { if (typeof v === "string" && v.startsWith("chyba")) prob(`Zarybnění – zdroj „${k}“ selhal`, v); else if (v === 0 && prev.zarybKroky?.[k] > 0) prob(`Zarybnění – zdroj „${k}“ vrátil 0 záznamů (minule ${prev.zarybKroky[k]})`); }
  globalThis.__zarybKroky = zs.kroky || {};
} catch (e) { info("Kontrola zarybnění se nepovedla", String(e).slice(0, 120)); }
// 8) aktuality – zprávy, které robot nepustil do aplikace (nemají štítek)
try {
  const ak = await rd("aktuality.json", {}); const vyr = ak.vyrazeno || [];
  const podez = vyr.filter((x) => /ryb|revír|lov|povolenk|svaz|vod/i.test(x.titul));
  if (podez.length) info(`Aktuality: ${podez.length} zpráv z RIS se do aplikace nedostalo (žádný štítek) – zkontrolovat, jestli nebylo něco důležitého`, podez.slice(0, 25).map((x) => `${x.datum} ${x.titul}`));
} catch {}
// 6) ruční poznámky – připomenout neověřené
const ru = (await rd("povolenky-rucne.json", {}))?.reviry || {};
for (const [c, v] of Object.entries(ru)) if (!v.overeno) info(`Ruční poznámka u revíru ${c} není ověřená u MO`);
const out = { zarybKroky: globalThis.__zarybKroky || prev.zarybKroky || {}, datum: today, zjisteno: new Date().toISOString(), ok: !P.length, problemy: P, info: I, pocty: { reviry: nRv, prutoky: st || prev.pocty?.prutoky || 0, pribl: po.datum === today ? pribl.length : prev.pocty?.pribl ?? null }, polohyNesedi: po.datum === today ? nesedi : prev.polohyNesedi || [], rad: { platnost: rad.platnost || "", mirP: Object.keys(MIN.P).length, mirM: Object.keys(MIN.M).length } };
await fs.writeFile(new URL("kontrola.json", D), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ok: out.ok, problemy: P.length, info: I.length, rad: out.rad }));
