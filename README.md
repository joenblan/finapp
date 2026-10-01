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

## Ondersteunde formaten

| Formaat | Herkenning | Sleutel tegen dubbels | Saldocontrole |
|---|---|---|---|
| **CODA** (Febelfin, versie 2), van elke Belgische bank | aan de inhoud | rekening + jaar + uittrekselnummer + volgnummer (+ detailnummer) | per uittreksel (oud + bewegingen = nieuw), trailer, opeenvolging van uittreksels |
| **VDK CSV-export** ("verwerkte bewegingen", ingebouwd profiel) | aan de kopregel; het IBAN in de bestandsnaam wordt gecontroleerd | rekening + VDK-refertenummer | saldoketen (saldo na beweging) per rij en over alle exports heen, plus het saldo in de kop |
| **Crelan CSV-export** (bv. `searchMovement.csv`, ingebouwd profiel) | aan de kopregel (de bestandsnaam is generiek) | eigen rekening + datum + bedrag + saldo na verrichting + tegenpartij + mededeling, met telling van voorkomens | saldoketen per rij en over alle exports heen; de rijvolgorde (oudste of nieuwste bovenaan) wordt per bestand uit de saldoketen afgeleid |
| **Andere CSV-exports** | via een eigen profiel uit de koppelingswizard | referentiekolom, of reservesleutel (zie verder) | saldoketen als er een saldokolom is, anders met controlesaldi |

## Bankbestanden toevoegen

Voeg bestanden toe op een van deze manieren:

- **Via de inbox:** kopieer de bestanden naar `inbox/` en open de app, of klik op **Importeren → Nu scannen**.
- **Via slepen of kiezen:** tabblad **Importeren**, sleep de bestanden naar het vak of klik op **Bestanden kiezen…**. Een kopie komt in `archief/`.

Bij elke import:

- **Geen dubbels.** Een identiek bestand (zelfde SHA-256) wordt overgeslagen. Daarnaast heeft elke beweging een unieke sleutel (zie de tabel). Hetzelfde uittreksel of dezelfde beweging twee keer importeren, ook via een ander of overlappend bestand, levert nooit dubbele transacties op.
- **Niets wordt overschreven.** Bestaat een beweging al met *andere* gegevens (bedrag, datum, saldo…), dan wordt het hele bestand geweigerd en krijg je een duidelijke foutmelding.
- **Saldocontrole.** Een bestand waarvan de saldi niet kloppen, wordt **niet** geïmporteerd. Het gaat naar `fout/` met een rapport.
- **Continuïteit.** Ontbrekende uittreksels (CODA) of een onderbroken saldoketen (CSV) worden gemeld, met de periode waarin het gat zit, bij de import en op de rekeningkaart.
- **Atomair.** Een bestand wordt volledig of helemaal niet geïmporteerd.

Rekeningen worden automatisch aangemaakt op basis van het eigen IBAN. Via **Rekeningen → Instellingen** kies je:
- een weergavenaam;
- het type: zicht- of spaarrekening;
- het eigendom: individueel of gemeenschappelijk, met de namen van de mede-eigenaars.

Bij een VDK-export worden de velden `Soort` en `Naam` als voorstel gebruikt. Eén rekening krijgt haar gegevens uit één soort bron: CODA en CSV voor dezelfde rekening mengen kan niet, omdat de sleutels verschillen.

### VDK: hoe exporteer je best?

1. Exporteer in je online banking de **verwerkte bewegingen** als CSV, **zonder filter**. Een export met "Filter actief: Ja" wordt geweigerd, omdat er dan bewegingen ontbreken en de saldoketen niet sluit.
2. Kies telkens een periode die **licht overlapt** met de vorige export, bijvoorbeeld een week terug. De overlap kost niets: gekende bewegingen worden herkend aan hun VDK-refertenummer en niet opnieuw toegevoegd. Dankzij de overlap kan de app controleren dat er niets tussen twee exports ontbreekt.
3. Laat de bestandsnaam zoals de bank hem geeft (`verwerkte_bewegingen_<IBAN>_<datum>.csv`). Zet het bestand in `inbox/` of sleep het naar het tabblad **Importeren**.

Belangrijke details:

- **Aanvulling.** Recente bewegingen staan nog niet op een uittreksel: `Jaar uittreksel` en `Nummer uittreksel` zijn leeg. Bij een latere export worden die lege velden van de bestaande beweging **aangevuld**. Er wordt nooit een gevuld veld overschreven. Wat jij zelf toevoegt (categorieën, markeringen, notities) staat apart en wordt door een import nooit aangeraakt.
- **Boekingsvolgorde.** De volgorde in het bestand is de echte boekingsvolgorde, ook bij meerdere bewegingen op één dag. Ze wordt per rekening bewaard en de lijsten volgen ze; er wordt nooit enkel op datum gesorteerd.
- **Kaartbetalingen** ("Visa Debit betaling"): handelaar, gemeente en betaaltijdstip worden uit de mededeling gehaald en de handelaar wordt als tegenpartij getoond. Het (gemaskeerde) kaartnummer wordt nooit getoond.

