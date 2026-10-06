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

**Build op GitHub.** Bij elke push voert GitHub Actions de tests uit en bouwt het `financien.html`. Je vindt het als artefact *financien-html* bij de run, onder het tabblad **Actions**. Bij een tag `v…` komt het ook bij een release.

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
| **MeDirect PDF-rekeningafschrift** (ingebouwd) | aan de inhoud van de PDF (MeDirect + de tabel Datum / Valuta Datum / Omschrijving / Bedrag / Saldo) | eigen rekening + datum + bedrag + saldo na beweging + soort beweging, met telling van voorkomens | beginsaldo + inkomend − uitgaand = eindsaldo, de bewegingen tegen de totalen van het afschrift, en de saldoketen per rij en over alle afschriften heen |
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

### MeDirect (PDF-rekeningafschrift)
- **Exporteren:** download in MeDirect het rekeningafschrift als PDF, bij voorkeur over je volledige historiek of een ruime periode. Zet de PDF in `inbox/` of sleep hem op **Importeren**. Een volgend afschrift mag overlappen: enkel nieuwe bewegingen worden toegevoegd.
- **Waarom PDF en niet CSV?** De CSV van MeDirect bevat geen eigen rekeningnummer, geen IBAN van de tegenpartij en geen referentie. De PDF bevat die wel.
- **Wat wordt gelezen:**
  - uit de kop: het eigen IBAN, de naam en het type rekening (zicht- of spaarrekening);
  - per beweging: de datums, de soort beweging, het bedrag, het saldo, de mededeling, de tegenpartij (naam + IBAN) en de referentie;
  - bij kaartbetalingen: de handelaar, de aankoopdatum (het jaar volgt uit de boekingsdatum), het gemaskeerde kaartnummer, en bij een andere munt het oorspronkelijke bedrag, de wisselkoers en de marge.
- **Andere munt:** het geboekte bedrag is altijd in euro. Zo'n betaling komt dus **niet** bij "Andere munt" in Nakijken. Het bedrag in de andere munt en de koers staan bij de transactie.
- **Controles:**
  - beginsaldo + inkomend − uitgaand moet het eindsaldo zijn;
  - de som van de gelezen bewegingen moet overeenkomen met de totalen op het afschrift;
  - elk saldo moet volgen uit het vorige.

  Mislukt één controle, dan werd iets niet goed gelezen en wordt het afschrift niet geïmporteerd.
- **Interne overboekingen:** overschrijvingen tussen je MeDirect-rekeningen en naar je andere rekeningen worden herkend aan het IBAN. Importeer ook je tweede MeDirect-rekening, of zet ze bij **Instellingen › Eigen rekeningen**.
- **Hoe:** de PDF wordt volledig in de app gelezen, zonder externe bibliotheek. Gescande PDF's (afbeeldingen) en versleutelde PDF's worden niet ondersteund.

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
- in `voorbeelden/fase2/` een samenhangende set: twee individuele rekeningen (VDK en CODA) en één gemeenschappelijke rekening (Crelan), met overboekingen ertussen;
- in `voorbeelden/fase3/` 13 maanden van een individuele VDK-rekening en een gemeenschappelijke Crelan-rekening: loon, bestendige opdracht, abonnementen (met een prijsstijging), een jaarlijkse kost en variabele uitgaven.

Met `npm run sample -- --groot` maak je ook een CODA-testbestand met 20.000 transacties.

### Transacties zoeken en filteren
- **Filters:** het tabblad **Transacties** filtert op rekening, periode, zoekterm (naam, IBAN, mededeling…), bedrag en **Richting**: *Alles*, *Inkomsten* (bedrag > 0) of *Uitgaven* (bedrag < 0).
- **Interne overboekingen en neutrale categorieën verbergen:** overboekingen tussen je eigen rekeningen en bv. sparen weglaten. Deze schakelaar gaat vanzelf aan als je *Inkomsten* of *Uitgaven* kiest, en je kan hem weer uitzetten. Bijdragen tussen een persoonlijke en een gemeenschappelijke rekening blijven zichtbaar, want die tellen als inkomst of uitgave.
- **Bovenaan de lijst** staan het aantal transacties en het totaalbedrag van de selectie. Bewegingen in een andere munt worden niet mee opgeteld.
- **Onthouden:** de gekozen richting blijft bewaard tot je de app sluit, ook als je via **Rekeningen** de transacties van één rekening opent.

