import {
  db,
  collection,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
} from "./firebase.js";
import { ROOMS, GAMES, ADMIN_PIN, HYPE_MESSAGES } from "./data.js";

const LOGS_COL = collection(db, "logs");
const LOCKS_DOC = doc(db, "meta", "locks");
const STORAGE_KEY = "wayneGangUser";

let allLogs = []; // live cache of every doc in `logs`, kept in sync via onSnapshot
let lockedGames = {}; // { [gameId]: true } for games the admin has locked
let currentUser = null; // { room }
let logoSvgText = null;
let currentPin = "";
let wheelResultsByGame = {}; // gameId -> pending shot result awaiting log

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------

async function boot() {
  try {
    const res = await fetch("wayne-gang-logo.svg");
    if (!res.ok) throw new Error(`Logo fetch failed: ${res.status}`);
    logoSvgText = await res.text();
  } catch (e) {
    console.error(e);
    logoSvgText = null; // renderLogoInto() falls back to text if this is null
  }
  renderLogoInto(document.getElementById("login-logo-slot"), "login-logo");

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    currentUser = JSON.parse(saved);
    startMainApp();
  } else {
    setupLoginScreen();
  }

  listenToLogs();
  listenToLocks();
  setupNav();
  setupAdmin();
}

function renderLogoInto(el, className) {
  if (!el) return;
  if (!logoSvgText) {
    // Logo file didn't load — fall back to plain text instead of breaking the layout.
    el.innerHTML = `<div class="logo-fallback ${className || ""}">WAYNE GANG</div>`;
    return;
  }
  el.innerHTML = logoSvgText;
  const svg = el.querySelector("svg");
  if (svg) svg.classList.add(className || "");
}

function setTeamColor(roomId) {
  const room = ROOMS[roomId];
  document.documentElement.style.setProperty("--team-color", room.color);
}

// ---------------------------------------------------------------
// Login
// ---------------------------------------------------------------

function setupLoginScreen() {
  const grid = document.getElementById("room-grid");
  grid.innerHTML = "";
  Object.values(ROOMS).forEach((room) => {
    const btn = document.createElement("button");
    btn.className = `room-choice room-${room.id}`;
    btn.innerHTML = `
      <div>
        <div class="room-name">${room.label}</div>
        <div class="room-members">${room.members.length ? room.members.join(", ") : "TBD"}</div>
      </div>
      <div class="swatch"></div>
    `;
    btn.addEventListener("click", () => {
      currentUser = { room: room.id };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
      startMainApp();
    });
    grid.appendChild(btn);
  });
}

function startMainApp() {
  setTeamColor(currentUser.room);
  document.getElementById("screen-login").classList.add("hidden");
  document.getElementById("main-app").classList.remove("hidden");
  document.getElementById("who-room").textContent = ROOMS[currentUser.room].label;
  renderLogoInto(document.getElementById("topbar-logo-slot"), "topbar-logo");

  document.getElementById("switch-room-btn").addEventListener("click", () => {
    if (!confirm("Switch room on this phone?")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  renderGamesList();
  renderInfoRooms();
}

// ---------------------------------------------------------------
// Firestore sync
// ---------------------------------------------------------------

function listenToLogs() {
  const q = query(LOGS_COL, orderBy("timestamp", "desc"));
  onSnapshot(
    q,
    (snap) => {
      allLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentUser) {
        renderGamesList();
        renderLeaderboard();
        renderAuditList();
      }
    },
    (err) => {
      console.error("Snapshot error", err);
    }
  );
}

function listenToLocks() {
  onSnapshot(
    LOCKS_DOC,
    (snap) => {
      lockedGames = snap.exists() ? snap.data() : {};
      if (currentUser) renderGamesList();
      renderLockStatus();
    },
    (err) => console.error("Lock snapshot error", err)
  );
}

function countFor(gameId, subGameId, roomId) {
  return allLogs
    .filter(
      (l) =>
        l.gameId === gameId &&
        (subGameId ? l.subGameId === subGameId : !l.subGameId) &&
        l.room === roomId
    )
    .reduce((sum, l) => sum + (l.type === "adjustment" ? l.delta : 1), 0);
}

let toastTimer = null;
let audioCtx = null;

function playLogSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = "sine";
    const t = audioCtx.currentTime;
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(1100, t + 0.1);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.26);
  } catch (e) {
    // Audio isn't critical — fail silently if the browser blocks it.
  }
}

