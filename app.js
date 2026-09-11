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
import { ROOMS, GAMES, ADMIN_PIN, HYPE_MESSAGES, RESPIN_COOLDOWN_MINUTES } from "./data.js";

const LOGS_COL = collection(db, "logs");
const LOCKS_DOC = doc(db, "meta", "locks");
const SHOT_SPINS_DOC = doc(db, "meta", "shotSpins");
const STORAGE_KEY = "wayneGangUser";

let allLogs = []; // live cache of every doc in `logs`, kept in sync via onSnapshot
let lockedGames = {}; // { [gameId]: true } for games the admin has locked
let shotSpins = {}; // { [roomId]: lastSpinTimestampMs } for the Shot Roulette cooldown
let pendingSpinGameIds = new Set(); // games with an in-flight spin animation/unconfirmed result — re-renders skip these so a concurrent log elsewhere doesn't wipe the animation
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
  listenToShotSpins();
  setupNav();
  setupAdmin();
  setInterval(safeRenderGamesList, 15000); // keeps the respin countdown display fresh
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

function safeRenderGamesList() {
  if (currentUser && pendingSpinGameIds.size === 0) renderGamesList();
}

function listenToLogs() {
  const q = query(LOGS_COL, orderBy("timestamp", "desc"));
  onSnapshot(
    q,
    (snap) => {
      allLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      safeRenderGamesList();
      if (currentUser) {
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
      safeRenderGamesList();
      renderLockStatus();
    },
    (err) => console.error("Lock snapshot error", err)
  );
}

function listenToShotSpins() {
  onSnapshot(
    SHOT_SPINS_DOC,
    (snap) => {
      shotSpins = snap.exists() ? snap.data() : {};
      safeRenderGamesList();
    },
    (err) => console.error("Shot spin snapshot error", err)
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

  // Live overall summary — simple ticker, not a podium, so it doesn't read
  // like it's the point of the app.
  list.insertAdjacentHTML("beforeend", tickerHtmlFromCounts("Most Drinks Overall", totalDrinksByRoom()));

  GAMES.forEach((game) => {
    const card = document.createElement("div");
    card.className = "game-card";

    if (lockedGames[game.id]) {
      card.classList.add("locked");
      card.innerHTML = `
        <div class="point-badge">${game.type === "multi" ? "5 Points" : "1 Point"}</div>
        <div class="game-head"><h2>${game.name}</h2></div>
        <div class="subtitle">${game.subtitle}</div>
        <div class="locked-note">🔒 Locked right now — check back soon.</div>
      `;
      list.appendChild(card);
      return;
    }

    if (game.type === "simple") {
      card.innerHTML = `
        <div class="point-badge">1 Point</div>
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
        <div class="point-badge">5 Points</div>
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
      const roomId = currentUser.room;
      const lastSpin = shotSpins[roomId];
      const cooldownMs = RESPIN_COOLDOWN_MINUTES * 60 * 1000;
      const remainingMs = lastSpin ? cooldownMs - (Date.now() - lastSpin) : 0;
      const onCooldown = remainingMs > 0;

      card.innerHTML = `
        <div class="point-badge">1 Point</div>
        <div class="game-head"><h2>${game.name}</h2></div>
        <div class="subtitle">${game.subtitle}</div>
        ${yourScoreHtml(game.id, null)}
        <div class="slot-wrap">
          <div class="slot-window" id="slot-window-${game.id}">
            <div class="slot-highlight"></div>
            <div class="slot-strip" id="slot-strip-${game.id}"></div>
          </div>
          <div class="wheel-result" id="wheel-result-${game.id}"></div>
          ${
            onCooldown
              ? `<div class="cooldown-note">🔒 Respin available in ${Math.ceil(remainingMs / 60000)} min</div>`
              : `<button class="spin-btn" id="spin-btn-${game.id}">Spin</button>`
          }
          <button class="confirm-shot hidden" id="confirm-btn-${game.id}">Log This Shot</button>
          <div class="wheel-note">Whatever it lands on, you drink.</div>
        </div>
        <div class="other-rooms">${otherRoomsHtml(game.id, null)}</div>
      `;
      buildSlotStrip(game, card.querySelector(`#slot-strip-${game.id}`));

      const spinBtn = card.querySelector(`#spin-btn-${game.id}`);
      if (spinBtn) spinBtn.addEventListener("click", () => trySpin(game));

      card.querySelector(`#confirm-btn-${game.id}`).addEventListener("click", (e) => {
        pendingSpinGameIds.delete(game.id);
        logDrink(game.id, null, e.currentTarget);
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
// Shot Roulette slot machine
// ---------------------------------------------------------------

const SLOT_ITEM_WIDTH = 150;
const SLOT_REPEATS = 14;

function buildSlotStrip(game, container) {
  let html = "";
  for (let r = 0; r < SLOT_REPEATS; r++) {
    game.segments.forEach((label) => {
      html += `<div class="slot-item" style="width:${SLOT_ITEM_WIDTH}px;">${label}</div>`;
    });
  }
  container.innerHTML = html;
  container.style.transition = "none";
  container.style.transform = "translateX(0px)";
}

function trySpin(game) {
  const roomId = currentUser.room;
  const hasSpunBefore = !!shotSpins[roomId];

  const proceed = () => runSpin(game);

  if (hasSpunBefore) {
    const ok = confirm(
      `Spinning again locks ${ROOMS[roomId].label} out of Shot Roulette for ${RESPIN_COOLDOWN_MINUTES} minutes. Continue?`
    );
    if (!ok) return;
  }
  proceed();
}

async function runSpin(game) {
  pendingSpinGameIds.add(game.id);

  const stripEl = document.getElementById(`slot-strip-${game.id}`);
  const windowEl = document.getElementById(`slot-window-${game.id}`);
  const spinBtn = document.getElementById(`spin-btn-${game.id}`);
  const resultEl = document.getElementById(`wheel-result-${game.id}`);
  const confirmBtn = document.getElementById(`confirm-btn-${game.id}`);

  if (spinBtn) spinBtn.disabled = true;
  resultEl.textContent = "";
  confirmBtn.classList.add("hidden");

  const n = game.segments.length;
  const winnerIndex = Math.floor(Math.random() * n);
  const targetRepeat = SLOT_REPEATS - 2;
  const targetFlatIndex = targetRepeat * n + winnerIndex;
  const windowWidth = windowEl.clientWidth;
  const finalX = -(targetFlatIndex * SLOT_ITEM_WIDTH) + (windowWidth / 2 - SLOT_ITEM_WIDTH / 2);

  stripEl.style.transition = "none";
  stripEl.style.transform = "translateX(0px)";
  void stripEl.offsetWidth; // force reflow so the reset applies before animating
  stripEl.style.transition = "transform 3.6s cubic-bezier(0.1,0.7,0.15,1)";
  stripEl.style.transform = `translateX(${finalX}px)`;

  setTimeout(async () => {
    resultEl.textContent = `You got: ${game.segments[winnerIndex]}`;
    confirmBtn.classList.remove("hidden");
    try {
      await setDoc(SHOT_SPINS_DOC, { [currentUser.room]: Date.now() }, { merge: true });
    } catch (e) {
      console.error("Failed to record spin cooldown", e);
    }
  }, 3700);
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

const RANK_HEIGHT = { 1: 84, 2: 56, 3: 36 };
const RANK_LABEL = { 1: "1st", 2: "2nd", 3: "3rd" };

function tickerHtmlFromCounts(title, countsByRoom) {
  const items = Object.values(ROOMS)
    .map(
      (r) => `
      <div class="ticker-item">
        <div class="ticker-room" style="color:${r.color}">${r.label}</div>
        <div class="ticker-num" style="color:${r.color}">${countsByRoom[r.id] || 0}</div>
      </div>`
    )
    .join("");
  return `
    <div class="ticker-box">
      <div class="ticker-title">${title}</div>
      <div class="ticker-row">${items}</div>
    </div>`;
}

function podiumHtmlFromCounts(title, countsByRoom) {
  const raw = Object.values(ROOMS).map((r) => ({ room: r, n: countsByRoom[r.id] || 0 }));
  const maxN = Math.max(...raw.map((c) => c.n));

  const withRank = raw.map((c) => ({
    ...c,
    rank: 1 + raw.filter((o) => o.n > c.n).length,
  }));

  // Sort by count descending (stable tie-break by room id), then always
  // place the top count in the center — left/right stay 2nd/3rd by position
  // no matter how the tie values line up.
  const sorted = [...withRank].sort((a, b) => b.n - a.n || a.room.id - b.room.id);
  const order = [sorted[1], sorted[0], sorted[2]];

  const slots = order
    .map((item) => {
      const isLeader = item.rank === 1 && maxN > 0;
      const height = RANK_HEIGHT[item.rank] || 36;
      const barColor = isLeader ? item.room.color : "var(--surface-raised)";
      const barTextColor = isLeader ? "#0b0e14" : "var(--text-muted)";
      return `
        <div class="podium-slot">
          <div class="podium-room" style="color:${item.room.color}">${item.room.label}</div>
          <div class="podium-num">${item.n}</div>
          ${isLeader ? '<div class="podium-crown">👑</div>' : '<div class="podium-crown-spacer"></div>'}
          <div class="podium-bar" style="height:${height}px; background:${barColor}; color:${barTextColor};">${RANK_LABEL[item.rank] || ""}</div>
        </div>`;
    })
    .join("");

  return `
    <div class="podium-box">
      <div class="point-badge">1 Point</div>
      <div class="podium-title">${title}</div>
      <div class="podium-row">${slots}</div>
    </div>`;
}

function podiumHtml(gameId, subGameId, gameName) {
  const countsByRoom = {};
  Object.values(ROOMS).forEach((r) => {
    countsByRoom[r.id] = countFor(gameId, subGameId, r.id);
  });
  return podiumHtmlFromCounts(gameName, countsByRoom);
}

function totalDrinksByRoom() {
  const totals = { 1: 0, 2: 0, 3: 0 };
  scoringUnits().forEach((u) => {
    Object.values(ROOMS).forEach((r) => {
      totals[r.id] += countFor(u.gameId, u.subGameId, r.id);
    });
  });
  return totals;
}

function renderLeaderboard() {
  const boxes = document.getElementById("lb-boxes");
  boxes.innerHTML = "";

  // A real 10th point: whichever room has the most drinks logged across
  // everything combined wins this outright — shown first since it's the
  // "big picture" category.
  boxes.insertAdjacentHTML(
    "beforeend",
    podiumHtmlFromCounts("Most Drinks Overall", totalDrinksByRoom())
  );

  scoringUnits().forEach((u) => {
    boxes.insertAdjacentHTML("beforeend", podiumHtml(u.gameId, u.subGameId, u.name));
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
      ["games", "leaderboard", "rules", "info"].forEach((s) => {
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