### Crelan

1. Exporteer de bewegingen van de rekening als CSV, één rekening per bestand, en kies ook hier telkens een periode die licht overlapt met de vorige export. De bestandsnaam maakt niet uit.
2. Zet het bestand in `inbox/` of sleep het naar **Importeren**.

Hoe de app een Crelan-export leest:

- **Volgorde:** de app bepaalt zelf of de oudste of de nieuwste beweging bovenaan staat, door de saldoketen in beide richtingen te controleren. Sluit de keten in geen enkele richting, dan wordt het bestand geweigerd. Bij een bestand met één rij wordt "oudste bovenaan" aangenomen; het importrapport vermeldt de gevonden volgorde.
- **Eigen rekening:** die staat op elke rij (`Rekening opdrachtgever`). Staan er verschillende eigen rekeningen in één bestand, dan wordt het geweigerd.
- **Bedragen:**
  - de punt is het decimaalteken (`.95`, `-.05`, `1.00`);
  - een komma wordt alleen aanvaard als duizendtalscheiding in groepen van drie (`1,600.00`);
  - elk ander bedrag met een komma of met meerdere punten breekt de import af met een duidelijke melding.
- **Dubbels:** Crelan heeft geen refertenummer. Een beweging wordt herkend aan eigen rekening + datum + bedrag + saldo na verrichting + tegenpartij + mededeling. Twee identieke betalingen op dezelfde dag blijven allebei behouden, want het saldo erna verschilt. Een nieuwe beweging met dezelfde datum, hetzelfde bedrag en saldo maar andere tekst dan een bestaande komt bij **Nakijken** als mogelijke dubbel.
- **Kaartbetalingen:** handelaar en gemeente worden gesplitst en de handelaar wordt als tegenpartij getoond. Het betaaltijdstip wordt bewaard; het kaartnummer wordt nooit getoond.
- **Andere munt dan EUR:** de beweging wordt zonder omrekening geïmporteerd en verschijnt bij **Nakijken → Andere munt**. Ze telt niet mee in sommen in euro.
- **Nieuwe rekening:** bij de eerste import wordt ze als zichtrekening voorgesteld. Op de rekeningkaart bevestig je het type en het eigendom (individueel of gemeenschappelijk, met de mede-eigenaars).

### Koppelingswizard (andere CSV-formaten)

Voor een CSV-export van een bank zonder ingebouwd profiel:

1. Ga naar **CSV-profielen** en kies het bestand in de koppelingswizard. Probeer je zo'n bestand eerst te importeren, dan meldt de importgeschiedenis "Onbekend bestandsformaat" met een knop naar de wizard.
2. Je ziet de eerste regels van het bestand. Controleer het scheidingsteken, de kopregel, het decimaalteken, het datumformaat en de volgorde (nieuwste of oudste beweging bovenaan).
3. Kies per veld de juiste kolom:
   - boekingsdatum, valutadatum;
   - bedrag in één kolom, of aparte debet- en creditkolommen;
   - tegenpartij-IBAN en -naam, mededeling;
   - saldo na beweging, referentie, soort beweging…
   - Geef ook aan waar je eigen IBAN staat: bovenaan in het bestand, in een kolom, of zelf in te vullen.
4. Onderaan zie je meteen een **voorbeeld van het resultaat** met eventuele fouten, inclusief de saldoketen als er een saldokolom is.
5. Geef het profiel een naam en klik op **Profiel bewaren en bestand importeren**. Volgende bestanden met dezelfde kolommen worden voortaan automatisch herkend.

Heeft een formaat **geen referentiekolom**, dan herkent de app dubbels aan de combinatie datum + bedrag + tegenpartij-IBAN + mededeling. Twee legitiem identieke bewegingen op dezelfde dag (bv. twee keer koffie) blijven allebei behouden: de app telt hoe vaak de combinatie in het bestand voorkomt.

Heeft een formaat **geen saldokolom**, voeg dan controlesaldi toe via **Rekeningen → Instellingen → Controlesaldi**: "saldo op datum X volgens de bank", bijvoorbeeld van een papieren uittreksel. De app toont of het berekende saldo klopt. Controlesaldi kan je ook bij andere rekeningen gebruiken.

### Wat betekent "mogelijke dubbel"?