## Categorieën, regels en overzicht

### Categorieën
- **Twee niveaus:** een hoofdcategorie met subcategorieën. Elke categorie heeft een soort: **inkomst**, **uitgave** of **neutraal**. Neutrale categorieën tellen niet mee als inkomst of uitgave, bijvoorbeeld *Sparen & beleggen* en *Interne overboeking*.
- **Standaardset met Belgische invulling:** Wonen (o.a. woonkrediet, onroerende voorheffing, energie, water, internet & telecom), Boodschappen, Mobiliteit, Verzekeringen, Gezondheid (o.a. mutualiteit), Abonnementen, Vrije tijd, Belastingen, Sparen & beleggen, Inkomen (o.a. loon, groeipakket, terugbetalingen) en Overig.
- **Beheer:** onder **Instellingen › Categorieën** kan je categorieën toevoegen, hernoemen, samenvoegen en verwijderen. Bij verwijderen of samenvoegen kies je naar welke categorie de transacties en regels gaan.
- **Opslag:** de categorie zit niet in de transactie zelf, maar in een aparte koppeling (transactie → categorie + bedrag), met de bron: *manueel*, *regel* of *geen*. Zo kan een transactie later over meerdere categorieën gesplitst worden.

### Regels
- **IBAN tegenpartij:** in het veld *Tegenpartij-IBAN* kies je uit een lijst met alle IBAN's van je tegenpartijen, met de naam erbij en hoe vaak ze voorkomen (de meest gebruikte bovenaan). Typen kan ook.
- **Voorwaarden:** onder **Instellingen › Regels** stel je in: tegenpartij-IBAN, naam bevat, mededeling bevat, richting (in/uit), bedrag tussen min en max, rekening. Alle ingevulde voorwaarden moeten kloppen; tekst wordt vergeleken zonder onderscheid tussen hoofd- en kleine letters.
- **Volgorde:** regels staan in een volgorde en de **eerste regel die past, wint**. Met ↑/↓ wijzig je die volgorde.
- **Bij import:** regels worden automatisch toegepast op nieuwe transacties. **Regels opnieuw toepassen** doet het voor alle bestaande transacties.
- **Manuele keuze:** wordt nooit door een regel overschreven.
- **Voorrang:** interne overboekingen en bijdragen naar of op de gemeenschappelijke rekening gaan altijd voor op je eigen regels.
- **Regel maken:** na een manuele toewijzing biedt de app aan om er een regel van te maken, met voorgestelde voorwaarden. Vóór het bewaren zie je hoeveel bestaande transacties de regel zou raken.

### Te categoriseren
Het tabblad **Te categoriseren** toont alle transacties zonder categorie, de nieuwste eerst. Bediening met het toetsenbord:
- typ om een categorie te zoeken, kies met ↑/↓ en bevestig met **Enter**; de app gaat meteen door naar de volgende transactie;
- **Ctrl+↓** en **Ctrl+↑** gaan naar de volgende of vorige transactie;
- **Ctrl+Spatie** selecteert een transactie, ook vinkjes en "Alles selecteren" werken. Met een selectie wijst Enter de categorie aan alle geselecteerde transacties toe.

### Interne overboekingen
- **Wanneer intern:** een transactie is intern als de tegenpartij-IBAN een eigen rekening is. Eigen rekeningen zijn alle geïmporteerde rekeningen, plus de lijst onder **Instellingen › Eigen rekeningen › Eigen rekeningen zonder bankbestanden**, bijvoorbeeld een spaarrekening bij een andere bank.
- **Gevolg:** interne overboekingen krijgen automatisch de neutrale categorie *Interne overboeking* en tellen niet mee als inkomst of uitgave.
- **Uitzondering, bijdragen aan de gemeenschappelijke rekening:** een overboeking tussen een individuele en een gemeenschappelijke rekening is geen neutrale interne overboeking. Op je eigen rekening krijgt ze *Bijdrage gemeenschappelijke rekening* (uitgave), op de gemeenschappelijke rekening *Bijdrage van eigen rekening* (inkomst). Zo klopt het overzicht van elke rekening. Een overboeking in de andere richting vermindert die uitgave en inkomst. Verander je het eigendom van een rekening, dan worden deze categorieën meteen bijgewerkt.
- **Tegenhanger:** bij een overboeking tussen twee geïmporteerde rekeningen worden beide kanten gekoppeld (tegengesteld bedrag, datums hoogstens 5 dagen uit elkaar). De tegenhanger staat bij de transactie. Een ontbrekende tegenhanger is geen fout.
- **Ongedaan maken:** per transactie, met **Geen interne overboeking**.