function showToast() {
  const el = document.getElementById("toast");
  const msg = HYPE_MESSAGES[Math.floor(Math.random() * HYPE_MESSAGES.length)];
  el.textContent = msg;
  el.classList.remove("show");
  void el.offsetWidth; // restart animation even if a toast is already mid-fade
  el.classList.add("show");
  playLogSound();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1000);
}

async function logDrink(gameId, subGameId, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.classList.add("saving");
  }
  try {
    await addDoc(LOGS_COL, {
      room: currentUser.room,
      gameId,
      subGameId: subGameId || null,
      type: "log",
      timestamp: serverTimestamp(),
    });
    showToast();
  } catch (e) {
    console.error(e);
    if (btnEl) {
      const fail = document.createElement("div");
      fail.className = "log-fail";
      fail.textContent = "Did not save — ask Christian to update";
      btnEl.parentElement.appendChild(fail);
      setTimeout(() => fail.remove(), 6000);
    }
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.classList.remove("saving");
    }
  }
}

// ---------------------------------------------------------------
// Games screen
// ---------------------------------------------------------------

function renderGamesList() {
  const list = document.getElementById("games-list");
  list.innerHTML = "";
  GAMES.forEach((game) => {
    const card = document.createElement("div");
    card.className = "game-card";

    if (lockedGames[game.id]) {
      card.classList.add("locked");
      card.innerHTML = `
        <div class="game-head"><h2>${game.name}</h2></div>
        <div class="subtitle">${game.subtitle}</div>
        <div class="locked-note">🔒 Locked right now — check back soon.</div>
      `;
      list.appendChild(card);
      return;
    }

    if (game.type === "simple") {
      card.innerHTML = `
        <div class="game-head"><h2>${game.name}</h2></div>
        <div class="subtitle">${game.subtitle}</div>
        ${yourScoreHtml(game.id, null)}
        <button class="log-btn" data-game="${game.id}">Log a Drink</button>
        <div class="other-rooms">${otherRoomsHtml(game.id, null)}</div>
      `;
      card.querySelector(".log-btn").addEventListener("click", (e) =>
        logDrink(game.id, null, e.currentTarget)
      );
    } else if (game.type === "multi") {
      card.innerHTML = `
        <div class="game-head"><h2>${game.name}</h2></div>
        <div class="subtitle">${game.subtitle}</div>
        <div class="bar-list">
          ${game.subGames
            .map((sg) => {
              const room = ROOMS[currentUser.room];
              const yourCount = countFor(game.id, sg.id, room.id);
              const others = Object.values(ROOMS)
                .filter((r) => r.id !== room.id)
                .map(
                  (r) =>
                    `<div class="other-room"><span class="rn" style="color:${r.color}">${r.label}</span><span class="rv">${countFor(game.id, sg.id, r.id)}</span></div>`
                )
                .join("");
              return `
              <div class="bar-row">
                <div class="bar-row-head">
                  <div class="bar-name">${sg.name}</div>
                  <div class="bar-your-score" style="color:${room.color}">${yourCount}</div>
                </div>
                <button class="bar-log-btn" data-game="${game.id}" data-sub="${sg.id}">+1 Drink</button>
                <div class="bar-others">${others}</div>
              </div>`;
            })
            .join("")}
        </div>
      `;
      card.querySelectorAll("button[data-sub]").forEach((btn) => {
        btn.addEventListener("click", (e) =>
          logDrink(e.currentTarget.dataset.game, e.currentTarget.dataset.sub, e.currentTarget)
        );
      });
    } else if (game.type === "wheel") {
      card.innerHTML = `
        <div class="game-head"><h2>${game.name}</h2></div>
        <div class="subtitle">${game.subtitle}</div>
        ${yourScoreHtml(game.id, null)}
        <div class="wheel-wrap">
          <div class="wheel-outer">
            <div class="wheel-pointer"></div>
            <div class="wheel" id="wheel-${game.id}"></div>
          </div>
          <div class="wheel-result" id="wheel-result-${game.id}"></div>
          <button class="spin-btn" id="spin-btn-${game.id}">Spin the Wheel</button>
          <button class="confirm-shot hidden" id="confirm-btn-${game.id}">Log This Shot</button>
          <div class="wheel-note">Binding — whatever it lands on, you drink. No respins.</div>
        </div>
        <div class="other-rooms">${otherRoomsHtml(game.id, null)}</div>
      `;
      buildWheel(game, card.querySelector(`#wheel-${game.id}`));
      card.querySelector(`#spin-btn-${game.id}`).addEventListener("click", () =>
        spinWheel(game)
      );
      card.querySelector(`#confirm-btn-${game.id}`).addEventListener("click", (e) => {
        logDrink(game.id, null, e.currentTarget);
        e.currentTarget.classList.add("hidden");
        document.getElementById(`spin-btn-${game.id}`).classList.remove("hidden");
        document.getElementById(`spin-btn-${game.id}`).disabled = false;
        document.getElementById(`wheel-result-${game.id}`).textContent = "";
      });
    }

    list.appendChild(card);
  });
}