Komt er een **nieuwe** beweging binnen met een ander refertenummer, maar met dezelfde datum, hetzelfde bedrag, dezelfde tegenpartij en dezelfde mededeling als een bestaande beweging, dan:

- wordt ze **toch geïmporteerd**, want de bank vermeldt ze als aparte beweging;
- verschijnt ze in het tabblad **Nakijken**, met beide bewegingen naast elkaar.

Kies **Behouden** als het om twee echte betalingen gaat (bv. twee keer hetzelfde abonnement), of **Nieuwe beweging verwijderen** als het een vergissing is. Een verwijderde beweging verdwijnt uit de lijsten en komt bij een volgende import nooit terug. Vóór het verwijderen wordt een back-up gemaakt.

Synthetische voorbeeldbestanden (fictieve gegevens) maak je met `npm run sample`; ze komen in `voorbeelden/`:
- een CODA-bestand met 2 rekeningen;
- een VDK-export;
- een Crelan-export (`searchMovement.csv`);
- in `voorbeelden/fase2/` een samenhangende set: twee individuele rekeningen (VDK en CODA) en één gemeenschappelijke rekening (Crelan), met overboekingen ertussen.

Met `npm run sample -- --groot` maak je ook een CODA-testbestand met 20.000 transacties.

## Categorieën, regels en overzicht

### Categorieën
- **Twee niveaus:** een hoofdcategorie met subcategorieën. Elke categorie heeft een soort: **inkomst**, **uitgave** of **neutraal**. Neutrale categorieën tellen niet mee als inkomst of uitgave, bijvoorbeeld *Sparen & beleggen*, *Interne overboeking* en *Bijdrage mede-eigenaar*.
- **Standaardset met Belgische invulling:** Wonen (o.a. woonkrediet, onroerende voorheffing, energie, water, internet & telecom), Boodschappen, Mobiliteit, Verzekeringen, Gezondheid (o.a. mutualiteit), Abonnementen, Vrije tijd, Belastingen, Sparen & beleggen, Inkomen (o.a. loon, groeipakket, terugbetalingen) en Overig.
- **Beheer:** onder **Instellingen › Categorieën** kan je categorieën toevoegen, hernoemen, samenvoegen en verwijderen. Bij verwijderen of samenvoegen kies je naar welke categorie de transacties en regels gaan.
- **Opslag:** de categorie zit niet in de transactie zelf, maar in een aparte koppeling (transactie → categorie + bedrag), met de bron: *manueel*, *regel* of *geen*. Zo kan een transactie later over meerdere categorieën gesplitst worden.

### Regels
- **Voorwaarden:** onder **Instellingen › Regels** stel je in: tegenpartij-IBAN, naam bevat, mededeling bevat, richting (in/uit), bedrag tussen min en max, rekening. Alle ingevulde voorwaarden moeten kloppen; tekst wordt vergeleken zonder onderscheid tussen hoofd- en kleine letters.
- **Volgorde:** regels staan in een volgorde en de **eerste regel die past, wint**. Met ↑/↓ wijzig je die volgorde.
- **Bij import:** regels worden automatisch toegepast op nieuwe transacties. **Regels opnieuw toepassen** doet het voor alle bestaande transacties.
- **Manuele keuze:** wordt nooit door een regel overschreven.
- **Voorrang:** interne overboekingen en bijdragen van de mede-eigenaar gaan altijd voor op je eigen regels.
- **Regel maken:** na een manuele toewijzing biedt de app aan om er een regel van te maken, met voorgestelde voorwaarden. Vóór het bewaren zie je hoeveel bestaande transacties de regel zou raken.

### Te categoriseren
Het tabblad **Te categoriseren** toont alle transacties zonder categorie, de nieuwste eerst. Bediening met het toetsenbord:
- typ om een categorie te zoeken, kies met ↑/↓ en bevestig met **Enter**; de app gaat meteen door naar de volgende transactie;
- **Ctrl+↓** en **Ctrl+↑** gaan naar de volgende of vorige transactie;
- **Ctrl+Spatie** selecteert een transactie, ook vinkjes en "Alles selecteren" werken. Met een selectie wijst Enter de categorie aan alle geselecteerde transacties toe.

### Interne overboekingen
- **Wanneer intern:** een transactie is intern als de tegenpartij-IBAN een eigen rekening is. Eigen rekeningen zijn alle geïmporteerde rekeningen, plus de lijst onder **Instellingen › Eigen rekeningen & mijn naam › Eigen rekeningen zonder bankbestanden**, bijvoorbeeld een spaarrekening bij een andere bank.
- **Gevolg:** interne overboekingen krijgen automatisch de neutrale categorie *Interne overboeking* en tellen niet mee als inkomst of uitgave.
- **Tegenhanger:** bij een overboeking tussen twee geïmporteerde rekeningen worden beide kanten gekoppeld (tegengesteld bedrag, datums hoogstens 5 dagen uit elkaar). De tegenhanger staat bij de transactie. Een ontbrekende tegenhanger is geen fout.
- **Ongedaan maken:** per transactie, met **Geen interne overboeking**.

