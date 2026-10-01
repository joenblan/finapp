# Financiën: persoonlijke, offline financiële app

Een persoonlijke app om je Belgische bankrekeningen op te volgen. De app is **één HTML-bestand** dat je dubbelklikt en opent in Chrome of Edge. Er is geen server, geen installatie en geen internetverbinding nodig: de app maakt nooit netwerkverbindingen. Een Content-Security-Policy in het bestand blokkeert ze bovendien.

## Bouwen

Vereist: [Node.js](https://nodejs.org) 20 of nieuwer. Enkel nodig om te bouwen, niet om de app te gebruiken.

```bash
npm install        # installeert enkel esbuild
npm test           # voert alle tests uit (node --test)
npm run build      # maakt dist/financien.html
```

Het resultaat is `dist/financien.html`: één zelfstandig bestand met alle JavaScript en CSS erin. Je kan het kopiëren naar eender welke plaats.

## De app openen

1. Dubbelklik op `financien.html` en open het in **Google Chrome** of **Microsoft Edge** (desktop).
2. **Eerste keer:** klik op **Datamap kiezen…** en kies een (lege) map, bijvoorbeeld `Documenten/Financien`. Geef de browser toestemming om in die map te lezen en te schrijven.
3. **Volgende keren:** de app onthoudt de map. Klik op **Toegang verlenen**; daarna scant de app automatisch de inbox.

Andere browsers (Firefox, Safari) ondersteunen de vereiste *File System Access API* niet. De app werkt daar in **handmatige modus**: je uploadt bankbestanden zelf en je moet het databestand na elke wijziging zelf downloaden via het tabblad **Back-ups**. Een duidelijke melding bovenaan herinnert je daaraan.

## Mapstructuur van de datamap

```
Financien/                  ← de map die je kiest
├── financien-data.json     ← al je gegevens (rekeningen, uittreksels, transacties, importgeschiedenis)
├── inbox/                  ← zet hier nieuwe bankbestanden
├── archief/                ← geslaagde (en reeds gekende) bestanden worden hierheen verplaatst
├── fout/                   ← mislukte bestanden, met ernaast een leesbaar foutrapport (.fout.txt)
└── backups/                ← automatische kopieën van financien-data.json
```

Je gegevens staan dus in een gewoon bestand in een map die jij kiest, niet in de browser. De browser onthoudt enkel *welke* map je koos. Neem de datamap op in je eigen back-up, bijvoorbeeld op een externe schijf of in een cloudmap.

## Bankbestanden toevoegen

**CODA-bestanden** (Febelfin-standaard, versie 2) download je in je online banking. Zo voeg je ze toe:

- **Via de inbox:** kopieer de bestanden naar `inbox/` en open de app, of klik op **Importeren → Nu scannen**.
- **Via slepen of kiezen:** tabblad **Importeren**, sleep de bestanden naar het vak of klik op **Bestanden kiezen…**. Een kopie komt in `archief/`.

Bij elke import:

- **Geen dubbels.** Een identiek bestand (zelfde SHA-256) wordt overgeslagen. Elk uittreksel en elke transactie heeft een unieke sleutel: rekening + jaar + uittrekselnummer + volgnummer (+ detailnummer). Hetzelfde uittreksel twee keer importeren, ook via een ander bestand, levert nooit dubbele transacties op. Bestaat een uittreksel al met *andere* inhoud, dan wordt niets overschreven en krijg je een foutmelding.
- **Saldocontrole.** Per uittreksel moet *oud saldo + bewegingen = nieuw saldo* kloppen, en ook de totalen in de trailer (record 9). Een bestand dat niet klopt, wordt **niet** geïmporteerd. Het gaat naar `fout/` met een rapport.
- **Continuïteit.** Per rekening controleert de app of de uittreksels op elkaar aansluiten: nummers volgen elkaar op en het oude saldo is gelijk aan het vorige nieuwe saldo. Ontbrekende uittreksels worden gemeld bij de import en op de rekeningkaart.
- **Atomair.** Een bestand wordt volledig of helemaal niet geïmporteerd.

Rekeningen worden automatisch aangemaakt op basis van het IBAN. Via **Rekeningen → Instellingen** kies je een weergavenaam, het type (zicht- of spaarrekening) en het eigendom (individueel of gemeenschappelijk, met de namen van de mede-eigenaars).

Synthetische voorbeeldbestanden (fictieve gegevens) maak je met `npm run sample`; ze komen in `voorbeelden/`. Met `npm run sample -- --groot` maak je ook een testbestand met 20.000 transacties.

## Back-ups

- Vóór elke import en vóór elke teruggezette back-up bewaart de app een kopie van `financien-data.json` in `backups/`, met een tijdstempel in de naam. Standaard blijven de laatste 30 bewaard.
- **Back-up terugzetten:** tabblad **Back-ups**, klik bij de gewenste back-up op **Back-up terugzetten**. De huidige toestand wordt eerst zelf als back-up bewaard, dus terugzetten is altijd ongedaan te maken.
- Je kan ook manueel een back-up terugzetten: sluit de app, kopieer het gewenste bestand uit `backups/` naar `financien-data.json` in de datamap en open de app opnieuw.

## Broncode

```
src/
├── main.js                 opstarten: map kiezen/herstellen, inbox scannen
├── core/                   pure logica zonder DOM (volledig getest in Node)
│   ├── money.js            bedragen als gehele getallen in duizendsten van een euro
│   ├── coda/               CODA-parser (records 0, 1, 21-23, 31-33, 4, 8, 9)
│   ├── checks/             saldo-, trailer- en continuïteitscontrole
│   ├── import/importer.js  import met dubbeldetectie (atomair)
│   └── model/              schema, sleutels, migraties (schemaVersion)
├── app/service.js          koppelt opslag en logica; schrijft na elke wijziging
├── platform/               File System Access, IndexedDB (enkel de maphandle), handmatige modus
└── ui/                     interface (gewone JavaScript, gevirtualiseerde lijst)
test/                       node --test
tools/                      generatoren voor synthetische testbestanden
build/build.mjs             bundelt alles tot dist/financien.html
```

Bedragen worden nooit als kommagetal berekend. Het databestand bevat een `schemaVersion`; bij een nieuwere app-versie wordt het automatisch gemigreerd, nadat eerst een back-up is gemaakt.
