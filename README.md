# Gekkenhuis Bingo

Digitale bingo tool voor een live Clubhouse-spel. De app heeft nu een kleine Node.js-server, centrale JSON-opslag, live updates via Server-Sent Events en een kaartlimiet van een bingokaart per ronde per IP-adres.

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
HOST_PIN=sterke-host-pin
TRUST_PROXY=true
```

Gebruik achter Nginx of een andere reverse proxy bij voorkeur HTTPS. Zorg dat de proxy `X-Forwarded-For` doorgeeft, want de server gebruikt dat adres voor de limiet van een kaart per IP per ronde.

Voorbeeld Nginx locatieblok:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;
}
```

## Opslag

Standaard wordt de data opgeslagen in `data/bingo-state.json`. Die map staat in `.gitignore`, zodat spelersdata niet per ongeluk wordt gecommit.

## Kaartlimiet

Per ronde kan hetzelfde IP-adres maar een bingokaart krijgen. Als iemand vanaf hetzelfde IP opnieuw registreert, geeft de server de bestaande kaart terug in plaats van een nieuwe kaart te maken.
