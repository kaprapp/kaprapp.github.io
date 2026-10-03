// Pomocné funkce pro ranní aktualizaci dat aplikace Kapr.

export const UA = "Kapr/1.0 (+https://kaprapp.github.io; ranni aktualizace)";

// RIS občas vrací čísla typu "-.5" nebo "-NaN" – opravíme je, než to vzdáme.
export function parseLoose(t) {
  try { return JSON.parse(t); } catch (e) {
    const fixed = t
      .replace(/([\[,:]\s*)-\./g, (_, a) => a + "-0.")
      .replace(/([\[,:]\s*)\./g, (_, a) => a + "0.")
      .replace(/([\[,:]\s*)-?(NaN|Infinity)\b/g, "$1null");
    try { return JSON.parse(fixed); } catch {
      const m = /position (\d+)/.exec(e.message);
      const at = m ? +m[1] : 0;
      throw new Error(e.message + " | okolí: " + JSON.stringify(t.slice(Math.max(0, at - 60), at + 60)));
    }
  }
}

export async function get(url, { json = false, tries = 3 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "cs" } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      const t = await r.text();
      return json ? parseLoose(t) : t;
    } catch (e) {
      last = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Spustí úlohy s omezeným souběhem.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: String(e) }; }
      }
    })
  );
  return out;
}

// Dnešní datum v Praze jako YYYY-MM-DD a čas s posunem.
export function pragueNow() {
  const d = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "shortOffset",
    }).formatToParts(d).map((p) => [p.type, p.value])
  );
  const off = (parts.timeZoneName || "GMT+1").replace("GMT", "");
  const sign = off.startsWith("-") ? "-" : "+";
  const h = String(Math.abs(parseInt(off, 10) || 1)).padStart(2, "0");
  const hh = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    iso: `${parts.year}-${parts.month}-${parts.day}T${hh}:${parts.minute}:${parts.second}${sign}${h}:00`,
  };
}

// S-JTSK (EPSG:5514) → WGS84 [lon, lat]
export function jtsk(xx, yy) {
  const X = -yy, Y = -xx, PI = Math.PI;
  let a = 6377397.15508, e = 0.081696831215303, n = 0.97992470462083, ku = 12310230.12797036,
    sUQ = 0.863499969506341, cUQ = 0.504348889819882, sVQ = 0.420215144586493, cVQ = 0.907424504992097,
    alfa = 1.000597498371542, k = 1.003419163966575;
  const ro = Math.sqrt(X * X + Y * Y), eps = 2 * Math.atan(Y / (ro + X)), D = eps / n,
    S = 2 * Math.atan(Math.exp((1 / n) * Math.log(ku / ro))) - PI / 2;
  const sS = Math.sin(S), cS = Math.cos(S), sD = Math.sin(D), cD = Math.cos(D);
  const sU = sUQ * sS - cUQ * cS * cD, cU = Math.sqrt(1 - sU * sU), sDV = (sD * cS) / cU, cDV = Math.sqrt(1 - sDV * sDV);
  const sV = sVQ * cDV - cVQ * sDV, cV = cVQ * cDV + sVQ * sDV;
  const L = (2 * Math.atan(sV / (1 + cV))) / alfa, t = Math.exp((2 / alfa) * Math.log((1 + sU) / cU / k));
  let pom = (t - 1) / (t + 1), sB;
  do { sB = pom; pom = t * Math.exp(e * Math.log((1 + e * sB) / (1 - e * sB))); pom = (pom - 1) / (pom + 1); } while (Math.abs(pom - sB) > 1e-15);
  const B = Math.atan(pom / Math.sqrt(1 - pom * pom));
  let f1 = 299.152812853, e2 = 1 - (1 - 1 / f1) ** 2;
  const r = a / Math.sqrt(1 - e2 * Math.sin(B) ** 2);
  const x = r * Math.cos(B) * Math.cos(L), y = r * Math.cos(B) * Math.sin(L), z = (1 - e2) * r * Math.sin(B);
  const dx = 570.69, dy = 85.69, dz = 462.84, wz = ((-5.2611 / 3600) * PI) / 180, wy = ((-1.58676 / 3600) * PI) / 180,
    wx = ((-4.99821 / 3600) * PI) / 180, m = 3.543e-6;
  const xn = dx + (1 + m) * (x + wz * y - wy * z), yn = dy + (1 + m) * (-wz * x + y + wx * z), zn = dz + (1 + m) * (wy * x - wx * y + z);
  a = 6378137; f1 = 298.257223563;
  const ab = f1 / (f1 - 1), p = Math.sqrt(xn * xn + yn * yn); e2 = 1 - (1 - 1 / f1) ** 2;
  const th = Math.atan((zn * ab) / p), st = Math.sin(th), ct = Math.cos(th);
  const tt = (zn + e2 * ab * a * st ** 3) / (p - e2 * a * ct ** 3);
  return [(2 * Math.atan(yn / (p + xn)) * 180) / PI, (Math.atan(tt) * 180) / PI];
}

// Douglas–Peucker
export function dp(pts, tol) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const d = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > tol) {
    const a = dp(pts.slice(0, idx + 1), tol), b = dp(pts.slice(idx), tol);
    return a.slice(0, -1).concat(b);
  }
  return [pts[0], pts[pts.length - 1]];
}

