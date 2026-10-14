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
const seen = new Set();
for (const r of rv) { const [c, n, t, s] = r; if (seen.has(c)) continue; seen.add(c);
  const p = await rd(`podminky/${c}.json`); if (!p) { if (s !== "MRS") chybi++; continue; }
  if (s !== "MRS" && p.stav && p.stav < today) stare++;
  for (const m of p.miry || []) { const z = MIN[t]?.[key(m.d)]; if (z && m.min > 0 && m.min < z && !m.hajen) nizsi.push(`${n}: ${m.d} ${m.min} cm (řád ${z} cm)`); }
  const sez = t === "P" ? today.slice(5) >= "04-16" && today.slice(5) <= "11-30" : true;
  const lr = (p.lov || []).find((l) => /^lov ryb/i.test(l.co) && (!l.od || l.od <= today) && (!l.do || l.do >= today));
  if (sez && lr?.zakaz && !lr.pozn) bezUpr.push(n);
}
if (nizsi.length) prob(`RIS uvádí nižší lovnou míru než Rybářský řád (${nizsi.length}×) – aplikace má použít přísnější`, nizsi.slice(0, 30));
if (chybi > 5) prob(`Chybí podmínky u ${chybi} revírů`);
if (stare > 20) prob(`Podmínky nebyly dnes obnoveny u ${stare} revírů`);
if (bezUpr.length) info(`Lov ryb dnes zakázán bez upřesnění (${bezUpr.length} revírů) – ověřit, že jde o celý revír`, bezUpr.slice(0, 40));
// 4) průtoky a aktuality
const pr = await rd("prutoky.json", {}); const st = Object.keys(pr.stanice || pr.data || {}).length || (pr.items || []).length;
if (prev.pocty?.prutoky && st && st < prev.pocty.prutoky * 0.8) prob(`Méně stanic průtoků: ${prev.pocty.prutoky} → ${st}`);
// 5) ruční poznámky – připomenout neověřené
const ru = (await rd("povolenky-rucne.json", {}))?.reviry || {};
for (const [c, v] of Object.entries(ru)) if (!v.overeno) info(`Ruční poznámka u revíru ${c} není ověřená u MO`);
const out = { datum: today, zjisteno: new Date().toISOString(), ok: !P.length, problemy: P, info: I, pocty: { reviry: nRv, prutoky: st || prev.pocty?.prutoky || 0 }, rad: { platnost: rad.platnost || "", mirP: Object.keys(MIN.P).length, mirM: Object.keys(MIN.M).length } };
await fs.writeFile(new URL("kontrola.json", D), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ok: out.ok, problemy: P.length, info: I.length, rad: out.rad }));