function yourScoreHtml(gameId, subGameId) {
  const room = ROOMS[currentUser.room];
  const n = countFor(gameId, subGameId, room.id);
  return `
    <div class="your-score">
      <div class="your-score-num" style="color:${room.color}">${n}</div>
    </div>`;
}

function otherRoomsHtml(gameId, subGameId) {
  return Object.values(ROOMS)
    .filter((r) => r.id !== currentUser.room)
    .map(
      (r) => `
      <div class="other-room">
        <span class="rn" style="color:${r.color}">${r.label}</span>
        <span class="rv">${countFor(gameId, subGameId, r.id)}</span>
      </div>`
    )
    .join("");
}

// ---------------------------------------------------------------
// Shot Roulette wheel
// ---------------------------------------------------------------

function polar(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function buildWheel(game, container) {
  const segments = game.segments;
  const n = segments.length;
  const per = 360 / n;
  const cx = 110,
    cy = 110,
    r = 105;
  const colors = ["#1c2330", "#262d3a"];

  let svg = `<svg viewBox="0 0 220 220" width="100%" height="100%">`;
  segments.forEach((label, i) => {
    const start = i * per;
    const end = start + per;
    const p1 = polar(cx, cy, r, start);
    const p2 = polar(cx, cy, r, end);
    const largeArc = per > 180 ? 1 : 0;
    const mid = start + per / 2;
    const textPos = polar(cx, cy, r * 0.62, mid);
    svg += `<path d="M ${cx} ${cy} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z" fill="${colors[i % 2]}" stroke="#0b0e14" stroke-width="1"/>`;
    svg += `<text x="${textPos.x.toFixed(2)}" y="${textPos.y.toFixed(2)}" fill="#f5f7fa" font-size="12" font-family="Inter, sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="middle" transform="rotate(${mid.toFixed(2)} ${textPos.x.toFixed(2)} ${textPos.y.toFixed(2)})">${label}</text>`;
  });
  svg += `</svg>`;
  container.innerHTML = svg;
  container.dataset.rotation = "0";
}

function spinWheel(game) {
  const wheelEl = document.getElementById(`wheel-${game.id}`);
  const spinBtn = document.getElementById(`spin-btn-${game.id}`);
  const resultEl = document.getElementById(`wheel-result-${game.id}`);
  const confirmBtn = document.getElementById(`confirm-btn-${game.id}`);

  spinBtn.disabled = true;
  resultEl.textContent = "";
  confirmBtn.classList.add("hidden");

  const n = game.segments.length;
  const per = 360 / n;
  const winnerIndex = Math.floor(Math.random() * n);
  const midOfWinner = winnerIndex * per + per / 2;
  const spins = 5;
  const targetRotation = spins * 360 + (360 - midOfWinner);

  wheelEl.style.transition = "none";
  wheelEl.style.transform = "rotate(0deg)";
  // force reflow so the reset actually applies before animating again
  void wheelEl.offsetWidth;
  wheelEl.style.transition = "transform 4s cubic-bezier(0.15,0.85,0.25,1)";
  wheelEl.style.transform = `rotate(${targetRotation}deg)`;

  setTimeout(() => {
    resultEl.textContent = game.segments[winnerIndex];
    spinBtn.classList.add("hidden");
    confirmBtn.classList.remove("hidden");
  }, 4100);
}

// ---------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------

function scoringUnits() {
  // returns a flat list of { gameId, subGameId, name } for every independently-scored contest
  const units = [];
  GAMES.forEach((g) => {
    if (g.type === "multi") {
      g.subGames.forEach((sg) => units.push({ gameId: g.id, subGameId: sg.id, name: sg.name }));
    } else {
      units.push({ gameId: g.id, subGameId: null, name: g.name });
    }
  });
  return units;
}

function leaderOf(gameId, subGameId) {
  const counts = Object.values(ROOMS).map((r) => ({
    room: r.id,
    n: countFor(gameId, subGameId, r.id),
  }));
  const max = Math.max(...counts.map((c) => c.n));
  const leaders = counts.filter((c) => c.n === max && max > 0);
  return { leaders: leaders.map((l) => l.room), max, counts };
}

function renderLeaderboard() {
  // Overall leader = room with the most "unit wins" (outright, non-tied leads)
  const wins = { 1: 0, 2: 0, 3: 0 };
  scoringUnits().forEach((u) => {
    const { leaders } = leaderOf(u.gameId, u.subGameId);
    if (leaders.length === 1) wins[leaders[0]]++;
  });
  const topWins = Math.max(...Object.values(wins));
  const overallLeaders = Object.entries(wins)
    .filter(([, w]) => w === topWins)
    .map(([room]) => Number(room));

  const strip = document.getElementById("leader-strip");
  const dot = document.getElementById("leader-dot");
  const text = document.getElementById("leader-text");
  if (topWins === 0) {
    dot.style.background = "#8b94a6";
    text.textContent = "No logs yet";
  } else if (overallLeaders.length === 1) {
    const r = ROOMS[overallLeaders[0]];
    dot.style.background = r.color;
    text.textContent = `${r.label} leads overall`;
  } else {
    dot.style.background = "linear-gradient(90deg,#fff,#fff)";
    text.textContent = `${overallLeaders.map((r) => ROOMS[r].label).join(" & ")} tied for the overall lead`;
  }

  const boxes = document.getElementById("lb-boxes");
  boxes.innerHTML = "";
  scoringUnits().forEach((u) => {
    const { leaders, counts } = leaderOf(u.gameId, u.subGameId);
    const box = document.createElement("div");
    let cls = "lb-box";
    let style = "";
    if (leaders.length === 1) {
      cls += ` lead-${leaders[0]}`;
    } else if (leaders.length === 2) {
      cls += " split";
      style = `--split-a:${ROOMS[leaders[0]].color}; --split-b:${ROOMS[leaders[1]].color};`;
    } else if (leaders.length === 3) {
      cls += " split";
      style = `--split-a:${ROOMS[1].color}; --split-b:${ROOMS[2].color};`;
    }
    box.className = cls;
    box.style = style;
    box.innerHTML = `
      <div class="lb-title">${u.name}</div>
      ${counts
        .map(
          (c) => `<div class="lb-row"><span>${ROOMS[c.room].label}</span><span class="n">${c.n}</span></div>`
        )
        .join("")}
    `;
    boxes.appendChild(box);
  });

  renderFeed();
}

function renderFeed() {
  const feed = document.getElementById("lb-feed");
  if (!allLogs.length) {
    feed.innerHTML = `<div class="empty-note">No drinks logged yet — first one's on you.</div>`;
    return;
  }
  feed.innerHTML = allLogs
    .slice(0, 60)
    .map((l) => {
      const room = ROOMS[l.room];
      const gameName = gameLabel(l.gameId, l.subGameId);
      const text =
        l.type === "adjustment"
          ? `Admin adjusted ${gameName} for ${room.label} (${l.delta > 0 ? "+" : ""}${l.delta})`
          : `${room.label} logged ${gameName}`;
      return `
        <div class="feed-item">
          <div class="who" style="color:${room.color}">${text}</div>
          <div class="when">${formatTime(l.timestamp)}</div>
        </div>`;
    })
    .join("");
}

function gameLabel(gameId, subGameId) {
  const g = GAMES.find((g) => g.id === gameId);
  if (!g) return gameId;
  if (subGameId) {
    const sg = g.subGames.find((s) => s.id === subGameId);
    return sg ? sg.name : g.name;
  }
  return g.name;
}

function formatTime(ts) {
  if (!ts || !ts.toDate) return "just now";
  const d = ts.toDate();
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------
// Info screen
// ---------------------------------------------------------------

function renderInfoRooms() {
  const el = document.getElementById("room-list-info");
  el.innerHTML = Object.values(ROOMS)
    .map(
      (r) => `
      <div class="r">
        <div class="dot" style="background:${r.color}"></div>
        <div>${r.label} — ${r.members.length ? r.members.join(", ") : "TBD"}</div>
      </div>`
    )
    .join("");
}

// ---------------------------------------------------------------
// Bottom nav
// ---------------------------------------------------------------

function setupNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ["games", "leaderboard", "info"].forEach((s) => {
        document.getElementById(`screen-${s}`).classList.toggle("hidden", s !== btn.dataset.screen);
      });
      if (btn.dataset.screen === "leaderboard") renderLeaderboard();
    });
  });
}

