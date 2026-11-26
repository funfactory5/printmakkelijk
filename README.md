# 🖨️ PrintMakkelijk — zoeken, slicen en printen in je browser

Een website voor de **Creality Ender-3 S1** die helemaal in de browser draait, dus perfect voor **GitHub Pages**:

1. 🔎 **Model zoeken** – zoek op Thingiverse direct in de pagina, of open Printables, MakerWorld, Thangs, Cults3D, MyMiniFactory of Yeggi met één klik.
2. 📥 **Downloaden & laden** – één klik op ✨ *Slice* bij een zoekresultaat, een link plakken, een bestand slepen, of je **Downloads-map laten volgen**: alles wat je downloadt verschijnt meteen op het bed.
3. ⚙️ **Echt slicen** – met de echte **CuraEngine**, gecompileerd naar WebAssembly. Er gaat niets naar een server.
4. 🌈 **Lagen bekijken** – kleurenvoorbeeld per laag (wanden, vulling, support…), printtijd en filamentgebruik.
5. ⬇️ **G-code downloaden** – zet hem op de SD-kaart en printen maar!

## ✨ Wat zit erin

| | |
|---|---|
| 📂 Bestanden | STL, OBJ, 3MF en ZIP (bijv. Thingiverse-downloads met meerdere onderdelen) |
| 🧊 Bed | Ender-3 S1: 220 × 220 × 270 mm. Slepen om te verplaatsen, draaien, plat leggen, schalen, dupliceren, automatisch neerzetten. Rood = past niet. Te grote modellen worden automatisch verkleind. |
| 🧪 Materialen | PLA, PETG, ABS, TPU met passende temperaturen, ventilator en retractie (direct drive) |
| 🎚️ Instellingen | Kwaliteit 0,12 / 0,2 / 0,28 mm, vulling, wanden, support (bed / overal), skirt / brim, temperaturen, snelheid, strijken, **vaasmodus** |
| ⚡ Automatisch slicen | Na elke wijziging wordt opnieuw gesliced (meestal binnen een seconde) |
| 📚 Bibliotheek | Zelf te maken modellen zonder internet: sleutelhanger met naam, telefoonhouder, golvende vaas, doosje met deksel, haakje, kabelclip, kalibratiekubus |
| 🖥️ Start-G-code | Gebaseerd op het officiële Cura-profiel van de Ender-3 S1 (opwarmen, homen, CR-Touch mesh met `M420 S1`, primelijn) |

## 🚀 Op GitHub Pages zetten

1. Merge deze branch naar `main`.
2. Ga op GitHub naar **Settings → Pages** en kies bij **Source**: **GitHub Actions**.
3. De workflow *Test & deploy to GitHub Pages* test eerst de slicer en zet daarna de map `site/` online.
4. Je site staat op `https://<jouw-gebruikersnaam>.github.io/printmakkelijk/` 🎉

## 💻 Lokaal draaien

```bash
python3 -m http.server 8765 --directory site
```

Open daarna <http://localhost:8765>. (Direct `index.html` openen werkt niet: browsers staan web workers niet toe vanaf `file://`.)

Of met Docker (bijv. op een thuisserver):

```bash
docker compose up -d --build
```

en open `http://IP-VAN-DE-SERVER:8088`.

## 🔑 Thingiverse in de pagina zoeken

Thingiverse heeft een gratis *App Token* nodig:

1. Log in en ga naar <https://www.thingiverse.com/apps/create>.
2. Kies **Desktop app**, geef een naam op en maak de app.
3. Kopieer de **App Token** en plak hem in PrintMakkelijk (tab 🔎 Zoeken).

De token wordt alleen in jouw browser bewaard (localStorage).

## 👀 Downloads-map volgen (Chrome / Edge)

Printables, MakerWorld en de meeste andere sites hebben geen open API en blokkeren downloads die vanaf een andere website starten (CORS). Daarom kan PrintMakkelijk je **Downloads-map volgen**: kies in tab 📂 *Openen* je Downloads-map, download daarna een model op welke site dan ook, en het verschijnt vanzelf op het bed en wordt meteen gesliced. Het werkt met de *File System Access API* (Chrome en Edge op een computer). In andere browsers sleep je het bestand gewoon naar de pagina.

## 🧱 Optioneel: eigen CORS-proxy

Wil je ook directe links van sites laden die CORS blokkeren? Zet dan de kleine proxy in [`tools/cors-proxy/worker.js`](tools/cors-proxy/worker.js) gratis op Cloudflare Workers en plak de URL bij **Geavanceerd → CORS-proxy**. De proxy werkt alleen voor bekende modelsites en alleen met GET.

## 🧪 Testen

```bash
node tests/slice.test.cjs          # echte CuraEngine (WASM) in Node: kubus + overhang met support
npm install && npm start &         # lokale server op poort 8765
npm run test:e2e                   # browsertests met Playwright
```

De tests controleren o.a. het aantal lagen, temperaturen, infill/skin/wanden/support en dat er geen placeholders in de G-code blijven staan.

## 🗂️ Hoe het werkt

```
site/
├── index.html              de pagina
├── css/app.css             opmaak (licht/donker, mobiel)
├── js/app.js               alles aan elkaar knopen
├── js/viewer.js            3D-bed, modellen verplaatsen/draaien, G-code-lagen (three.js)
├── js/loaders.js           STL / OBJ / 3MF / ZIP inlezen
├── js/search.js            Thingiverse API, links, downloads (+ proxy)
├── js/watch.js             Downloads-map volgen
├── js/library.js           ingebouwde modellen
├── js/profile.js           Ender-3 S1 profiel → alle CuraEngine-instellingen
├── js/slicer.worker.js     draait CuraEngine in een web worker
└── vendor/                 CuraEngine (WASM), Cura-definities, three.js
```

De CuraEngine-commandline rekent de formules uit Cura's definitiebestanden niet zelf uit (dat doet normaal de Cura-app). `profile.js` doet dat daarom zelf: van "PLA, normaal, 15 % vulling" naar alle afgeleide instellingen zoals aantal boven/onderlagen, lijnafstand van de vulling en support, temperaturen per laag enzovoort.

## ⚠️ Veiligheid & licenties

- Kijk de eerste laag altijd even na en blijf in de buurt bij de eerste prints.
- Controleer de **licentie** van modellen die je van internet haalt voordat je ze deelt of verkoopt.
- Gebruikte open-source software staat in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). Thingiverse, Printables, MakerWorld enz. zijn merken van hun eigenaren; PrintMakkelijk is een onafhankelijk hobbyproject.