### Bijdragen en terugbetalingen
- **Bijdrage mede-eigenaar:** vul per gemeenschappelijke rekening onder **Instellingen › Eigen rekeningen** de IBAN('s) van de mede-eigenaar in. Stortingen vanaf die rekeningen krijgen dan automatisch *Bijdrage mede-eigenaar* (inkomst).
- **Terugbetaling koppelen aan de uitgave:** betaalde jij bv. een etentje van € 60 en stort een vriend € 30 terug? Open die terugbetaling bij **Transacties** en klik **Koppelen aan uitgave(n)…**. Kies de uitgave; zoeken op naam, mededeling of bedrag kan.
  - De terugbetaling krijgt dan dezelfde categorie als de uitgave en telt daar als min-uitgave (netto € 30), ook in budget en vrije ruimte.
  - Verander je later de categorie van de uitgave, dan volgt de terugbetaling mee.
  - **Eén terugbetaling voor meerdere uitgaven** (bv. een vriend betaalt in één keer zijn deel van een etentje én een concertticket): voeg in het koppelvenster meerdere uitgaven toe. De app verdeelt het bedrag automatisch: elke uitgave krijgt maximaal wat er nog open staat, de laatste de rest. Je kan elk deel aanpassen; samen moeten ze de terugbetaling vormen. Elk deel telt in de categorie van zijn uitgave, ook in budget en vrije ruimte. Met **Koppeling wijzigen…** pas je het later aan.
  - Meerdere terugbetalingen per uitgave mogen ook.
  - **Eerst de terugbetaling, dan de uitgave?** Dat kan ook. Bij een terugbetaling staan uitgaven tot 90 dagen later in de lijst. Je kan ook vertrekken van de uitgave: klik daar **Terugbetaling koppelen…** en kies de ontvangst, ook als die eerder binnenkwam. Bij de uitgave zie je wat er terugbetaald werd en het netto bedrag, met een waarschuwing als er meer terugbetaald werd dan de uitgave.
  - **Losmaken** zet de terugbetaling terug op automatisch.
  - Gekoppelde terugbetalingen staan niet bij "Te categoriseren": ze volgen de uitgave.
- **Terugbetalingen tussen jou en de gemeenschappelijke rekening:** een overschrijving tussen een persoonlijke en een gemeenschappelijke rekening is standaard een bijdrage. Is het eigenlijk een terugbetaling, dan beslis je zelf:
  - *De gemeenschappelijke rekening betaalt jou terug* voor iets dat jij voor het huishouden betaalde: koppel de ontvangst op je eigen rekening aan je uitgave, en geef de betaling op de gemeenschappelijke rekening de categorie van die kost (bv. *Boodschappen*).
  - *Jij betaalt de gemeenschappelijke rekening terug* voor iets persoonlijks dat met de gemeenschappelijke rekening betaald werd: koppel de ontvangst op de gemeenschappelijke rekening aan die uitgave, en geef je eigen betaling de categorie van die aankoop.
  - Doet je partner dat vanaf een rekening die je niet importeert, dan koppel je alleen de ontvangst op de gemeenschappelijke rekening.

  Een zelf gekozen categorie of een koppeling gaat altijd voor op *Bijdrage*, ook in budget en vrije ruimte.
- **Niet gekoppeld:** gebruik *Inkomen › Terugbetaling vrienden & familie* (inkomst), bijvoorbeeld via een regel op de IBAN van je vriend. *Inkomen › Terugbetalingen (mutualiteit, belastingen…)* is voor terugbetalingen van instanties.

### Overzicht
- **Tabel:** het tabblad **Overzicht** toont een tabel met categorieën als rijen en maanden als kolommen, met inkomsten, uitgaven en het saldo apart, telkens met totalen.
- **Persoonlijk en Gemeenschappelijk apart:** het overzicht heeft twee tabbladen. Je bijdrage aan de gemeenschappelijke rekening is een uitgave aan de persoonlijke kant en een inkomst aan de gemeenschappelijke kant. Zo klopt elke kant op zich en wordt niets dubbel geteld.
- **Filters:** op periode, en binnen een kant op alle rekeningen of één rekening.
- **Uitgesloten van de totalen:** interne overboekingen, neutrale categorieën en bewegingen in een andere munt.
- **Transacties zonder categorie** staan in de rij "Niet gecategoriseerd", opgesplitst in inkomsten en uitgaven.
- **Doorklikken:** een klik op een bedrag toont de onderliggende transacties.

## Budget, vaste betalingen en prognose

Het tabblad **Start** (standaard bij openen) toont:
- per perspectief de vrije ruimte van de lopende periode;
- de openstaande waarschuwingen, af te vinken;
- het laagste verwachte saldo;
- de eerstvolgende vaste betalingen.

### Perspectieven en periodes
- **Persoonlijk:** al je individuele rekeningen.
  - De vrije ruimte rekent met de zichtrekeningen.
  - Een overboeking naar de gemeenschappelijke rekening telt als vaste kost "Bijdrage gemeenschappelijke rekening".
  - Een overboeking naar een eigen spaarrekening telt als **sparen**: dat is geen uitgave, maar het geld is ook niet vrij te besteden.
- **Gemeenschappelijk:** de gemeenschappelijke rekening(en). Je eigen bijdragen en die van de mede-eigenaar zijn hier het inkomen.
- **Neutraal:** overboekingen tussen rekeningen binnen hetzelfde perspectief blijven neutraal. Het **Overzicht** uit fase 2 blijft ongewijzigd.
- **Periode:** per perspectief stel je onder **Budget** in welke periode geldt.
  - **Loonperiode** (standaard voor Persoonlijk): van de dag dat het loon binnenkomt (categorie *Inkomen › Loon*) tot de dag vóór het volgende loon. Is het volgende loon er nog niet, dan gebruikt de app de verwachte loondatum uit de vaste betalingen, en anders de laatste dag van de maand (instelbaar onder **Instellingen › Budget & detectie**).
  - **Kalendermaand** (standaard voor Gemeenschappelijk).

### Vaste kosten, budgetten en vrije ruimte
- **Budgettype:** elke categorie heeft er een: *vast*, *variabel* of *sparen*, in te stellen onder **Instellingen › Categorieën**. Woonkosten, verzekeringen, abonnementen en belastingen staan standaard op vast.
- **Vrije ruimte** = verwacht inkomen − vaste kosten − sparen − al uitgegeven variabele kosten.
  - **Vaste kosten:** een vaste kost die deze periode al betaald is, telt met het werkelijke bedrag. Een nog niet betaalde telt met het verwachte bedrag uit de vaste betalingen. Zo wordt er nooit dubbel geteld.
  - **Sparen:** het geplande bedrag per periode, of de werkelijke overboekingen als die groter zijn.
  - **Zonder categorie:** uitgaven zonder categorie tellen als variabel.
- **Lopende periode:** je ziet het totaal vrij te besteden, wat al uitgegeven is, wat nog beschikbaar is en hoeveel dat per resterende dag is. Vorige periodes staan eronder ter vergelijking.
- **Budgetten:** per categorie en per periode, met een voortgangsbalk en een waarschuwing bij 80 % en 100 %.

### Vaste betalingen (terugkerende betalingen)
- **Detectie:** de app zoekt zelf naar terugkerende betalingen en ontvangsten.
  - Per tegenpartij (IBAN, of anders de naam of handelaar) en richting.
  - Wekelijks, maandelijks, per kwartaal of jaarlijks, met een tolerantie op de dag.
  - Bedragen mogen ± 10 % variëren (instelbaar). Minstens 3 keer gezien, 2 voor jaarlijks.
  - Willekeurige aankopen bij dezelfde winkel worden niet als reeks gezien.
  - *Bestendige opdracht* en *domiciliëring* verhogen de zekerheid.
  - Meerdere betalingen op dezelfde dag aan dezelfde tegenpartij (bv. een woonkrediet dat in twee delen wordt gedebiteerd) worden aparte reeksen. Een nieuwe betaling gaat naar de reeks met het best passende bedrag.
- **Voorstellen:** gevonden reeksen verschijnen als voorstel. **Bevestigen**, **Weigeren** (komt niet terug) of **Aanpassen** (interval, dag, verwacht bedrag, categorie). Manueel toevoegen kan ook, bijvoorbeeld voor een jaarlijkse kost zonder historiek.
- **Categorie:** een reeks neemt de categorie van haar transacties over, tenzij je ze zelf hebt ingesteld met **Aanpassen**.
- **Lijst:** per reeks de tegenpartij, het interval, het laatste bedrag, de volgende verwachte datum en het bedrag, de jaarkost en het maandequivalent.
- **Waarschuwingen** (op Start, af te vinken):
  - prijsstijging: meer dan 5 % én minstens € 1;
  - nieuwe reeks gevonden;
  - verwachte betaling uitgebleven: 5 dagen na de verwachte datum, gemeten tot de datum waarop je gegevens van die rekening eindigen;
  - reeks lijkt gestopt.
- **Bij import:** elke import werkt de reeksen en waarschuwingen bij.

### Prognose
- **Keuze:** per rekening of per perspectief, voor 3, 6 of 12 maanden: het verwachte saldo per dag.
- **Basis:**
  - het actuele saldo;
  - de bevestigde vaste betalingen op hun verwachte datums;
  - eenmalige verwachte posten die je zelf toevoegt (vakantie, grote aankoop…);
  - de verwachte variabele uitgaven per periode: het gemiddelde van de laatste 3 periodes, of het budget, gelijk gespreid over de dagen.
- **Laagste saldo:** het laagste verwachte saldo met datum wordt getoond. Zakt het onder het minimumsaldo van een rekening (standaard € 0), dan krijg je een waarschuwing.
- **Grafiek:** een eenvoudige lijngrafiek in SVG, zonder externe bibliotheek. Beweeg erover voor datum, saldo en de posten van die dag.

## Woonkrediet en vermogen

### Woonkrediet invoeren
Tabblad **Woonkrediet** › **Nieuwe lening**. Vul in:
- naam, de rekening waarvan afbetaald wordt, en de kredietgever (IBAN en/of naam: daarmee worden de afbetalingen herkend);
- de kredietnemers met hun aandeel (bv. `Jan 50; An 50`), voor het persoonlijk vermogen;
- optioneel de datum van opname (leeg = 1 maand vóór de eerste afbetaling) en de woning;
- per **deelkrediet**: ontleend bedrag, jaarrente (vaste rente), looptijd in maanden, datum van de eerste afbetaling, afbetalingsdag, het type (vaste maandlast of constante kapitaalaflossing) en de rentemethode (jaarrente gelijkwaardig, jaarrente nominaal, of de periodieke maandrente van je kredietakte).

**Rentemethode.** Belgische banken rekenen meestal met de *gelijkwaardige maandrente* (1 + j)^(1/12) − 1. Sommige gebruiken de *nominale maandrente* j/12. Onder het formulier zie je meteen de eerste afbetaling. Vergelijk die met je aflossingstabel van de bank. Klopt ze niet, dan staat ernaast wat de andere methode zou geven.

Staat op je kredietakte een **periodieke rentevoet per maand** (bv. *0,21 %*), kies dan **Periodieke maandrente** en vul die maandrente in. Ze wordt dan exact gebruikt, zonder omrekening. Een periodieke maandrente van 0,21 % is hetzelfde als een nominale jaarrente van 2,52 %.

**Afgeronde rente op de akte.** Soms toont de akte een afgeronde rente, bijvoorbeeld 0,21 % terwijl de echte maandrente 0,2065 % is. De berekende maandlast wijkt dan af van die van de bank. Vul dan bij het deelkrediet de **Maandlast volgens bank** in en klik **Rente berekenen**. De app zoekt de exacte maandrente die bij bedrag, looptijd en maandlast past, en vult die in. Voorbeeld: € 300.000 op 300 maanden met maandlast € 1.342,52 geeft een maandrente van 0,20649516 %.

Een nieuwe lening is eerst een **concept**. Pas na **Bevestigen** telt ze mee in budget, prognose, vermogen en startpagina.

**Berekening.** Alles gebeurt met exacte gehele getallen (de rente met vaste komma op 40 decimalen, nooit met kommagetallen). De maandlast en de interest per maand worden half-naar-boven afgerond op de cent. De interest wordt berekend op het openstaande saldo. Het kapitaal is de afbetaling min de interest. De laatste afbetaling lost het volledige restsaldo af, zodat de tabel exact op € 0,00 eindigt. Voorbeeld: € 200.000 aan 3 % op 300 maanden met gelijkwaardige maandrente geeft een maandlast van € 944,22 en een totale interest van € 83.264,84.

### Opvolging
- **Opvolging afbetalingen:** per vervaldag zoekt de app een betaling aan de kredietgever op de afbetalingsrekening, binnen 5 dagen van de vervaldag. Worden deelkredieten apart gedebiteerd, dan wordt per deelkrediet gekoppeld.
- **Status per vervaldag:** *betaald*, *afwijkend bedrag* (met het verschil), *openstaand* (niet gevonden en meer dan 5 dagen te laat, gemeten tegen de recentste gegevens van de rekening), *verwacht* of *geen gegevens* (vóór je eerste transactie).
- **Koppeling…:** koppel zelf een of meer transacties, markeer als *niet betaald*, of zet terug op automatisch.
- **Waarschuwingen:** openstaande en afwijkende afbetalingen verschijnen op de startpagina.
- **Aflossingstabel:** de volledige tabel, voor de hele lening en per deelkrediet.
- **Controlepunten:** geef het openstaande saldo volgens de bank in (bv. uit het jaaroverzicht). De app toont het verschil met de berekende tabel.

### Extra aflossing simuleren
Kies datum, deelkrediet, bedrag en *kortere looptijd* of *lagere maandlast*.
- **Wederbeleggingsvergoeding:** standaard 3 maanden interest van dat deelkrediet op het afgeloste bedrag. Je kan een ander aantal maanden of een vast bedrag kiezen.
- **Resultaat:** de vergoeding, de bespaarde interest, het netto voordeel, en de nieuwe einddatum of de nieuwe maandlast.
- **Toepassing:** de extra aflossing gebeurt direct na de laatste afbetaling op of vóór de gekozen datum.
- **Registreren als uitgevoerd:** herberekent de tabel vanaf die datum.

### Koppeling met budget en prognose
- **Vaste kosten en prognose:** de nog niet betaalde afbetalingen van een bevestigde lening tellen als vaste kost (categorie *Wonen › Woonkrediet*) in de vrije ruimte en in de prognose. Dat gebeurt in het perspectief van de afbetalingsrekening.
- **Geen dubbeltelling:** een gedetecteerde vaste betaling naar de kredietgever krijgt het label *gekoppeld aan woonkrediet …* en telt niet apart mee.
- **Gekoppelde betalingen zonder categorie:** die tellen als vaste kost.

### Vermogen
Tabblad **Vermogen**: het nettovermogen per maandeinde (de lopende maand toont de stand van vandaag), als grafiek en als tabel.
- **Rekeningen:** het saldo op het maandeinde, teruggerekend vanaf het huidige saldo. Een rekening zonder gegevens op die datum telt **niet** als € 0: de maand wordt als onvolledig gemarkeerd (*) of de cel blijft leeg (—).
- **Woningen:** de recentste waardering op of vóór de datum. Vóór de eerste waardering telt de woning niet mee.
- **Leningen:** het openstaande kapitaal volgens de tabel, vanaf de opname.
- **Overige bezittingen en schulden:** met een waarde per datum.
- **Perspectieven:**
  - *Huishouden* telt alles voor 100 %.
  - *Persoonlijk* telt individuele rekeningen voor 100 % en gemeenschappelijke rekeningen voor jouw aandeel (standaard 50 %). Woning, lening en overige posten tellen volgens jouw aandeel bij de eigenaars of kredietnemers. Stel onderaan in wie jij bent.
- **Beleggingen:** komen in een latere fase (er is al een lege bron voorzien).

De startpagina toont het vermogen per perspectief met het verschil tegenover het vorige maandeinde, en per lening het openstaande kapitaal en de einddatum.

Voorbeelddata: `voorbeelden/fase4/` (met de in te voeren leninggegevens in `LENING.txt`).

## Beleggingen, pensioensparen en fiscaal jaaroverzicht

Alle fiscale resultaten zijn **indicatief, controleer met je bank of de officiële bronnen**. Koersen worden nooit online opgehaald.

### Fiscale parameters
**Instellingen › Fiscale parameters**, per inkomstenjaar:
- beurstakstarieven met hun maximum (standaard 0,12 % max € 1.300, 0,35 % max € 1.600, 1,32 % max € 4.000);
- meerwaardebelasting: startdatum, referentiedatum, einde overgangsregel, vrijstelling (€ 10.000), tarief (10 %), of kosten en taks fiscaal meetellen (standaard niet), en of minwaarden onder Reynderstaks aftrekbaar zijn (standaard ja, indicatief);
- pensioensparen: basisplafond € 1.050 aan 30 %, verhoogd plafond € 1.350 aan 25 %, waarschuwen vanaf 1 december;
- na hoeveel dagen een koers verouderd is (35).

Een jaar zonder eigen parameters gebruikt die van het laatste vorige jaar. In de rekenlogica zit geen enkel tarief of plafond.

### Beleggingsrekeningen en effecten
Tabblad **Beleggingen › Rekeningen & effecten**.
- **Beleggingsrekening:** naam, instelling, eigenaar, en de cash. Ofwel een **afrekenrekening** (een bankrekening uit de app waarop aan- en verkopen verrekend worden), ofwel *niet gevolgd*. Een beleggingsrekening heeft geen eigen kaspositie.
- **Effect:** naam, ISIN, type, kapitaliserend of distribuerend, het beurstakstarief (je kiest het zelf), het fiscaal regime (meerwaardebelasting, Reynderstaks of vrijgesteld) en de referentiekoers voor loten van vóór de startdatum.

### Verrichtingen
**Nieuwe verrichting:** aankoop, verkoop, dividend, losse kosten, losse taks of splitsing.
- **Aan- en verkoop:** je vult het aantal en het **brutobedrag** in; de koers wordt afgeleid (12 stuks voor € 301,50 = € 25,125).
- **Beurstaks** = bruto × tarief, op de cent, begrensd op het maximum. Ze wordt voorgesteld en is aanpasbaar.
- **Nettobedrag:** vul het bedrag van de banktransactie in en je ziet live het verschil.
- **Nog een verrichting** behoudt rekening en effect. Elke verrichting is bewerkbaar en verwijderbaar; alles wordt herberekend.
- **Aantallen en bedragen:** aantallen tot 6 decimalen, bedragen op de cent, nooit kommagetallen in de berekening.

### Afrekenrekening
- **Koppeling:** een aankoop hoort bij een afschrijving, een verkoop of dividend bij een bijschrijving. De app stelt de banktransactie voor (bedrag en datum binnen 5 dagen); jij bevestigt, kiest een andere of koppelt los. Eén banktransactie hoort bij hoogstens één verrichting.
- **Verschil:** wijkt het bedrag af, dan zie je het verschil met de suggestie om de kosten of taks na te kijken.
- **Categorieën:** gekoppelde banktransacties krijgen automatisch *Beleggingen › Aankoop* (telt als **sparen**), *Verkoop* (neutraal) of *Dividend* (inkomst). Loskoppelen zet de vorige categorie terug.
- **Snelle invoer:** open bij **Transacties** een banktransactie op de afrekenrekening en kies **Maak verrichting van deze transactie** (datum, nettobedrag en soort staan al ingevuld).
- **Niet-gekoppeld** toont de verrichtingen zonder banktransactie.

### Loten en meerwaarden
- **FIFO:** één lot per aankoop; een verkoop verbruikt de oudste loten eerst.
- **Kostprijs:** de kostprijs van een lot is het brutobedrag. Bij een gedeeltelijke verkoop gaat een evenredig deel mee, op de cent; het laatste deel krijgt het restant.
- **Splitsing:** past het aantal aan, de kostprijs blijft.
- **Fiscale aankoopwaarde:** vanaf de startdatum de kostprijs. Voor oudere loten de referentiekoers × aantal, en tot het einde van de overgangsregel het hoogste van die waarde en de kostprijs. Ontbreekt de referentiekoers, dan is het resultaat **onvolledig**.
- **Fiscaal resultaat** = brutobedrag verkoop − fiscale aankoopwaarde. Het **economische resultaat** (inclusief kosten en taksen) staat er apart naast, met per verkoop de verbruikte loten.
- **Reynderstaks:** standaard valt de volledige meerwaarde onder de roerende voorheffing en buiten de basis; per verkoop pas je dat deel aan. De Reynderstaks zelf wordt niet berekend.
- **Per persoon en jaar:** meerwaarden − aftrekbare minwaarden (niet onder nul) − vrijstelling − overgedragen vrijstelling = belastbare basis, × tarief. Daarnaast het bedrag dat de bank al inhield, en het verschil. Een gemeenschappelijke beleggingsrekening wordt volgens het aandeel verdeeld.
- **Simulatie** van een verkoop: verbruikte loten, meerwaarde, verwachte beurstaks en het effect op de resterende vrijstelling. Er wordt niets bewaard.

### Koersen en waarde
- **Koersen bijwerken:** één scherm met alle effecten in portefeuille en hun laatst gekende koers.
- **Waarde** = aantal × laatst gekende koers. Een koers ouder dan 35 dagen is *verouderd*. Zonder koers is de waarde **onbekend**, niet 0.
- **Overzicht** per rekening en totaal: aantal, gemiddelde aankoopprijs, geïnvesteerd, waarde, niet-gerealiseerd resultaat, dividenden, kosten en taksen.

### Pensioensparen
- **Product:** per persoon, met het stelsel per jaar.
- **Stortingen:** worden overgenomen uit banktransacties met de categorie *Sparen & beleggen › Pensioensparen* (bv. via een regel op de IBAN van je fonds). Een storting kan je uitsluiten of manueel toevoegen.
- **Verwachte vermindering:** tot het basisplafond × 30 %, daarboven min(gestort, verhoogd plafond) × 25 %.
- **Waarschuwingen:** onder het breakevenpunt (€ 1.260), plafond overschreden, en vanaf 1 december als er nog ruimte is.
- **Waarde:** manueel in te voeren (bv. uit het jaaroverzicht), met historiek per jaar.

### Vermogen, fiscaal jaaroverzicht en startpagina
- **Vermogen:** de beleggingen (waarde van de posities) en het pensioensparen (laatst gekende waarde) tellen nu mee, volgens eigendom. De cash zit in het saldo van de afrekenrekening en telt niet dubbel. Maanden met een onbekende of verouderde koers worden gemarkeerd.
- **Fiscaal jaaroverzicht:** tabblad **Fiscaal**, per jaar en persoon. Het bevat:
  - pensioensparen;
  - woonkrediet: de effectief gekoppelde betalingen, totaal en volgens aandeel;
  - meerwaardebelasting en een apart blok voor Reynderstaks;
  - beurstaks, makelaarskosten en dividenden.

  Elk bedrag is aanklikbaar, en het overzicht is afdrukbaar en exporteerbaar als CSV.
- **Startpagina:** totale waarde van de beleggingen, wat je nog kan storten voor pensioensparen, en de resterende vrijstelling.

Voorbeelddata: `voorbeelden/fase5/` (zie `BELEGGINGEN.txt`).

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
│   ├── report-categories.js overzicht categorie × maand
│   ├── budget/             periodes, perspectieven, terugkerende betalingen, waarschuwingen, vrije ruimte, prognose
│   ├── loans/              aflossingstabel (exacte vaste komma), opvolging betalingen, simulatie, koppeling met budget
│   ├── wealth/             saldo per maandeinde, vermogensbronnen, perspectieven Persoonlijk/Huishouden
│   ├── invest/             beleggingen: eenheden, beurstaks, verrichtingen, loten (FIFO), meerwaarden, waardering, afrekenrekening
│   ├── pension/            pensioensparen
│   ├── fiscal/             fiscale parameters per jaar, fiscaal jaaroverzicht
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
