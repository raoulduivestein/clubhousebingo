const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const url = require("url");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "bingo-state.json");
const TRUST_PROXY = process.env.TRUST_PROXY !== "false";
const HOST_PIN = process.env.HOST_PIN || "";
const HOST_USER = process.env.HOST_USER || "";
const HOST_PASSWORD = process.env.HOST_PASSWORD || "";

const LETTERS = ["B", "I", "N", "G", "O"];
const RANGES = {
  B: [1, 15],
  I: [16, 30],
  N: [31, 45],
  G: [46, 60],
  O: [61, 75],
};

const clients = new Set();

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) writeState(seedState());
}

function seedState() {
  const roundId = uid("ronde");
  return {
    activeRoundId: roundId,
    players: [],
    rounds: [
      {
        ronde_id: roundId,
        naam: "Clubhouse Chaos Ronde",
        status: "registration",
        bingo_type: "horizontal",
        registratie_open: true,
        gestart_op: null,
        beeindigd_op: null,
        winnaars: [],
        prijs_id: null,
      },
    ],
    cards: [],
    drawings: [],
    claims: [],
    prizes: [],
    cardCounter: 1000,
  };
}

function readState() {
  ensureDataFile();
  const state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  migrateState(state);
  return state;
}

function migrateState(state) {
  if (!Array.isArray(state.prizes)) state.prizes = [];
  for (const round of state.rounds || []) {
    if (!Object.prototype.hasOwnProperty.call(round, "prijs_id")) round.prijs_id = null;
  }
  for (const prize of state.prizes) {
    if (!Object.prototype.hasOwnProperty.call(prize, "status")) prize.status = prize.toegekend_aan_claim_id ? "awarded" : "available";
  }
}

