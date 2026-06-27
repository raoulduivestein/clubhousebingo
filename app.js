(function () {
  "use strict";

  const LAST_CARD_KEY = "gekkenhuis-last-card-id";
  const BINGO_TYPES = {
    horizontal: "Een horizontale lijn",
    vertical: "Een verticale lijn",
    diagonal: "Een diagonale lijn",
    corners: "Vier hoeken",
    full: "Volle kaart",
  };
  const STATUS_LABELS = {
    setup: "Voorbereiding",
    registration: "Registratie open",
    ready: "Registratie gesloten",
    playing: "Spel bezig",
    paused: "Gepauzeerd",
    finished: "Afgerond",
  };
  const LETTERS = ["B", "I", "N", "G", "O"];

  const app = document.querySelector("#app");
  let state = null;
  let loading = false;
  let lastAnnouncedDrawingId = null;
  let hostAuthenticated = false;

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    const response = await fetch(path, {
      ...options,
      headers,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Serverfout.");
    return payload;
  }

  async function loadState() {
    if (loading) return;
    const previousState = state;
    loading = true;
    try {
      state = await api("/api/state");
      render();
      announceStateChanges(previousState, state);
    } catch (error) {
      app.innerHTML = `<section class="panel"><h2>Server niet bereikbaar</h2><p class="muted">${escapeHtml(error.message)}</p></section>`;
    } finally {
      loading = false;
    }
  }

  function announceStateChanges(previousState, nextState) {
    if (!previousState || !nextState) return;
    const previousRound = previousState.rounds.find((round) => round.ronde_id === previousState.activeRoundId);
    const nextRound = nextState.rounds.find((round) => round.ronde_id === nextState.activeRoundId);
    if (!nextRound) return;
    const previousDrawings = previousState.drawings.filter((drawing) => drawing.ronde_id === nextRound.ronde_id);
    const nextDrawings = nextState.drawings.filter((drawing) => drawing.ronde_id === nextRound.ronde_id);
    const latest = nextDrawings.sort((a, b) => a.volgorde - b.volgorde).at(-1);
    if (latest && latest.trekking_id !== lastAnnouncedDrawingId && nextDrawings.length > previousDrawings.length) {
      lastAnnouncedDrawingId = latest.trekking_id;
      announce(`Nieuwe bal getrokken: ${latest.bal_letter} ${latest.bal_nummer}`);
    }
    if (previousRound && previousRound.status !== nextRound.status) {
      announce(`Rondestatus gewijzigd naar ${STATUS_LABELS[nextRound.status] || nextRound.status}`);
    }
  }

  function route() {
    const hash = window.location.hash || "#/";
    const [path, queryString = ""] = hash.slice(1).split("?");
    return {
      path: path || "/",
      params: new URLSearchParams(queryString),
    };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(message) {
    const region = document.querySelector("#toast-region");
    const liveRegion = document.querySelector("#live-region");
    const node = document.createElement("div");
    node.className = "toast";
    node.setAttribute("role", "alert");
    node.textContent = message;
    region.append(node);
    if (liveRegion) liveRegion.textContent = message;
    window.setTimeout(() => node.remove(), 3600);
  }

  function announce(message) {
    const liveRegion = document.querySelector("#live-region");
    if (liveRegion) liveRegion.textContent = message;
  }

  function activeRound() {
    return state.rounds.find((round) => round.ronde_id === state.activeRoundId) || state.rounds[0];
  }

  function drawingsFor(roundId) {
    return state.drawings.filter((drawing) => drawing.ronde_id === roundId).sort((a, b) => a.volgorde - b.volgorde);
  }

  function claimsFor(roundId) {
    return state.claims
      .filter((claim) => claim.ronde_id === roundId)
      .sort((a, b) => new Date(b.geclaimd_op) - new Date(a.geclaimd_op));
  }

  function cardById(cardId) {
    return state.cards.find((card) => card.kaart_id === cardId);
  }

  function playerById(playerId) {
    return state.players.find((player) => player.speler_id === playerId);
  }

  function prizeById(prizeId) {
    return state.prizes?.find((prize) => prize.prijs_id === prizeId);
  }

  function prizeForRound(round) {
    return round?.prijs_id ? prizeById(round.prijs_id) : null;
  }

  function cardLink(cardId) {
    return `${location.origin}${location.pathname}${location.search}#/kaart?id=${encodeURIComponent(cardId)}`;
  }

  function renderPrize(prize, compact = false) {
    if (!prize) return `<div class="empty">Nog geen prijs gekozen voor deze ronde.</div>`;
    return `<div class="prize ${compact ? "compact" : ""}">
      ${prize.logo_url ? `<img class="prize-logo" src="${escapeHtml(prize.logo_url)}" alt="${escapeHtml(prize.naam)} logo" />` : `<div class="prize-logo placeholder">GB</div>`}
      <div>
        <strong>${escapeHtml(prize.naam)}</strong>
        <span>${escapeHtml(prize.soort || "Prijs")}${prize.bedrag ? ` - ${escapeHtml(prize.bedrag)}` : ""}</span>
        ${compact || !prize.omschrijving ? "" : `<p class="muted">${escapeHtml(prize.omschrijving)}</p>`}
        ${prize.status === "awarded" ? `<span class="pill">Toegekend</span>` : ""}
      </div>
    </div>`;
  }

  function renderStatus(round) {
    return `<span class="pill" role="status" aria-label="Rondestatus: ${escapeHtml(STATUS_LABELS[round.status] || round.status)}">${STATUS_LABELS[round.status] || round.status}</span>`;
  }

  function renderBalls(drawings) {
    if (!drawings.length) return `<div class="empty" role="status">Nog geen ballen getrokken. De ballenmachine draait warm.</div>`;
    return `<ol class="ball-list" aria-label="Getrokken ballen">${drawings
      .map((drawing) => `<li class="ball" aria-label="Bal ${escapeHtml(drawing.bal_letter)} ${escapeHtml(drawing.bal_nummer)}">${escapeHtml(drawing.volledige_bal)}</li>`)
      .join("")}</ol>`;
  }

  function renderDrawnBallsText(drawings) {
    const latest = drawings.at(-1);
    const allBalls = drawings.map((drawing) => `${drawing.bal_letter} ${drawing.bal_nummer}`).join(", ");
    return `<section class="sr-only" aria-live="polite" aria-atomic="true">
      <h3>Getrokken ballen als tekst</h3>
      <p>${latest ? `Laatste bal: ${escapeHtml(latest.bal_letter)} ${escapeHtml(latest.bal_nummer)}.` : "Nog geen ballen getrokken."}</p>
      <p>${drawings.length ? `Alle getrokken ballen: ${escapeHtml(allBalls)}.` : "De lijst met getrokken ballen is nog leeg."}</p>
    </section>`;
  }

  function renderAssistiveCardStatus(card, round, drawings, lastClaim) {
    const latest = drawings.at(-1);
    return `<section class="sr-only" aria-live="polite" aria-atomic="true">
      <h3>Spelstatus voor je bingokaart</h3>
      <p>Kaart ${escapeHtml(card.kaartnummer)}. Ronde: ${escapeHtml(round.naam)}. Status: ${escapeHtml(STATUS_LABELS[round.status] || round.status)}. Bingo-opdracht: ${escapeHtml(BINGO_TYPES[round.bingo_type] || round.bingo_type)}.</p>
      <p>${drawings.length} ballen getrokken.${latest ? ` Laatste bal: ${escapeHtml(latest.bal_letter)} ${escapeHtml(latest.bal_nummer)}.` : ""}</p>
      ${lastClaim ? `<p>Laatste bingo-melding: ${escapeHtml(lastClaim.message)}</p>` : ""}
    </section>`;
  }

  function cardCellLabel(value, rowIndex, columnIndex, drawn) {
    const isFree = rowIndex === 2 && columnIndex === 2;
    if (isFree) return "vrij vak, telt automatisch mee";
    return `nummer ${value}, ${drawn.has(value) ? "geraakt" : "niet geraakt"}`;
  }

  function renderCardTranscript(card, drawings) {
    const drawn = new Set(drawings.map((drawing) => drawing.bal_nummer));
    return `<section class="sr-only" aria-labelledby="card-transcript-title">
      <h3 id="card-transcript-title">Tekstversie van je bingokaart</h3>
      <table>
        <caption>Bingokaart ${escapeHtml(card.kaartnummer)} met status per vakje</caption>
        <thead><tr>${LETTERS.map((letter) => `<th scope="col">${letter}</th>`).join("")}</tr></thead>
        <tbody>
          ${card.nummers
            .map(
              (row, rowIndex) =>
                `<tr>${row
                  .map((value, columnIndex) => `<td>${escapeHtml(LETTERS[columnIndex])} rij ${rowIndex + 1}: ${escapeHtml(cardCellLabel(value, rowIndex, columnIndex, drawn))}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>`;
  }

  function renderCard(card, drawings) {
    const drawn = new Set(drawings.map((drawing) => drawing.bal_nummer));
    const rows = [
      `<div class="bingo-row" role="row">${LETTERS.map((letter, index) => `<div class="bingo-cell header" role="columnheader" aria-colindex="${index + 1}" aria-label="Kolom ${letter}">${letter}</div>`).join("")}</div>`,
      card.nummers
        .map((row, rowIndex) =>
          `<div class="bingo-row" role="row" aria-rowindex="${rowIndex + 2}">${row
            .map((value, columnIndex) => {
              const isFree = rowIndex === 2 && columnIndex === 2;
              const isHit = isFree || drawn.has(value);
              const label = `Rij ${rowIndex + 1}, kolom ${LETTERS[columnIndex]}, ${cardCellLabel(value, rowIndex, columnIndex, drawn)}`;
              return `<div class="bingo-cell ${isFree ? "free" : ""} ${isHit ? "hit" : ""}" role="gridcell" aria-rowindex="${rowIndex + 2}" aria-colindex="${columnIndex + 1}" aria-label="${escapeHtml(label)}" aria-selected="${isHit ? "true" : "false"}">${escapeHtml(value)}</div>`;
            })
            .join("")}</div>`,
        )
        .join(""),
    ];
    return `${renderCardTranscript(card, drawings)}<div class="bingo-card" role="grid" aria-rowcount="6" aria-colcount="5" aria-label="Bingokaart ${escapeHtml(card.kaartnummer)} met automatisch gemarkeerde nummers">${rows.join("")}</div>`;
  }

  function renderHome() {
    const round = activeRound();
    const drawings = drawingsFor(round.ronde_id);
    const prize = prizeForRound(round);
    app.innerHTML = `
      <section class="hero">
        <div class="hero-panel">
          <p class="eyebrow">Welkom in het gekkenhuis</p>
          <h1>Gekkenhuis Bingo</h1>
          <p class="lede">Registreer je naam, pak je kaart en luister live mee in Clubhouse. Zodra de ballen rollen, begint het gekkenhuis.</p>
          <div class="actions">
            <a class="button" href="#/registratie">Ik doe mee</a>
            <a class="button secondary" href="#/trekking">Open live scherm</a>
          </div>
        </div>
        <aside class="panel status-stack">
          <h2>${escapeHtml(round.naam)}</h2>
          ${renderStatus(round)}
          <div class="stat-grid">
            <div class="stat"><strong>${state.cards.filter((card) => card.ronde_id === round.ronde_id).length}</strong><span class="muted">Kaarten</span></div>
            <div class="stat"><strong>${drawings.length}</strong><span class="muted">Ballen</span></div>
            <div class="stat"><strong>${claimsFor(round.ronde_id).filter((claim) => claim.status === "valid").length}</strong><span class="muted">Winnaars</span></div>
          </div>
          <p>${round.registratie_open ? "De registratie is geopend. Pak je kaart voordat de chaos begint." : "De registratie is gesloten. Luister scherp mee."}</p>
          <p><strong>We spelen nu voor:</strong><br>${escapeHtml(BINGO_TYPES[round.bingo_type])}</p>
          ${renderPrize(prize, true)}
        </aside>
      </section>
    `;
  }

  function renderRegistration() {
    const round = activeRound();
    const isFinished = round.status === "finished";
    const prize = prizeForRound(round);
    app.innerHTML = `
      <section class="grid two-col">
        <div class="panel">
          <p class="eyebrow">Registratie</p>
          <h2>Pak je kaart voordat de chaos begint</h2>
          <p class="muted">Ronde: ${escapeHtml(round.naam)}. ${round.registratie_open ? "De registratie is geopend." : "De registratie is nu gesloten."}</p>
          ${isFinished ? `<p><strong>Deze ronde is afgelopen.</strong><br>Wacht tot de host een nieuwe ronde start. Daarna kun je opnieuw registreren.</p>` : ""}
          <p class="muted">Per ronde kan er maar een kaart per deelnemer worden aangemaakt. Als je al meedoet, opent de server je bestaande kaart.</p>
          <h3>Prijs van deze ronde</h3>
          ${renderPrize(prize, true)}
        </div>
        <form class="panel form" id="registration-form">
          <div class="field">
            <label for="name">Naam</label>
            <input id="name" name="name" required maxlength="80" autocomplete="name" />
          </div>
          <div class="field">
            <label for="clubhouse">Clubhouse-naam</label>
            <input id="clubhouse" name="clubhouse" maxlength="80" placeholder="@clubhouse" />
          </div>
          <button class="button" type="submit" ${round.registratie_open ? "" : "disabled"}>Maak mijn bingokaart</button>
        </form>
      </section>
    `;

    document.querySelector("#registration-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const naam = String(form.get("name") || "").trim();
      const clubhouseNaam = String(form.get("clubhouse") || "").trim();
      if (!naam) return;

      try {
        const result = await api("/api/register", {
          method: "POST",
          body: JSON.stringify({ naam, clubhouse_naam: clubhouseNaam }),
        });
        localStorage.setItem(LAST_CARD_KEY, result.card.kaart_id);
        toast(result.existing ? "Je had al een kaart. We openen je bestaande kaart." : "Je kaart is klaar. Welkom in het gekkenhuis.");
        await loadState();
        window.location.hash = `#/kaart?id=${result.card.kaart_id}`;
      } catch (error) {
        toast(error.message);
      }
    });
  }

  function renderPlayerCard() {
    const { params } = route();
    const round = activeRound();
    const explicitCardId = params.get("id");
    const storedCardId = localStorage.getItem(LAST_CARD_KEY);
    const storedCard = storedCardId ? cardById(storedCardId) : null;
    const cardId = explicitCardId || (storedCard?.ronde_id === round.ronde_id ? storedCardId : null);
    const card = cardId ? cardById(cardId) : null;

    if (!card) {
      app.innerHTML = `
        <section class="panel">
          <h2>${storedCard && storedCard.ronde_id !== round.ronde_id ? "Nieuwe ronde, nieuwe kaart" : "Geen kaart gevonden"}</h2>
          <p class="muted">${
            storedCard && storedCard.ronde_id !== round.ronde_id
              ? "Je oude kaart hoort bij een vorige ronde. Voor deze ronde kun je opnieuw een kaart maken."
              : "Maak eerst een bingokaart of open je persoonlijke link."
          }</p>
          <div class="actions"><a class="button" href="#/registratie">Maak mijn kaart</a></div>
        </section>
      `;
      return;
    }

    if (card.ronde_id === round.ronde_id) localStorage.setItem(LAST_CARD_KEY, card.kaart_id);
    const player = playerById(card.speler_id);
    const cardRound = state.rounds.find((item) => item.ronde_id === card.ronde_id) || round;
    const isOldRoundCard = cardRound.ronde_id !== round.ronde_id;
    const prize = prizeForRound(cardRound);
    const drawings = drawingsFor(cardRound.ronde_id);
    const last = drawings.at(-1);
    const lastClaim = state.claims
      .filter((claim) => claim.kaart_id === card.kaart_id)
      .sort((a, b) => new Date(b.geclaimd_op) - new Date(a.geclaimd_op))[0];
    const awardedClaim = state.claims
      .filter((claim) => claim.kaart_id === card.kaart_id && claim.status === "valid" && claim.prijs_id)
      .sort((a, b) => new Date(b.gecontroleerd_op) - new Date(a.gecontroleerd_op))[0];
    const awardedPrize = awardedClaim ? prizeById(awardedClaim.prijs_id) : null;

    app.innerHTML = `
      <section class="grid two-col">
        ${renderAssistiveCardStatus(card, cardRound, drawings, lastClaim)}
        <div class="panel status-stack">
          ${
            isOldRoundCard
              ? `<div class="claim invalid"><strong>Deze kaart hoort bij een vorige ronde.</strong><span>De actieve ronde is nu ${escapeHtml(round.naam)}. Maak een nieuwe kaart om opnieuw mee te spelen.</span><div class="actions"><a class="button" href="#/registratie">Maak nieuwe kaart</a></div></div>`
              : ""
          }
          <p class="eyebrow">Mijn bingokaart</p>
          <h2>${escapeHtml(player?.naam || "Speler")}</h2>
          <p class="muted">${escapeHtml(player?.clubhouse_naam || "Geen Clubhouse-naam ingevuld")}</p>
          <div class="stat-grid">
            <div class="stat"><strong>${escapeHtml(card.kaartnummer)}</strong><span class="muted">Kaartnummer</span></div>
            <div class="stat"><strong>${drawings.length}</strong><span class="muted">Ballen</span></div>
            <div class="stat"><strong>${last ? escapeHtml(last.volledige_bal) : "-"}</strong><span class="muted">Laatste bal</span></div>
          </div>
          <p><strong>Ronde:</strong> ${escapeHtml(cardRound.naam)}<br><strong>Status:</strong> ${escapeHtml(STATUS_LABELS[cardRound.status])}<br><strong>Bingo:</strong> ${escapeHtml(BINGO_TYPES[cardRound.bingo_type])}</p>
          <p class="accessibility-note">De kaart markeert getrokken nummers automatisch. Screenreaders lezen per vakje voor of het nummer geraakt is.</p>
          <h3>We spelen voor</h3>
          ${renderPrize(prize, true)}
          <span class="sr-only" id="claim-help">Activeer deze knop alleen als je denkt dat je bingo hebt volgens de opdracht van deze ronde.</span>
          <button class="button warning" id="claim-bingo" aria-describedby="claim-help" ${isOldRoundCard ? "disabled" : ""}>Bingo!</button>
          ${lastClaim ? `<div class="claim ${lastClaim.status === "valid" ? "valid" : "invalid"}"><strong>${escapeHtml(lastClaim.status === "valid" ? "Geldige bingo" : "Bingo melding")}</strong><span>${escapeHtml(lastClaim.message)}</span></div>` : ""}
          ${
            awardedPrize
              ? `<div class="claim valid" id="prize-code-panel"><strong>Je prijs is toegekend: ${escapeHtml(awardedPrize.naam)}</strong><span class="muted">De prijscode wordt opgehaald...</span></div>`
              : ""
          }
          <div class="field">
            <label for="personal-link">Persoonlijke link</label>
            <input id="personal-link" readonly value="${escapeHtml(cardLink(card.kaart_id))}" />
          </div>
        </div>
        <div class="panel status-stack">
          ${renderCard(card, drawings)}
          <h3>Getrokken ballen</h3>
          ${renderDrawnBallsText(drawings)}
          ${renderBalls(drawings)}
        </div>
      </section>
    `;

    document.querySelector("#claim-bingo").addEventListener("click", async () => {
      try {
        const result = await api("/api/claim", {
          method: "POST",
          body: JSON.stringify({ kaart_id: card.kaart_id }),
        });
        toast(result.result.message);
        await loadState();
      } catch (error) {
        toast(error.message);
      }
    });
    if (awardedClaim) loadPrizeCode(card.kaart_id, awardedClaim.claim_id);
  }

  async function loadPrizeCode(cardId, claimId) {
    const panel = document.querySelector("#prize-code-panel");
    if (!panel) return;
    try {
      const result = await api(`/api/prize-code?kaart_id=${encodeURIComponent(cardId)}&claim_id=${encodeURIComponent(claimId)}`);
      panel.innerHTML = `<strong>Je prijs is toegekend: ${escapeHtml(result.naam)}</strong>
        ${result.bedrag ? `<span>${escapeHtml(result.bedrag)}</span>` : ""}
        <label class="field">
          <span>Jouw prijscode</span>
          <input readonly value="${escapeHtml(result.code || "Geen code ingevuld")}" aria-label="Jouw prijscode" />
        </label>
        <label class="field">
          <span>Jouw pincode</span>
          <input readonly value="${escapeHtml(result.pincode || "Geen pincode ingevuld")}" aria-label="Jouw pincode" />
        </label>`;
      announce("Je prijscode is beschikbaar.");
    } catch (error) {
      panel.innerHTML = `<strong>Je prijs is toegekend.</strong><span>${escapeHtml(error.message)}</span>`;
    }
  }

  function renderHost() {
    const hostUser = localStorage.getItem("gekkenhuis-host-user") || "";
    const hostPassword = localStorage.getItem("gekkenhuis-host-password") || "";
    if (!hostAuthenticated || !hostUser || !hostPassword) {
      renderHostLogin(hostUser);
      return;
    }

    const round = activeRound();
    const cards = state.cards.filter((card) => card.ronde_id === round.ronde_id);
    const drawings = drawingsFor(round.ronde_id);
    const claims = claimsFor(round.ronde_id);
    const last = drawings.at(-1);
    const prizes = state.prizes || [];
    const currentPrize = prizeForRound(round);
    app.innerHTML = `
      <section class="grid host-grid">
        <aside class="panel form">
          <p class="eyebrow">Host dashboard</p>
          <h2>${escapeHtml(round.naam)}</h2>
          ${renderStatus(round)}
          <div class="field">
            <label for="round-name">Naam ronde</label>
            <input id="round-name" value="${escapeHtml(round.naam)}" />
          </div>
          <div class="field">
            <label for="bingo-type">Geldige bingo</label>
            <select id="bingo-type">
              ${Object.entries(BINGO_TYPES)
                .map(([value, label]) => `<option value="${value}" ${round.bingo_type === value ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
          </div>
          <div class="field">
            <label for="round-prize">Prijs voor deze ronde</label>
            <select id="round-prize">
              <option value="">Geen prijs gekozen</option>
              ${prizes
                .map((prize) => `<option value="${prize.prijs_id}" ${round.prijs_id === prize.prijs_id ? "selected" : ""}>${escapeHtml(prize.naam)}${prize.bedrag ? ` - ${escapeHtml(prize.bedrag)}` : ""}</option>`)
                .join("")}
            </select>
          </div>
          <h3>Huidige prijs</h3>
          ${renderPrize(currentPrize, true)}
          <div class="actions">
            <button class="button secondary" id="save-round">Opslaan</button>
            <button class="button secondary" id="toggle-registration">${round.registratie_open ? "Sluit registratie" : "Open registratie"}</button>
            <button class="button good" id="start-game">Start spel</button>
            <button class="button" id="draw-ball" ${round.status === "playing" ? "" : "disabled"}>Trek bal</button>
            <button class="button secondary" id="pause-game">${round.status === "paused" ? "Hervat spel" : "Pauzeer spel"}</button>
            <button class="button warning" id="finish-round">Sluit ronde</button>
            <button class="button secondary" id="new-round">Nieuwe ronde</button>
            <button class="button secondary" id="host-logout">Log uit</button>
          </div>
        </aside>
        <div class="grid">
          <div class="panel">
            <div class="stat-grid">
              <div class="stat"><strong>${cards.length}</strong><span class="muted">Geregistreerde spelers</span></div>
              <div class="stat"><strong>${drawings.length}</strong><span class="muted">Getrokken ballen</span></div>
              <div class="stat"><strong>${last ? escapeHtml(last.volledige_bal) : "-"}</strong><span class="muted">Laatste bal</span></div>
            </div>
          </div>
          <div class="panel">
            <h3>Getrokken ballen</h3>
            ${renderBalls(drawings)}
          </div>
          <div class="panel">
            <h3>Bingo meldingen</h3>
            ${renderClaims(claims)}
          </div>
          <div class="panel">
            <h3>Prijzen beheren</h3>
            ${renderPrizeForm()}
            <h3>Beschikbare prijzen</h3>
            ${renderPrizeList(prizes)}
          </div>
          <div class="panel">
            <h3>Oude rondes beheren</h3>
            ${renderRoundList(state.rounds)}
          </div>
          <div class="panel">
            <h3>Spelers en kaartnummers</h3>
            ${renderPlayersTable(cards)}
          </div>
          <div class="panel">
            <h3>Geblokkeerde toegang</h3>
            ${renderBlockedConnections(state.blocked_connections || [])}
          </div>
        </div>
      </section>
    `;

    document.querySelector("#save-round").addEventListener("click", async () => {
      const ok = await hostPost("/api/host/round", {
        naam: document.querySelector("#round-name").value.trim(),
        bingo_type: document.querySelector("#bingo-type").value,
        prijs_id: document.querySelector("#round-prize").value,
      });
      if (ok) toast("Ronde opgeslagen.");
    });
    document.querySelector("#toggle-registration").addEventListener("click", () => hostAction("toggle-registration"));
    document.querySelector("#start-game").addEventListener("click", () => hostAction("start", "De ballenmachine draait."));
    document.querySelector("#draw-ball").addEventListener("click", async () => {
      const ok = await hostPost("/api/host/draw", {});
      if (ok) toast("Nieuwe bal getrokken.");
    });
    document.querySelector("#pause-game").addEventListener("click", () => hostAction("pause"));
    document.querySelector("#finish-round").addEventListener("click", () => hostAction("finish", "De ronde is gesloten."));
    document.querySelector("#new-round").addEventListener("click", () => hostAction("new", "Nieuwe ronde gestart. De registratie is geopend."));
    document.querySelector("#host-logout").addEventListener("click", () => {
      hostAuthenticated = false;
      localStorage.removeItem("gekkenhuis-host-user");
      localStorage.removeItem("gekkenhuis-host-password");
      render();
    });
    document.querySelector("#prize-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const ok = await hostPost("/api/host/prizes", {
        naam: form.get("naam"),
        soort: form.get("soort"),
        bedrag: form.get("bedrag"),
        logo_url: form.get("logo_url"),
        code: form.get("code"),
        pincode: form.get("pincode"),
        omschrijving: form.get("omschrijving"),
      });
      if (ok) toast("Prijs toegevoegd.");
    });
    document.querySelectorAll("[data-prize-edit-form]").forEach((formNode) => {
      formNode.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const payload = {
          prijs_id: event.currentTarget.dataset.prizeId,
          naam: form.get("naam"),
          soort: form.get("soort"),
          bedrag: form.get("bedrag"),
          logo_url: form.get("logo_url"),
          omschrijving: form.get("omschrijving"),
        };
        const code = String(form.get("code") || "").trim();
        const pincode = String(form.get("pincode") || "").trim();
        if (code) payload.code = code;
        if (pincode) payload.pincode = pincode;
        const ok = await hostPost("/api/host/update-prize", payload);
        if (ok) toast("Prijs bijgewerkt.");
      });
    });
    document.querySelectorAll("[data-delete-prize]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Weet je zeker dat je deze prijs wilt verwijderen?")) return;
        const ok = await hostPost("/api/host/delete-prize", { prijs_id: button.dataset.prizeId });
        if (ok) toast("Prijs verwijderd.");
      });
    });
    document.querySelectorAll("[data-delete-round]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Weet je zeker dat je deze oude ronde met kaarten, trekkingen en claims wilt verwijderen?")) return;
        const ok = await hostPost("/api/host/delete-round", { ronde_id: button.dataset.roundId });
        if (ok) toast("Ronde verwijderd.");
      });
    });
    document.querySelectorAll("[data-delete-card]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Weet je zeker dat je deze speler met kaart, bingo-meldingen en eventuele prijs-koppeling wilt verwijderen?")) return;
        const ok = await hostPost("/api/host/delete-card", { kaart_id: button.dataset.cardId });
        if (ok) toast("Speler verwijderd.");
      });
    });
    document.querySelectorAll("[data-block-card]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Weet je zeker dat je nieuwe registraties vanaf deze speler wilt blokkeren?")) return;
        const ok = await hostPost("/api/host/block-card", { kaart_id: button.dataset.cardId });
        if (ok) toast("Toegang geblokkeerd.");
      });
    });
    document.querySelectorAll("[data-unblock-connection]").forEach((button) => {
      button.addEventListener("click", async () => {
        const ok = await hostPost("/api/host/unblock-connection", { block_id: button.dataset.blockId });
        if (ok) toast("Blokkade opgeheven.");
      });
    });
    document.querySelectorAll("[data-award-prize]").forEach((button) => {
      button.addEventListener("click", async () => {
        const ok = await hostPost("/api/host/award-prize", {
          claim_id: button.dataset.claimId,
          prijs_id: button.dataset.prizeId,
        });
        if (ok) toast("Prijs toegekend.");
      });
    });
  }

  function renderHostLogin(username = "") {
    app.innerHTML = `
      <section class="grid two-col">
        <div class="panel">
          <p class="eyebrow">Host login</p>
          <h2>Beheer is afgeschermd</h2>
          <p class="muted">Log in als host om rondes, ballen, prijzen en winnaars te beheren.</p>
        </div>
        <form class="panel form" id="host-login-form">
          <div class="field">
            <label for="host-user">Gebruikersnaam</label>
            <input id="host-user" name="username" autocomplete="username" required value="${escapeHtml(username)}" />
          </div>
          <div class="field">
            <label for="host-password">Wachtwoord</label>
            <input id="host-password" name="password" type="password" autocomplete="current-password" required />
          </div>
          <button class="button" type="submit">Log in</button>
        </form>
      </section>
    `;

    document.querySelector("#host-login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const user = String(form.get("username") || "");
      const password = String(form.get("password") || "");
      try {
        await api("/api/host/auth-check", {
          method: "POST",
          headers: { "X-Host-User": user, "X-Host-Password": password },
          body: JSON.stringify({}),
        });
        localStorage.setItem("gekkenhuis-host-user", user);
        localStorage.setItem("gekkenhuis-host-password", password);
        hostAuthenticated = true;
        toast("Host ingelogd.");
        render();
      } catch (error) {
        hostAuthenticated = false;
        localStorage.removeItem("gekkenhuis-host-password");
        toast(error.message);
      }
    });
  }

  async function hostPost(path, body) {
    try {
      const hostUser = localStorage.getItem("gekkenhuis-host-user") || "";
      const hostPassword = localStorage.getItem("gekkenhuis-host-password") || "";
      const hostPin = localStorage.getItem("gekkenhuis-host-pin") || "";
      await api(path, {
        method: "POST",
        headers: {
          ...(hostUser || hostPassword ? { "X-Host-User": hostUser, "X-Host-Password": hostPassword } : {}),
          ...(hostPin ? { "X-Host-Pin": hostPin } : {}),
        },
        body: JSON.stringify(body),
      });
      await loadState();
      return true;
    } catch (error) {
      if (error.message.includes("wachtwoord") || error.message.includes("PIN")) {
        hostAuthenticated = false;
        localStorage.removeItem("gekkenhuis-host-password");
        renderHostLogin(localStorage.getItem("gekkenhuis-host-user") || "");
        return false;
      }
      toast(error.message);
      return false;
    }
  }

  async function hostAction(action, message) {
    const ok = await hostPost("/api/host/action", { action });
    if (ok && message) toast(message);
  }

  function renderClaims(claims) {
    if (!claims.length) return `<div class="empty">Nog geen bingo geroepen.</div>`;
    const round = activeRound();
    const prize = prizeForRound(round);
    return `<div class="grid">${claims
      .map((claim) => {
        const player = playerById(claim.speler_id);
        const card = cardById(claim.kaart_id);
        const awardedPrize = claim.prijs_id ? prizeById(claim.prijs_id) : null;
        const claimLabel = `${player?.naam || "Onbekend"} kaart ${card?.kaartnummer || "-"}`;
        return `<div class="claim ${claim.status === "valid" ? "valid" : "invalid"}">
          <strong>${escapeHtml(player?.naam || "Onbekend")} - kaart ${escapeHtml(card?.kaartnummer || "-")}</strong>
          <span>${escapeHtml(claim.message)}</span>
          <span class="muted">${escapeHtml(BINGO_TYPES[claim.bingo_type] || claim.bingo_type)}</span>
          ${awardedPrize ? `<span class="pill">Prijs: ${escapeHtml(awardedPrize.naam)}</span>` : ""}
          ${
            claim.status === "valid"
              ? `<div class="actions">
                  <a class="button good" href="#/winnaar?claim=${claim.claim_id}" aria-label="Open winnaarsscherm voor ${escapeHtml(claimLabel)}">Winnaarsscherm</a>
                  ${prize && prize.status !== "awarded" ? `<button class="button secondary" data-award-prize data-claim-id="${claim.claim_id}" data-prize-id="${prize.prijs_id}" aria-label="Ken prijs ${escapeHtml(prize.naam)} toe aan ${escapeHtml(claimLabel)}">Ken prijs toe</button>` : ""}
                </div>`
              : ""
          }
        </div>`;
      })
      .join("")}</div>`;
  }

  function renderPrizeForm() {
    return `<form class="form prize-form" id="prize-form">
      <div class="field">
        <label for="prize-name">Naam prijs</label>
        <input id="prize-name" name="naam" required maxlength="120" placeholder="Bol.com cadeaubon" />
      </div>
      <div class="field">
        <label for="prize-type">Soort</label>
        <input id="prize-type" name="soort" maxlength="60" value="Cadeaubon" />
      </div>
      <div class="field">
        <label for="prize-amount">Bedrag</label>
        <input id="prize-amount" name="bedrag" maxlength="40" placeholder="EUR 25" />
      </div>
      <div class="field">
        <label for="prize-logo">Logo URL</label>
        <input id="prize-logo" name="logo_url" maxlength="500" placeholder="https://..." />
      </div>
      <div class="field">
        <label for="prize-code">Prijs code</label>
        <input id="prize-code" name="code" maxlength="200" placeholder="Bijvoorbeeld ABCD-1234-EFGH" />
      </div>
      <div class="field">
        <label for="prize-pincode">Pincode</label>
        <input id="prize-pincode" name="pincode" maxlength="120" placeholder="Bijvoorbeeld 1234" />
      </div>
      <div class="field">
        <label for="prize-description">Omschrijving</label>
        <input id="prize-description" name="omschrijving" maxlength="500" placeholder="Waarvoor speelt de winnaar?" />
      </div>
      <button class="button secondary" type="submit">Voeg prijs toe</button>
    </form>`;
  }

  function renderPrizeList(prizes) {
    if (!prizes.length) return `<div class="empty">Nog geen prijzen toegevoegd.</div>`;
    return `<div class="grid">${prizes
      .map((prize) => {
        const prizeId = escapeHtml(prize.prijs_id);
        const isAwarded = prize.status === "awarded";
        return `<form class="form claim" data-prize-edit-form data-prize-id="${prizeId}">
          ${renderPrize(prize, true)}
          <div class="field">
            <label for="edit-prize-name-${prizeId}">Naam prijs</label>
            <input id="edit-prize-name-${prizeId}" name="naam" required maxlength="120" value="${escapeHtml(prize.naam)}" />
          </div>
          <div class="field">
            <label for="edit-prize-type-${prizeId}">Soort</label>
            <input id="edit-prize-type-${prizeId}" name="soort" maxlength="60" value="${escapeHtml(prize.soort || "")}" />
          </div>
          <div class="field">
            <label for="edit-prize-amount-${prizeId}">Bedrag</label>
            <input id="edit-prize-amount-${prizeId}" name="bedrag" maxlength="40" value="${escapeHtml(prize.bedrag || "")}" />
          </div>
          <div class="field">
            <label for="edit-prize-logo-${prizeId}">Logo URL</label>
            <input id="edit-prize-logo-${prizeId}" name="logo_url" maxlength="500" value="${escapeHtml(prize.logo_url || "")}" />
          </div>
          <div class="field">
            <label for="edit-prize-code-${prizeId}">Nieuwe of gewijzigde prijs code</label>
            <input id="edit-prize-code-${prizeId}" name="code" maxlength="200" placeholder="Laat leeg om bestaande code te behouden" />
          </div>
          <div class="field">
            <label for="edit-prize-pincode-${prizeId}">Nieuwe of gewijzigde pincode</label>
            <input id="edit-prize-pincode-${prizeId}" name="pincode" maxlength="120" placeholder="Laat leeg om bestaande pincode te behouden" />
          </div>
          <div class="field">
            <label for="edit-prize-description-${prizeId}">Omschrijving</label>
            <input id="edit-prize-description-${prizeId}" name="omschrijving" maxlength="500" value="${escapeHtml(prize.omschrijving || "")}" />
          </div>
          <div class="actions">
            <button class="button secondary" type="submit">Bewaar prijs</button>
            <button class="button warning" type="button" data-delete-prize data-prize-id="${prizeId}" aria-label="Verwijder prijs ${escapeHtml(prize.naam)}" ${isAwarded ? "disabled" : ""}>Verwijder</button>
          </div>
          ${isAwarded ? `<p class="muted">Toegekende prijzen kunnen niet worden verwijderd.</p>` : ""}
        </form>`;
      })
      .join("")}</div>`;
  }

  function renderRoundList(rounds) {
    if (!rounds.length) return `<div class="empty">Nog geen rondes gevonden.</div>`;
    const activeRoundId = state.activeRoundId;
    const orderedRounds = [...rounds].sort((a, b) => new Date(b.aangemaakt_op || 0) - new Date(a.aangemaakt_op || 0));
    return `<div class="table-wrap"><table>
      <thead><tr><th scope="col">Ronde</th><th scope="col">Status</th><th scope="col">Kaarten</th><th scope="col">Ballen</th><th scope="col">Claims</th><th scope="col">Actie</th></tr></thead>
      <tbody>
        ${orderedRounds
          .map((round) => {
            const isActive = round.ronde_id === activeRoundId;
            const roundId = escapeHtml(round.ronde_id);
            return `<tr>
              <td>${escapeHtml(round.naam)}${isActive ? ` <span class="pill">Actief</span>` : ""}</td>
              <td>${escapeHtml(STATUS_LABELS[round.status] || round.status)}</td>
              <td>${state.cards.filter((card) => card.ronde_id === round.ronde_id).length}</td>
              <td>${drawingsFor(round.ronde_id).length}</td>
              <td>${claimsFor(round.ronde_id).length}</td>
              <td><button class="button warning" type="button" data-delete-round data-round-id="${roundId}" aria-label="Verwijder ronde ${escapeHtml(round.naam)}" ${isActive ? "disabled" : ""}>Verwijder</button></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table></div>`;
  }

  function renderPlayersTable(cards) {
    if (!cards.length) return `<div class="empty">Nog geen spelers. Pak je kaart voordat de chaos begint.</div>`;
    return `<div class="table-wrap"><table>
      <thead><tr><th scope="col">Naam</th><th scope="col">Clubhouse</th><th scope="col">Kaart</th><th scope="col">Status</th><th scope="col">Link</th><th scope="col">Actie</th></tr></thead>
      <tbody>
        ${cards
          .map((card) => {
            const player = playerById(card.speler_id);
            const cardId = escapeHtml(card.kaart_id);
            const playerLabel = `${player?.naam || "Onbekende speler"} kaart ${card.kaartnummer}`;
            return `<tr>
              <td>${escapeHtml(player?.naam || "")}</td>
              <td>${escapeHtml(player?.clubhouse_naam || "")}</td>
              <td>${escapeHtml(card.kaartnummer)}</td>
              <td>${escapeHtml(card.status)}</td>
              <td><a href="#/kaart?id=${cardId}">Open kaart</a></td>
              <td>
                <div class="actions">
                  <button class="button warning" type="button" data-delete-card data-card-id="${cardId}" aria-label="Verwijder ${escapeHtml(playerLabel)}">Verwijder</button>
                  <button class="button secondary" type="button" data-block-card data-card-id="${cardId}" aria-label="Blokkeer toegang voor ${escapeHtml(playerLabel)}">Blokkeer toegang</button>
                </div>
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table></div>`;
  }

  function renderBlockedConnections(blocks) {
    if (!blocks.length) return `<div class="empty">Geen blokkades actief.</div>`;
    return `<div class="table-wrap"><table>
      <thead><tr><th scope="col">Geblokkeerd</th><th scope="col">Sinds</th><th scope="col">Actie</th></tr></thead>
      <tbody>
        ${blocks
          .map((block) => {
            const blockId = escapeHtml(block.block_id);
            const created = block.aangemaakt_op ? new Date(block.aangemaakt_op).toLocaleString("nl-NL") : "-";
            return `<tr>
              <td>${escapeHtml(block.label || "Onbekende speler")}</td>
              <td>${escapeHtml(created)}</td>
              <td><button class="button secondary" type="button" data-unblock-connection data-block-id="${blockId}" aria-label="Deblokkeer ${escapeHtml(block.label || "onbekende speler")}">Deblokkeer</button></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table></div>`;
  }

  function renderLiveScreen() {
    const round = activeRound();
    const drawings = drawingsFor(round.ronde_id);
    const last = drawings.at(-1);
    const prize = prizeForRound(round);
    app.innerHTML = `
      <section class="live-screen">
        <p class="eyebrow">Nieuwe bal getrokken</p>
        <h1>Gekkenhuis Bingo</h1>
        <div class="ball big" role="status" aria-label="${last ? `Laatste bal: ${escapeHtml(last.bal_letter)} ${escapeHtml(last.bal_nummer)}` : "Nog geen bal getrokken"}">${last ? escapeHtml(last.volledige_bal) : "?"}</div>
        <p><strong>We spelen nu voor:</strong> ${escapeHtml(BINGO_TYPES[round.bingo_type])}</p>
        ${renderPrize(prize, true)}
        <p class="muted">${drawings.length} ballen getrokken</p>
        ${renderDrawnBallsText(drawings)}
        ${renderBalls(drawings)}
      </section>
    `;
  }

  function renderWinner() {
    const { params } = route();
    const claim = state.claims.find((item) => item.claim_id === params.get("claim")) || state.claims.find((item) => item.status === "valid");
    if (!claim) {
      app.innerHTML = `<section class="panel"><h2>Nog geen winnaar</h2><p class="muted">Bingo geroepen! Even kijken of dit geen drama is.</p></section>`;
      return;
    }
    const player = playerById(claim.speler_id);
    const card = cardById(claim.kaart_id);
    const round = state.rounds.find((item) => item.ronde_id === claim.ronde_id);
    const prize = claim.prijs_id ? prizeById(claim.prijs_id) : prizeForRound(round);
    app.innerHTML = `
      <section class="winner">
        <div>
          <p class="eyebrow">BINGO! Het gekkenhuis ontploft.</p>
          <h1>${escapeHtml(player?.naam || "Winnaar")}</h1>
          <p class="lede">Winnaar: ${escapeHtml(player?.naam || "")}<br>${escapeHtml(player?.clubhouse_naam || "")}</p>
          ${renderPrize(prize)}
          <p><strong>Kaartnummer:</strong> ${escapeHtml(card?.kaartnummer || "-")}<br><strong>Bingo-type:</strong> ${escapeHtml(BINGO_TYPES[claim.bingo_type])}<br><strong>Ronde:</strong> ${escapeHtml(round?.naam || "")}</p>
          <div class="actions"><a class="button" href="#/trekking">Terug naar live scherm</a></div>
        </div>
      </section>
    `;
  }

  function render() {
    if (!state) {
      app.innerHTML = `<section class="panel"><h2>De ballenmachine draait warm</h2><p class="muted">Even laden...</p></section>`;
      return;
    }
    const current = route();
    const routes = {
      "/": renderHome,
      "/registratie": renderRegistration,
      "/kaart": renderPlayerCard,
      "/host": renderHost,
      "/trekking": renderLiveScreen,
      "/winnaar": renderWinner,
    };
    (routes[current.path] || renderHome)();
  }

  window.addEventListener("hashchange", () => {
    render();
    app.focus();
  });
  if ("EventSource" in window) {
    const events = new EventSource("/api/events");
    events.addEventListener("state-change", loadState);
    events.onerror = () => window.setTimeout(loadState, 2000);
  } else {
    window.setInterval(loadState, 3000);
  }

  render();
  loadState();
})();