// ---------------------------------------------------------------
// Admin
// ---------------------------------------------------------------

function setupAdmin() {
  document.getElementById("open-admin-btn").addEventListener("click", openAdminPin);
  document.getElementById("cancel-admin-btn").addEventListener("click", closeAdminPin);
  document.getElementById("close-admin-btn").addEventListener("click", () => {
    document.getElementById("screen-admin-panel").classList.add("hidden");
    document.getElementById("main-app").classList.remove("hidden");
  });

  const keysEl = document.getElementById("pin-keys");
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].forEach((k) => {
    const b = document.createElement("button");
    b.textContent = k;
    b.addEventListener("click", () => handlePinKey(k));
    keysEl.appendChild(b);
  });

  // populate admin selects
  const roomSel = document.getElementById("adj-room");
  roomSel.innerHTML = Object.values(ROOMS).map((r) => `<option value="${r.id}">${r.label}</option>`).join("");

  const gameSel = document.getElementById("adj-game");
  gameSel.innerHTML = GAMES.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
  gameSel.addEventListener("change", updateAdjSubgameVisibility);
  updateAdjSubgameVisibility();

  const resetSel = document.getElementById("reset-game");
  resetSel.innerHTML = GAMES.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");

  const lockSel = document.getElementById("lock-game-select");
  lockSel.innerHTML = GAMES.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
  document.getElementById("lock-btn").addEventListener("click", () =>
    setGameLock(lockSel.value, true)
  );
  document.getElementById("unlock-btn").addEventListener("click", () =>
    setGameLock(lockSel.value, false)
  );

  document.getElementById("adj-submit").addEventListener("click", submitAdjustment);
  document.getElementById("reset-submit").addEventListener("click", submitReset);
}