function writeState(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function mutateState(mutator) {
  const state = readState();
  const result = mutator(state);
  writeState(state);
  broadcastStateChange();
  return result;
}

function activeRound(state) {
  return state.rounds.find((round) => round.ronde_id === state.activeRoundId) || state.rounds[0];
}

function drawingsFor(state, roundId) {
  return state.drawings.filter((drawing) => drawing.ronde_id === roundId).sort((a, b) => a.volgorde - b.volgorde);
}

function cardById(state, cardId) {
  return state.cards.find((card) => card.kaart_id === cardId);
}

function playerById(state, playerId) {
  return state.players.find((player) => player.speler_id === playerId);
}

function prizeById(state, prizeId) {
  return state.prizes.find((prize) => prize.prijs_id === prizeId);
}

function shuffle(values) {
  const copy = values.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sampleRange(min, max, amount) {
  const values = [];
  for (let value = min; value <= max; value += 1) values.push(value);
  return shuffle(values).slice(0, amount).sort((a, b) => a - b);
}

function generateCardNumbers(existingCards) {
  let attempts = 0;
  while (attempts < 400) {
    attempts += 1;
    const grid = Array.from({ length: 5 }, () => Array(5).fill(null));
    LETTERS.forEach((letter, column) => {
      const count = letter === "N" ? 4 : 5;
      const [min, max] = RANGES[letter];
      const numbers = sampleRange(min, max, count);
      let index = 0;
      for (let row = 0; row < 5; row += 1) {
        if (row === 2 && column === 2) {
          grid[row][column] = "GEKKENHUIS";
        } else {
          grid[row][column] = numbers[index];
          index += 1;
        }
      }
    });
    const signature = JSON.stringify(grid);
    const duplicate = existingCards.some((card) => JSON.stringify(card.nummers) === signature);
    if (!duplicate) return grid;
  }
  throw new Error("Kon geen unieke kaart genereren.");
}

function letterForNumber(number) {
  return LETTERS.find((letter) => {
    const [min, max] = RANGES[letter];
    return number >= min && number <= max;
  });
}

function createFullBall(number) {
  return `${letterForNumber(number)}${number}`;
}

function getHitMatrix(card, drawnNumbers) {
  const drawn = new Set(drawnNumbers);
  return card.nummers.map((row, rowIndex) =>
    row.map((value, columnIndex) => {
      if (rowIndex === 2 && columnIndex === 2) return true;
      return drawn.has(value);
    }),
  );
}

function checkPattern(card, drawnNumbers, bingoType) {
  const hits = getHitMatrix(card, drawnNumbers);
  const rowWin = hits.some((row) => row.every(Boolean));
  const columnWin = [0, 1, 2, 3, 4].some((column) => hits.every((row) => row[column]));
  const diagonalWin =
    [0, 1, 2, 3, 4].every((index) => hits[index][index]) ||
    [0, 1, 2, 3, 4].every((index) => hits[index][4 - index]);
  const cornerWin = hits[0][0] && hits[0][4] && hits[4][0] && hits[4][4];
  const fullWin = hits.every((row) => row.every(Boolean));

  return {
    horizontal: rowWin,
    vertical: columnWin,
    diagonal: diagonalWin,
    corners: cornerWin,
    full: fullWin,
  }[bingoType];
}

function evaluateClaim(state, cardId) {
  const round = activeRound(state);
  const card = cardById(state, cardId);
  if (!card) return { status: "invalid", message: "Deze kaart bestaat niet. Geen gekke dingen doen." };
  if (card.ronde_id !== round.ronde_id) {
    return { status: "wrong_round", message: "Deze kaart hoort niet bij deze ronde. Geen gekke dingen doen." };
  }
  if (card.status !== "active") {
    return { status: "inactive", message: "Deze kaart is niet actief." };
  }
  if (round.status !== "playing") {
    if (round.status === "finished") return { status: "finished", message: "Deze ronde is al afgelopen." };
    return { status: "too_early", message: "Deze ronde is nog niet gestart. Terug naar je kaart." };
  }
  const drawnNumbers = drawingsFor(state, round.ronde_id).map((drawing) => drawing.bal_nummer);
  const isValid = checkPattern(card, drawnNumbers, round.bingo_type);
  return isValid
    ? { status: "valid", message: "Geldige bingo! Het gekkenhuis ontploft." }
    : { status: "invalid", message: "Ongeldige bingo. Jij was iets te enthousiast." };
}

function getClientIp(req) {
  const forwarded = TRUST_PROXY ? req.headers["x-forwarded-for"] : "";
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = raw ? raw.split(",")[0].trim() : req.socket.remoteAddress || "unknown";
  return ip.replace(/^::ffff:/, "");
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

function assertHost(req) {
  if (HOST_USER || HOST_PASSWORD) {
    const user = req.headers["x-host-user"];
    const password = req.headers["x-host-password"];
    if (user !== HOST_USER || password !== HOST_PASSWORD) {
      const err = new Error("Host gebruikersnaam of wachtwoord klopt niet.");
      err.statusCode = 401;
      throw err;
    }
    return;
  }
  if (!HOST_PIN) return;
  const pin = req.headers["x-host-pin"];
  if (pin !== HOST_PIN) {
    const err = new Error("Host PIN ontbreekt of klopt niet.");
    err.statusCode = 401;
    throw err;
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, error) {
  sendJson(res, error.statusCode || 500, {
    error: error.message || "Er ging iets mis.",
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(Object.assign(new Error("Request is te groot."), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Ongeldige JSON."), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function broadcastStateChange() {
  for (const res of clients) {
    res.write("event: state-change\n");
    res.write(`data: ${JSON.stringify({ at: nowIso() })}\n\n`);
  }
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ at: nowIso() })}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

function registerPlayer(req, body) {
  const naam = String(body.naam || "").trim().slice(0, 80);
  const clubhouseNaam = String(body.clubhouse_naam || "").trim().slice(0, 80);
  if (!naam) {
    const err = new Error("Naam is verplicht.");
    err.statusCode = 400;
    throw err;
  }

  const ip = getClientIp(req);
  const ipHash = hashIp(ip);
  return mutateState((state) => {
    const round = activeRound(state);
    if (!round.registratie_open || round.status !== "registration") {
      const err = new Error("De registratie is gesloten.");
      err.statusCode = 409;
      throw err;
    }

    const existingCard = state.cards.find((card) => card.ronde_id === round.ronde_id && card.ip_hash === ipHash);
    if (existingCard) {
      const existingPlayer = playerById(state, existingCard.speler_id);
      return { existing: true, card: existingCard, player: existingPlayer };
    }

    const player = {
      speler_id: uid("speler"),
      naam,
      clubhouse_naam: clubhouseNaam,
      aangemaakt_op: nowIso(),
    };
    const cardId = uid("kaart");
    const card = {
      kaart_id: cardId,
      speler_id: player.speler_id,
      ronde_id: round.ronde_id,
      kaartnummer: state.cardCounter + 1,
      nummers: generateCardNumbers(state.cards),
      persoonlijke_link: `#/kaart?id=${cardId}`,
      ip_hash: ipHash,
      status: "active",
      aangemaakt_op: nowIso(),
    };

    state.cardCounter += 1;
    state.players.push(player);
    state.cards.push(card);
    return { existing: false, card, player };
  });
}

function updateRound(body) {
  return mutateState((state) => {
    const round = activeRound(state);
    if (typeof body.naam === "string" && body.naam.trim()) round.naam = body.naam.trim().slice(0, 120);
    if (typeof body.bingo_type === "string") round.bingo_type = body.bingo_type;
    if (Object.prototype.hasOwnProperty.call(body, "prijs_id")) {
      const prizeId = body.prijs_id ? String(body.prijs_id) : null;
      if (prizeId && !prizeById(state, prizeId)) {
        const err = new Error("Deze prijs bestaat niet.");
        err.statusCode = 400;
        throw err;
      }
      round.prijs_id = prizeId;
    }
    return { round };
  });
}

function createPrize(body) {
  const naam = String(body.naam || "").trim().slice(0, 120);
  const soort = String(body.soort || "Cadeaubon").trim().slice(0, 60);
  const bedrag = String(body.bedrag || "").trim().slice(0, 40);
  const logoUrl = String(body.logo_url || "").trim().slice(0, 500);
  const omschrijving = String(body.omschrijving || "").trim().slice(0, 500);
  if (!naam) {
    const err = new Error("Prijsnaam is verplicht.");
    err.statusCode = 400;
    throw err;
  }

  return mutateState((state) => {
    const prize = {
      prijs_id: uid("prijs"),
      naam,
      soort,
      bedrag,
      logo_url: logoUrl,
      omschrijving,
      status: "available",
      toegekend_aan_claim_id: null,
      toegekend_op: null,
      aangemaakt_op: nowIso(),
    };
    state.prizes.push(prize);
    return { prize };
  });
}

function awardPrize(body) {
  const prizeId = String(body.prijs_id || "");
  const claimId = String(body.claim_id || "");
  return mutateState((state) => {
    const prize = prizeById(state, prizeId);
    const claim = state.claims.find((item) => item.claim_id === claimId);
    if (!prize) {
      const err = new Error("Deze prijs bestaat niet.");
      err.statusCode = 404;
      throw err;
    }
    if (!claim || claim.status !== "valid") {
      const err = new Error("Prijs kan alleen aan een geldige bingo worden toegekend.");
      err.statusCode = 400;
      throw err;
    }
    prize.status = "awarded";
    prize.toegekend_aan_claim_id = claim.claim_id;
    prize.toegekend_op = nowIso();
    claim.prijs_id = prize.prijs_id;
    return { prize, claim };
  });
}

function setRoundStatus(action) {
  return mutateState((state) => {
    const round = activeRound(state);
    if (action === "toggle-registration") {
      round.registratie_open = !round.registratie_open;
      round.status = round.registratie_open ? "registration" : "ready";
    }
    if (action === "start") {
      round.status = "playing";
      round.registratie_open = false;
      round.gestart_op = round.gestart_op || nowIso();
    }
    if (action === "pause") {
      round.status = round.status === "paused" ? "playing" : "paused";
    }
    if (action === "finish") {
      round.status = "finished";
      round.registratie_open = false;
      round.beeindigd_op = nowIso();
    }
    if (action === "new") {
      const roundId = uid("ronde");
      const nextRound = {
        ronde_id: roundId,
        naam: `Gekkenhuis Ronde ${state.rounds.length + 1}`,
        status: "registration",
        bingo_type: "horizontal",
        registratie_open: true,
        gestart_op: null,
        beeindigd_op: null,
        winnaars: [],
        prijs_id: null,
      };
      state.rounds.push(nextRound);
      state.activeRoundId = roundId;
      return { round: nextRound };
    }
    return { round: activeRound(state) };
  });
}

function drawBall() {
  return mutateState((state) => {
    const round = activeRound(state);
    if (round.status !== "playing") {
      const err = new Error("Het spel is niet bezig.");
      err.statusCode = 409;
      throw err;
    }
    const drawn = new Set(drawingsFor(state, round.ronde_id).map((drawing) => drawing.bal_nummer));
    const remaining = [];
    for (let number = 1; number <= 75; number += 1) {
      if (!drawn.has(number)) remaining.push(number);
    }
    if (!remaining.length) {
      const err = new Error("Alle ballen zijn al getrokken.");
      err.statusCode = 409;
      throw err;
    }
    const number = remaining[crypto.randomInt(remaining.length)];
    const drawing = {
      trekking_id: uid("trekking"),
      ronde_id: round.ronde_id,
      bal_letter: letterForNumber(number),
      bal_nummer: number,
      volledige_bal: createFullBall(number),
      volgorde: drawn.size + 1,
      getrokken_op: nowIso(),
    };
    state.drawings.push(drawing);
    return { drawing };
  });
}

function claimBingo(body) {
  const cardId = String(body.kaart_id || "");
  return mutateState((state) => {
    const card = cardById(state, cardId);
    const round = activeRound(state);
    const result = evaluateClaim(state, cardId);
    const claim = {
      claim_id: uid("claim"),
      speler_id: card?.speler_id || null,
      kaart_id: cardId,
      ronde_id: card?.ronde_id || round.ronde_id,
      status: result.status,
      bingo_type: round.bingo_type,
      message: result.message,
      geclaimd_op: nowIso(),
      gecontroleerd_op: nowIso(),
    };
    state.claims.push(claim);
    if (result.status === "valid" && !round.winnaars.includes(claim.claim_id)) {
      round.winnaars.push(claim.claim_id);
    }
    return { claim, result };
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  }[ext] || "application/octet-stream";
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const requested = path.normalize(path.join(__dirname, safePath));
  if (!requested.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(requested, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Niet gevonden");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType(requested),
      "Cache-Control": requested.endsWith(".html") ? "no-cache" : "public, max-age=60",
    });
    res.end(data);
  });
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/state" && req.method === "GET") {
    sendJson(res, 200, readState());
    return;
  }
  if (pathname === "/api/events" && req.method === "GET") {
    handleEvents(req, res);
    return;
  }

  const body = await readJson(req);

  if (pathname === "/api/register" && req.method === "POST") {
    sendJson(res, 200, registerPlayer(req, body));
    return;
  }

  if (pathname.startsWith("/api/host/")) assertHost(req);

  if (pathname === "/api/host/round" && req.method === "POST") {
    sendJson(res, 200, updateRound(body));
    return;
  }
  if (pathname === "/api/host/prizes" && req.method === "POST") {
    sendJson(res, 200, createPrize(body));
    return;
  }
  if (pathname === "/api/host/award-prize" && req.method === "POST") {
    sendJson(res, 200, awardPrize(body));
    return;
  }
  if (pathname === "/api/host/action" && req.method === "POST") {
    sendJson(res, 200, setRoundStatus(String(body.action || "")));
    return;
  }
  if (pathname === "/api/host/draw" && req.method === "POST") {
    sendJson(res, 200, drawBall());
    return;
  }
  if (pathname === "/api/claim" && req.method === "POST") {
    sendJson(res, 200, claimBingo(body));
    return;
  }

  sendJson(res, 404, { error: "API route niet gevonden." });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url || "/");
    const pathname = decodeURIComponent(parsed.pathname || "/");
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }
    serveStatic(req, res, pathname);
  } catch (error) {
    sendError(res, error);
  }
});

ensureDataFile();
server.listen(PORT, () => {
  console.log(`Gekkenhuis Bingo draait op http://127.0.0.1:${PORT}`);
  if (HOST_USER || HOST_PASSWORD) console.log("Host login beveiliging staat aan.");
  else if (HOST_PIN) console.log("Host PIN beveiliging staat aan.");
});
