# Návod pro Clauda – aplikace Kapr

Tento soubor čte Claude (AI asistent), když v tomto repozitáři dělá úpravy. Platí pro každý nový chat i naplánované úlohy. Piš a odpovídej česky.

## O projektu
- **Pstruh** (https://pstruh.iryba.cz, repo `pstruhapp/pstruhapp.github.io`) – pstruhové revíry.
- **Kapr** (https://kapr.iryba.cz, repo `kaprapp/kaprapp.github.io`) – mimopstruhové revíry.
- **iryba.cz** (repo `pstruhapp/iryba`) – úvodní web s návodem, videem a podmínkami užití.
- Obě aplikace jsou bezplatné webové aplikace (PWA) pro rybáře v Česku, hostované na GitHub Pages. Po `git push` do `main` se změna zveřejní do pár minut.
- Tato aplikace: **Kapr** (`https://kapr.iryba.cz`), typ revírů v kódu `M`.

## Hlavní zásady
1. **Úpravy rozhraní dělej v obou aplikacích** (Pstruh i Kapr mají skoro stejný `index.html`), pokud majitel neřekne jinak. Liší se hlavně texty, `CFG`, typ revíru (`P` / `M`) a modul nástrah.
2. **Před zveřejněním vždy otestuj** (viz Kontrola) a změnu stručně popiš majiteli. Když o to požádá, pošli mu nejdřív snímek obrazovky a nahraj až po souhlasu.
3. **Nic se nesmí ztratit:** každá změna je commit, vrátit jde přes `git revert`.
4. **Pořadí důvěry zdrojů** (když si odporují, platí vyšší):
   1. Rybářský řád ČRS z PDF (`data/rad.json`, platí 1. 1. 2026 – 31. 12. 2027; nové PDF dodává majitel každý rok),
   2. podmínky a **upřesnění** svazů z RIS (`data/podminky/*.json`, pole `pozn` = upřesnění – vždy s ním počítej),
   3. popis revíru (`popis`),
   4. ruční poznámky (`data/povolenky-rucne.json`),
   5. odhady aplikace (šance na záběr, nástrahy) – nikdy nepřebíjejí pravidla.
5. **Soukromí:** majitel vystupuje anonymně jako „Tým Pstruh & Kapr“. Do kódu, commitů ani webu nedávej jeho osobní e-mail, DIČ ani rodné číslo. Kontakt aplikací je `pstruhakapr@gmail.com`.
6. **Obsah třetích stran:** nekopíruj texty ani fotky z obchodů a cizích webů, přebírej jen fakta a piš vlastními slovy. Odkazy do obchodů se zatím nezobrazují (`NA_SHOPS=false`) – neměň bez souhlasu.
7. **Placení:** prodej přes Stripe není aktivní, obchodní podmínky (`iryba/obchodni-podminky.html`) jsou skryté. Funguje jen dobrovolný příspěvek QR platbou (účet v `CFG`).

## Struktura
- `index.html` – celá aplikace v jednom souboru (HTML, CSS, JS). Mapa Leaflet, QR knihovna z cdnjs.
- `sw.js` – service worker (network-first). **Po každé změně `index.html` zvyš číslo v `const CACHE = "kapr-vNN"`**, jinak se v telefonech drží stará verze.
- `data/` – data obnovovaná každé ráno (neupravuj ručně, přepíše je robot), kromě:
  - `nastrahy.json` – katalog nástrah (kontroluje měsíční úloha),
  - `povolenky-rucne.json` – ruční upozornění na povolenky (klíč = číslo revíru, `txt`, `overeno`),
  - `rad.json` – text Rybářského řádu (mění se jen z nového PDF),
  - `ryby.json`, `ryby/` – atlas ryb.
- `scripts/update.mjs` – ranní stahování (RIS, MRS, ČHMÚ, aktuality, zarybnění), `scripts/kontrola.mjs` – sebekontrola dat → `data/kontrola.json`.
- `.github/workflows/update.yml` – spouští obojí každé ráno (~5:40) a po změně ve `scripts/`.
- `src/index.template.html` – stará nepoužívaná verze, **neupravuj ji**.

## Důležitá místa v index.html
- `CFG` – nastavení (e-mail, účet pro QR, částky příspěvku).
- `head()`, `body()` – detail revíru (hlavička, Dnes na revíru, Lovné míry a hájení, popis).
- `povInfo()`, `mistniBox()` – upozornění na místní a zvláštní povolenky.
- `jenCast()`, `techCast()` – práce s upřesněním svazu (zákaz jen v úseku apod.).
- `rezimMimo()` – kombinovaný režim revíru.
- `chanceScore()` – Šance na záběr. `naCtx` / `naCtxK`, `NA_L`, `naCard()`, `naRender()` – Jakou nástrahu?
- Pravidla v kódu: přívlač v mimopstruhovém revíru jen 16. 6.–31. 12.; v pstruhovém revíru 1. 9.–30. 11. jen jeden jednoháček.

## Kontrola před nahráním
1. Syntaxe všech inline skriptů:
   `node -e 'const s=require("fs").readFileSync("index.html","utf8");for(const m of s.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)){try{new Function(m[1])}catch(e){console.log("CHYBA",e.message)}}'`
2. Spusť lokálně (`python3 -m http.server 8768`) a projdi změnu v Playwrightu na šířce telefonu 390 px (Leaflet a open-meteo lze nahradit maketou). Zkontroluj, že v konzoli nejsou chyby.
3. Po změně skriptů dat: `node scripts/kontrola.mjs` a ověř, že `data/kontrola.json` nehlásí nové problémy.
4. Zvyš `CACHE` v `sw.js`.

## Commit a nahrání
- Autor i committer: `Claude <noreply@anthropic.com>`, zpráva česky, stručně co a proč.
- Před pushem `git pull --rebase` (robot s daty commituje každé ráno), pak `git push origin main`.
- Dočasné větve po sobě smaž, když to jde.

## Pravidelné úlohy
| Kdy | Co |
|---|---|
| Každé ráno ~5:40 | `update.mjs` (revíry, podmínky s upřesněním, průtoky, aktuality, zarybnění) + `kontrola.mjs` |
| Pondělí ráno | navíc popisy revírů |
| Pondělí 7:12 | týdenní souhrn sebekontroly majiteli na telefon |
| 1. den v měsíci | kontrola názvů a velikostí nástrah |
| 10. ledna | připomínka nového Rybářského řádu – požádat majitele o PDF |
