# Gekkenhuis Bingo

Digitale bingo tool voor een live Clubhouse-spel. De app heeft nu een kleine Node.js-server, centrale JSON-opslag, live updates via Server-Sent Events en een kaartlimiet van een bingokaart per ronde per deelnemer.

## Lokaal starten

```powershell
npm start
```

Open daarna:

- Start: `http://127.0.0.1:3000/#/`
- Registratie: `http://127.0.0.1:3000/#/registratie`
- Mijn kaart: `http://127.0.0.1:3000/#/kaart?id=<kaart_id>`
- Host dashboard: `http://127.0.0.1:3000/#/host`
- Live trekking: `http://127.0.0.1:3000/#/trekking`
- Winnaar: `http://127.0.0.1:3000/#/winnaar?claim=<claim_id>`

## Productie

Vereist: Node.js 18 of nieuwer.

```bash
cd /pad/naar/BINGO
npm start
```

Optionele environment variables:

```bash
PORT=3000
DATA_DIR=/var/lib/gekkenhuis-bingo
HOST_USER=hostnaam
HOST_PASSWORD=sterk-wachtwoord
TRUST_PROXY=true
```

Gebruik achter Nginx of een andere reverse proxy bij voorkeur HTTPS. Zorg dat de proxy `X-Forwarded-For` doorgeeft, zodat de server de kaartlimiet per ronde betrouwbaar kan toepassen.

Voorbeeld Nginx locatieblok:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;
}
```

## Opslag

Standaard wordt de data opgeslagen in `data/bingo-state.json`. Die map staat in `.gitignore`, zodat spelersdata niet per ongeluk wordt gecommit.

## Kaartlimiet

Per ronde kan dezelfde deelnemer maar een bingokaart krijgen. Als iemand opnieuw registreert, geeft de server de bestaande kaart terug in plaats van een nieuwe kaart te maken.

## Host login en prijzen

Host-acties kunnen worden beveiligd met `HOST_USER` en `HOST_PASSWORD`. Als die environment variables zijn ingesteld, vraagt het hostdashboard bij de eerste host-actie om gebruikersnaam en wachtwoord.

In het hostdashboard kun je prijzen toevoegen met:

- naam
- soort, bijvoorbeeld voucher of cadeaubon
- bedrag
- logo URL
- prijs code, bijvoorbeeld een voucher- of cadeauboncode
- omschrijving

Daarna kun je per ronde kiezen waarvoor gespeeld wordt. Bij een geldige bingo kan de host de prijs via de bingo-melding aan de winnaar toekennen.

Prijscodes worden niet meegestuurd in de algemene speldata. De code wordt pas opgehaald op de persoonlijke kaart van de winnaar nadat de host de prijs heeft toegekend.

Prijzen kunnen in het hostdashboard ook worden aangepast of verwijderd. Een lege code bij aanpassen behoudt de bestaande code. Toegekende prijzen kunnen niet worden verwijderd.

Oude rondes kunnen vanuit het hostdashboard worden verwijderd. Daarbij worden de kaarten, trekkingen en bingo-meldingen van die ronde ook opgeruimd. De actieve ronde kan niet worden verwijderd; start eerst een nieuwe ronde.

Spelers kunnen vanuit het hostdashboard per kaart worden verwijderd. Bij verwijderen worden bijbehorende bingo-meldingen verwijderd en een eventueel gekoppelde prijs weer vrijgegeven.

De host kan toegang voor nieuwe registraties blokkeren op basis van een bestaande spelerkaart en die blokkade later weer opheffen.