async function setGameLock(gameId, locked) {
  await setDoc(LOCKS_DOC, { [gameId]: locked }, { merge: true });
}

function renderLockStatus() {
  const el = document.getElementById("lock-status");
  if (!el) return;
  const locked = GAMES.filter((g) => lockedGames[g.id]).map((g) => g.name);
  el.textContent = locked.length ? `Currently locked: ${locked.join(", ")}` : "Nothing is locked right now.";
}

function updateAdjSubgameVisibility() {
  const gameId = document.getElementById("adj-game").value;
  const game = GAMES.find((g) => g.id === gameId);
  const subSel = document.getElementById("adj-subgame");
  if (game && game.type === "multi") {
    subSel.classList.remove("hidden");
    subSel.innerHTML = game.subGames.map((sg) => `<option value="${sg.id}">${sg.name}</option>`).join("");
  } else {
    subSel.classList.add("hidden");
    subSel.innerHTML = "";
  }
}

function openAdminPin() {
  currentPin = "";
  updatePinDots();
  document.getElementById("pin-error").textContent = "";
  document.getElementById("main-app").classList.add("hidden");
  document.getElementById("screen-admin-pin").classList.remove("hidden");
  document.getElementById("screen-admin-pin").style.display = "flex";
}

function closeAdminPin() {
  document.getElementById("screen-admin-pin").classList.add("hidden");
  document.getElementById("main-app").classList.remove("hidden");
}