// Polygon úseku řeky → osa (polovina obvodu k nejvzdálenějšímu bodu), zjednodušená.
export function ringToLine(ring, tol) {
  const [x0, y0] = ring[0];
  let far = 0, fd = 0;
  ring.forEach(([x, y], i) => { const d = Math.hypot(x - x0, y - y0); if (d > fd) { fd = d; far = i; } });
  if (far < 1) return [ring[0]];
  return dp(ring.slice(0, far + 1), tol);
}

// Geometrie revíru (S-JTSK MultiPolygon) → pole úseků, delta-kódované v tisícinách stupně.
export function encodeGeom(g) {
  if (!g) return [];
  const polys = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
  const out = [];
  for (const p of polys) {
    const ring = p && p[0];
    if (!ring || ring.length < 3) continue;
    const line = ringToLine(ring, 120).map(([a, b]) => jtsk(a, b));
    const f = []; let px = 0, py = 0;
    for (const [lon, lat] of line) {
      const X = Math.round(lon * 1000), Y = Math.round(lat * 1000);
      if (f.length && X === px && Y === py) continue;
      f.push(X - px, Y - py); px = X; py = Y;
    }
    if (f.length) out.push(f);
  }
  return out;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—" };
export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
export const stripTags = (s) => decodeEntities(String(s).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t ]+/g, " ").trim();

const MONTHS = { ledna: 1, února: 2, března: 3, dubna: 4, května: 5, června: 6, července: 7, srpna: 8, září: 9, října: 10, listopadu: 11, prosince: 12 };
export function parseCzDate(s) {
  const m = String(s).match(/(\d{1,2})\.\s*([a-záčďéěíňóřšťúůýž]+)\s+(\d{4})/i);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// --- parser týdenních zpráv o vysazování (VČÚS) ---
const SPECIES = /^(Kapr|Pstruh|Amur|Siven|Lipan|Parma|Štika|Candát|Lín|Sumec|Okoun|Cejn|Plotice|Jelec|Ostroretka|Podoustev|Hlavatka|Úhoř|Bolen|Tolstolobik|Karas|Mník|Ouklej|Perlín|Síh|Losos|Potočák|Bílá ryba|Rak)/i;
const num = (s) => parseFloat(String(s).replace(/\s/g, "").replace(",", "."));

export function parseStockingText(text) {
  // text = odstavce článku oddělené \n
  const lines = [];
  for (const raw of text.split("\n").map((x) => x.trim()).filter(Boolean)) {
    if (SPECIES.test(raw)) lines.push(raw);
    else if (lines.length && /\d\s*(kg|ks)/i.test(raw) && !/^(V |Ve |Do |Vysazeno|Za |I |Ani |Aktuální|Přejeme)/.test(raw)) lines[lines.length - 1] += " " + raw;
  }
  const out = [];
  for (const line of lines) {
    const sp = line.search(/\s[-–]\s(?=(?:MO\b|ÚN\b|VD\b|[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]))/);
    if (sp < 0) continue;
    const head = line.slice(0, sp).trim().replace(/(kg|ks)á/gi, "$1 á");
    let tail = line.slice(sp).replace(/^\s[-–]\s/, "").trim();
    const druh = (head.match(/^[^\d]*?(?=\s+(?:á\s|od\s|\d))/) || [head.split(/\s\d/)[0]])[0].replace(/\s+(á|od)$/, "").trim();
    let rest = head.slice(druh.length);
    const KAT = [/od\s+[\d,.]+\s+do\s+[\d,.]+\s*(kg|cm)/i, /[\d,.]+\s+až\s+[\d,.]+\s*(kg|cm)/i, /[\d,.]+\s*[-–]\s*[\d,.]+\s*cm/i, /á\s*[\d,.]+\s*(kg|cm)/i, /[\d,.]+\s*cm/i];
    let kat = "";
    for (const re of KAT) { const m = rest.match(re); if (m) { kat = m[0].replace(/\s+/g, " ").trim(); rest = rest.replace(m[0], " "); break; } }
    const tot = rest.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(kg|ks)(?![a-zá])/i);
    const totalUnit = tot ? tot[2].toLowerCase() : "kg";
    const total = tot ? num(tot[1]) : NaN;
    tail = tail.replace(/(\d\s*(?:kg|ks))\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/g, "$1, ");
    const items = tail.split(/,(?![^()]*\))/).map((x) => x.trim()).filter(Boolean);
    const parsed = [];
    for (let it of items) {
      it = it.replace(/^MO\s+/i, "").replace(/\s+RMV$/i, "").trim();
      const m = it.match(/^(.*?)\s+(\d[\d\s]*(?:[.,]\d+)?)\s*(kg|ks)?\b.*$/i);
      if (m && m[1]) parsed.push({ mo: m[1].replace(/^MO\s+/i, "").trim(), mn: num(m[2]), j: (m[3] || totalUnit).toLowerCase() });
      else if (it && !/\d/.test(it)) parsed.push({ mo: it, mn: NaN, j: totalUnit });
    }
    if (parsed.length === 1 && !isFinite(parsed[0].mn) && isFinite(total)) parsed[0].mn = total;
    for (const p of parsed) if (p.mo && isFinite(p.mn)) out.push({ druh, kat, mn: p.mn, j: p.j, mo: p.mo });
  }
  return out;
}
