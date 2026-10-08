# Kapr

Webová aplikace pro kapraře: nejbližší mimopstruhové (i pstruhové) revíry ČRS podle polohy, podmínky lovu z RIS Portálu,
průtoky nížinných řek z ČHMÚ, zarybnění a kapří aktuality. Sesterská aplikace k [Pstruhovi](https://pstruh.iryba.cz).

**Stránka:** https://kapr.iryba.cz

## Jak to funguje
- `index.html` – celá aplikace (mapa OpenStreetMap přes Leaflet).
- `data/` – data, která každé ráno obnoví GitHub Actions (`.github/workflows/update.yml` → `scripts/update.mjs`).
- Seznam vodoměrných stanic (`data/stanice.json`) se sestaví automaticky z hlásných profilů ČHMÚ a jednou měsíčně obnoví.
- Ruční spuštění aktualizace: záložka **Actions** → *Ranní aktualizace dat* → **Run workflow**.

## Zdroje dat
- Revíry a podmínky lovu: [RIS Portál ČRS](https://ris.rybsvaz.cz)
- Průtoky: [ČHMÚ – hlásné profily](https://hydro.chmi.cz/hppsoldv/hpps_oplist.php)
- Zarybnění: týdenní zprávy [Východočeského ÚS ČRS](https://vcus.rybsvaz.cz/aktuality)
- Mapa: © přispěvatelé [OpenStreetMap](https://www.openstreetmap.org/copyright)

Údaje jsou orientační. Závazné jsou podmínky na kartě revíru v RIS a bližší podmínky výkonu rybářského práva.