function handlePinKey(k) {
  if (k === "⌫") {
    currentPin = currentPin.slice(0, -1);
  } else if (k === "OK") {
    if (currentPin === ADMIN_PIN) {
      document.getElementById("screen-admin-pin").classList.add("hidden");
      document.getElementById("screen-admin-panel").classList.remove("hidden");
      renderAuditList();
    } else {
      document.getElementById("pin-error").textContent = "Wrong PIN";
      currentPin = "";
    }
  } else if (currentPin.length < 4) {
    currentPin += k;
  }
  updatePinDots();
}

function updatePinDots() {
  const dots = document.getElementById("pin-dots");
  dots.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const d = document.createElement("div");
    d.className = "d" + (i < currentPin.length ? " filled" : "");
    dots.appendChild(d);
  }
}

async function submitAdjustment() {
  const room = Number(document.getElementById("adj-room").value);
  const gameId = document.getElementById("adj-game").value;
  const game = GAMES.find((g) => g.id === gameId);
  const subGameId = game.type === "multi" ? document.getElementById("adj-subgame").value : null;
  const amount = Number(document.getElementById("adj-amount").value) || 0;
  if (!amount) return;

  await addDoc(LOGS_COL, {
    name: "Admin",
    room,
    gameId,
    subGameId,
    type: "adjustment",
    delta: amount,
    timestamp: serverTimestamp(),
  });
  document.getElementById("adj-amount").value = "1";
}

async function submitReset() {
  const gameId = document.getElementById("reset-game").value;
  const game = GAMES.find((g) => g.id === gameId);
  if (!confirm(`Wipe every log for "${game.name}"? This can't be undone.`)) return;
  const toDelete = allLogs.filter((l) => l.gameId === gameId);
  for (const l of toDelete) {
    await deleteDoc(doc(db, "logs", l.id));
  }
}

function renderAuditList() {
  const el = document.getElementById("audit-list");
  if (!el || document.getElementById("screen-admin-panel").classList.contains("hidden")) return;
  el.innerHTML = allLogs
    .map((l) => {
      const room = ROOMS[l.room];
      const label = gameLabel(l.gameId, l.subGameId);
      const desc =
        l.type === "adjustment"
          ? `Admin adjusted ${label} for ${room.label} (${l.delta > 0 ? "+" : ""}${l.delta})`
          : `${room.label} logged ${label}`;
      return `
        <div class="audit-row">
          <div class="meta">${desc}<br/><span style="color:var(--text-muted)">${formatTime(l.timestamp)}</span></div>
          <button data-id="${l.id}">Undo</button>
        </div>`;
    })
    .join("");
  el.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      await deleteDoc(doc(db, "logs", e.currentTarget.dataset.id));
    });
  });
}

boot();