### Gemeenschappelijke rekening: voorschotten en terugbetalingen
- Stel eerst in wie jij bent (**Mijn naam**, een van de mede-eigenaars).
- **Markeren:** in het transactiedetail markeer je een transactie als:
  - **voorschot**: je betaalt vanaf je individuele rekening een gemeenschappelijke kost, of de gemeenschappelijke rekening betaalt een persoonlijke kost van een mede-eigenaar;
  - **terugbetaling**: de verrekening daarvan, eventueel gekoppeld aan één of meer voorschotten.
- **Categorie blijft:** de transactie behoudt haar gewone categorie.
- **Lopend saldo:** het tabblad **Gemeenschappelijk** toont per mede-eigenaar het saldo ten opzichte van de gemeenschappelijke pot ("de pot is Jan € 40 verschuldigd", "An is de pot € 30 verschuldigd"), met de openstaande posten.
- **Bijdrage mede-eigenaar:** vul per gemeenschappelijke rekening de IBAN('s) van de mede-eigenaar in. Stortingen vanaf die rekeningen krijgen dan automatisch *Bijdrage mede-eigenaar* (neutraal, geen inkomen).

### Overzicht
- **Tabel:** het tabblad **Overzicht** toont een tabel met categorieën als rijen en maanden als kolommen, met inkomsten, uitgaven en het saldo apart, telkens met totalen.
- **Filters:** op periode, en op alle rekeningen, één rekening, enkel individuele of enkel gemeenschappelijke rekeningen.
- **Uitgesloten van de totalen:** interne overboekingen, neutrale categorieën en bewegingen in een andere munt.
- **Transacties zonder categorie** staan in de rij "Niet gecategoriseerd", opgesplitst in inkomsten en uitgaven.
- **Doorklikken:** een klik op een bedrag toont de onderliggende transacties.

## Back-ups

- Vóór elke import, vóór het verwijderen van een mogelijke dubbel, vóór een migratie naar een nieuwere schemaversie en vóór elke teruggezette back-up bewaart de app een kopie van `financien-data.json` in `backups/`, met een tijdstempel in de naam. Standaard blijven de laatste 30 bewaard.
- **Back-up terugzetten:** tabblad **Back-ups**, klik bij de gewenste back-up op **Back-up terugzetten**. De huidige toestand wordt eerst zelf als back-up bewaard, dus terugzetten is altijd ongedaan te maken.
- Je kan ook manueel een back-up terugzetten: sluit de app, kopieer het gewenste bestand uit `backups/` naar `financien-data.json` in de datamap en open de app opnieuw.

## Broncode

```
src/
├── main.js                 opstarten: map kiezen/herstellen, inbox scannen
├── core/                   pure logica zonder DOM (volledig getest in Node)
│   ├── money.js            bedragen als gehele getallen in duizendsten van een euro
│   ├── coda/               CODA-parser (records 0, 1, 21-23, 31-33, 4, 8, 9)
│   ├── csv/                CSV-lezer, Belgische notaties, bankprofielen (VDK), kaartbetalingen, wizardhulp
│   ├── checks/             saldo-, trailer-, continuïteits- en saldoketencontrole, controlesaldi
│   ├── categories/         categorieën (standaardset), regels, toewijzing (manueel/regel/geen)
│   ├── transfers.js        eigen rekeningen, interne overboekingen, koppeling van beide kanten
│   ├── joint.js            voorschotten/terugbetalingen, lopend saldo per mede-eigenaar
│   ├── report-categories.js overzicht categorie × maand
│   ├── import/             één importingang (importer.js) met een CODA- en een CSV-strategie
│   └── model/              schema, sleutels, migraties (schemaVersion)
├── app/service.js          koppelt opslag en logica; schrijft na elke wijziging
├── platform/               File System Access, IndexedDB (enkel de maphandle), handmatige modus
└── ui/                     interface (gewone JavaScript, gevirtualiseerde lijst)
test/                       node --test
tools/                      generatoren voor synthetische testbestanden
build/build.mjs             bundelt alles tot dist/financien.html
```

Bedragen worden nooit als kommagetal berekend. Het databestand bevat een `schemaVersion`; bij een nieuwere app-versie wordt het automatisch gemigreerd, nadat eerst een back-up is gemaakt.
