/* Pocket Aquarium Ecosystem v4 — DOM integration / bootstrap (FTG4-02).
   No imports, network, assets, or dependencies. Loads last; extends window.PA only
   for bootstrap. Binds the FTG4-01A shell (index.html / styles.css) to the FTG4-01B
   simulation (PA.createState/step/dispatch/sanitizeState/snapshotSummary/offlineCatchUp
   /validatePurchase) and the FTG4-01C Canvas renderer (PA.createRenderer).

   Ownership: this file (js/app.js) + README.md are the only files this lane authors.
   It does NOT edit data/sim/render/index.html/styles.css. Where the renderer's flexible
   field vocabulary does not line up with the sim's authoritative field names, the
   renderer is fed a small DERIVED, READ-ONLY view (see rendererState) — the authoritative
   state is never mutated for rendering. Everything visual the renderer needs that the sim
   exposes under a different name (water level fraction, egg/fry counts, biodiversity
   score) is provided at that boundary, so no cross-lane edit is required.

   Rendering cadence: the sim advances on requestAnimationFrame with a bounded real delta;
   the DOM re-renders at ~6 Hz (or immediately on an action), never per Canvas frame; the
   renderer animates the Canvas on its own internal loop. Autosave is throttled to <=1 write
   per 2 s (plus an immediate flush on pagehide). */
(function (global) {
  "use strict";

  var PA = global.PA;
  if (!PA || !PA.DATA) { return; } // sim not loaded — nothing to bind
  if (!PA.sessionGuide && typeof require === "function") {
    try { require("./sessionGuide.js"); } catch (e) { return; }
  }
  if (!PA.sessionGuide) { return; }

  var DATA = PA.DATA;
  var ACT = PA.ACTIONS;
  var STAGES = DATA.CYCLE_STAGES;
  var GUIDE = PA.sessionGuide;

  /* ============================ first-delight fast-forward ============================ */
  // The one-time cold-start cycle compression: advance exactly eight game-days through the SAME
  // public simulation path normal play uses (PA.stepDays), one game-day per call. Internal, and
  // invoked ONLY from the live INOCULATE_BACTERIA completion path (doInoculate) — never on boot,
  // reload, resume, render, or save hydration, because no state predicate ever triggers it. The
  // live route (handleAct → doInoculate) is exercised by tests through the shared PA._app surface.
  function fastForwardAfterInoculation(state, days, afterDay) {
    for (var d = 0; d < days; d++) {
      PA.stepDays(state, 1);
      afterDay();
    }
    return state;
  }

  /* ============================ tiny helpers ============================ */
  // DOM-safe lookup: returns null with no document (headless test load — see PA._app),
  // so requiring this module under Node to exercise the shared action helpers never throws.
  function $(id) { return (typeof document !== "undefined") ? document.getElementById(id) : null; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isReef() { return state.habitat === "reef"; }
  function tierVol() { var t = DATA.TIERS[state.tier]; return t ? t.volumeL : 75; }
  function fmtVal(v) {
    v = +v || 0; var a = Math.abs(v);
    if (a === 0) return "0";
    if (a < 1) return v.toFixed(2);
    if (a < 10) return v.toFixed(1);
    return String(Math.round(v));
  }
  function fmtAge(d) {
    d = +d || 0;
    if (d < 0.05) return "just now";
    if (d < 1) return Math.round(d * 24) + "h ago";
    return d.toFixed(1) + "d ago";
  }
  function pct01(v) { return Math.round(clamp01(+v || 0) * 100) + "%"; }

  /* ============================ DOM references ============================ */
  var appEl = $("app");
  var habitatLabel = $("habitatLabel"), dayLabel = $("dayLabel"), welfareLabel = $("welfareLabel");
  var creditCount = $("creditCount"), xpCount = $("xpCount");
  var pauseBtn = $("pauseBtn"), speed1Btn = $("speed1Btn"), speed4Btn = $("speed4Btn"), speed8Btn = $("speed8Btn");
  var tankCanvas = $("tankCanvas"), inspector = $("inspector"), canvasSummary = $("canvasSummary");
  var commandSurface = $("commandSurface");
  var nextActionEl = $("nextAction"), phaseTimeline = $("phaseTimeline");
  var waterList = $("waterList"), waterAdvancedList = $("waterAdvancedList");
  var livestockList = $("livestockList"), storeList = $("storeList"), journalList = $("journalList");
  var habitatDialog = $("habitatDialog"), modalRoot = $("modalRoot"), toastEl = $("toast");
  var guidePanel = $("guidePanel"), waterPanel = $("waterPanel"), livestockPanel = $("livestockPanel"),
      storePanel = $("storePanel"), journalPanel = $("journalPanel");

  var TABS = [
    { tab: $("guideTab"), panel: guidePanel, name: "guide" },
    { tab: $("waterTab"), panel: waterPanel, name: "water" },
    { tab: $("livestockTab"), panel: livestockPanel, name: "livestock" },
    { tab: $("storeTab"), panel: storePanel, name: "store" },
    { tab: $("journalTab"), panel: journalPanel, name: "journal" }
  ];
  var STORE_TAB = 3;

  // Injected persistent containers (built once so per-frame list re-renders never wipe them).
  var waterControls = null, journalFooter = null;

  /* ============================ module state ============================ */
  var state = null;
  var renderer = null;
  var lastSnap = null;
  var activeTab = 0;
  var rafId = 0, lastTs = null, lastDomAt = 0, needsRender = false;
  var pendingSave = false, lastSaveAt = 0;
  var logCursor = 0, lastToastMsg = "", toastTimer = 0;
  var visibilityPaused = false;
  var pendingFirstFeed = false; // runtime-only first-feed guide prompt; never persisted or loaded
  var pendingCycleBoostDays = 0; // runtime-only retry remainder; reloads never replay synthetic days
  var DOM_INTERVAL = 170; // ~6 Hz DOM cadence (not per Canvas frame)

  /* ============================ persistence ============================ */
  function load() {
    var raw = null;
    try { raw = global.localStorage.getItem(DATA.saveKey); } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function save() {
    try {
      state.lastRealTimestamp = Date.now(); // accurate wall-clock for the next offline catch-up
      global.localStorage.setItem(DATA.saveKey, JSON.stringify(state)); // never touches DATA.arcadeKey
      lastSaveAt = Date.now(); pendingSave = false;
    } catch (e) { /* storage unavailable (private mode / quota) — degrade quietly */ }
  }
  function markDirty() { pendingSave = true; }

  /* ============================ toast ============================ */
  function toast(msg, kind) {
    if (!toastEl || !msg) return;
    toastEl.textContent = msg;
    toastEl.setAttribute("data-kind", kind || "info");
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }
  var NOTABLE = { death: 1, warn: 1, offline: 1, breeding: 1, store: 1, quarantine: 1, milestone: 1, water: 1, care: 1, setup: 1 };
  function surfaceToasts() {
    var log = state.log;
    if (logCursor > log.length) logCursor = log.length; // start-over reset guard
    var pick = null;
    for (var i = logCursor; i < log.length; i++) if (NOTABLE[log[i].type]) pick = log[i];
    logCursor = log.length;
    if (pick && pick.message !== lastToastMsg) { toast(pick.message, pick.type); lastToastMsg = pick.message; }
  }

  /* ============================ dispatch ============================ */
  // Single mutation entry point — used by the renderer (pointer feed/select), the
  // transport buttons, the keyboard, and every rendered action button.
  function dispatchAction(action) {
    if (!action || !action.type) return;
    var t = action.type;
    var aliveFishBefore = (t === "FEED" || t === "FEED_AT") ? aliveEaters() : 0;
    PA.dispatch(state, action);
    if (t === "FEED" || t === "FEED_AT") {
      if (aliveFishBefore === 0) toast("Nothing alive to eat it — uneaten food just decays into waste and raises ammonia.", "warn");
      else if (state._feedWarning) toast("Careful: ammonia/nitrite is elevated. Extra food will worsen the water.", "warn");
      state._feedWarning = false;
      pendingFirstFeed = false; // the first-feed beat is satisfied once a feed actually executes
    }
    markDirty();
    renderNow();
  }
  function aliveEaters() {
    var n = 0, ls = state.livestock || [];
    for (var i = 0; i < ls.length; i++) {
      var a = ls[i]; if (!a || a.alive === false) continue;
      var sp = DATA.SPECIES[a.species]; if (sp && sp.kind !== "invert") n++;
    }
    return n;
  }
  function aliveOf(species) {
    var n = 0, ls = state.livestock || [];
    for (var i = 0; i < ls.length; i++) if (ls[i] && ls[i].alive !== false && ls[i].species === species) n++;
    return n;
  }
  function aliveAdults(species) {
    var out = [], ls = state.livestock || [];
    for (var i = 0; i < ls.length; i++) { var a = ls[i]; if (a && a.alive !== false && a.species === species && a.stage === "adult") out.push(a); }
    return out;
  }
  // Toxic-waste care reads the SAME rounded snapshot value and severity the visible
  // ammonia/nitrite meters use, so care can never call an amber "elevated" reading "toxic".
  // "danger" severity is exactly the PARAMS.*.toxic contract (rounded value past warn[1] == toxic);
  // "warn" is elevated-but-not-yet-toxic. Both read snap.water, never raw unrounded chemistry.
  function waterToxic(snap) {
    var k = waterByKey(snap || currentSnap());
    return (!!k.ammonia && k.ammonia.severity === "danger") || (!!k.nitrite && k.nitrite.severity === "danger");
  }
  /* ============================ renderer view boundary ============================ */
  // Derived, read-only projection of authoritative state into the renderer's field
  // vocabulary. The renderer reads a water-level FRACTION (state stores litres against a
  // per-tier volume it cannot see), egg/fry COUNTS (state stores staged `clutches`), and a
  // microfauna score (state stores a `biodiversity` field). Providing these here keeps the
  // Canvas honest about evaporation, spawning and biodiversity WITHOUT editing js/render.js
  // and WITHOUT mutating the persisted/authoritative state.
  function rendererState() {
    if (!state || !state.habitat) return state;
    var vol = tierVol();
    var frac = vol > 0 ? clamp01(state.water.levelL / vol) : 1;
    var eggs = 0, fry = 0, cl = state.clutches || [];
    for (var i = 0; i < cl.length; i++) {
      if (cl[i].stage === "eggs") eggs += cl[i].count;
      else fry += cl[i].count; // hatched larvae + fry both render as tiny fry particles
    }
    var micro = {};
    for (var k in state.microfauna) if (state.microfauna.hasOwnProperty(k)) micro[k] = state.microfauna[k];
    micro.score = state.microfauna.biodiversity;
    var view = {};
    for (var p in state) if (state.hasOwnProperty(p)) view[p] = state[p];
    var w = {};
    for (var wk in state.water) if (state.water.hasOwnProperty(wk)) w[wk] = state.water[wk];
    w.level = frac;
    view.water = w; view.microfauna = micro; view.eggs = eggs; view.fry = fry;
    return view;
  }

  /* ============================ habitat flow ============================ */
  function openHabitatDialog() {
    if (!habitatDialog) return;
    if (habitatDialog.open) return;
    if (typeof habitatDialog.showModal === "function") { try { habitatDialog.showModal(); return; } catch (e) {} }
    habitatDialog.setAttribute("open", ""); // legacy fallback
  }
  function chooseHabitat(value) {
    dispatchAction({ type: ACT.CHOOSE_HABITAT, habitat: value }); // sim normalizes freshwater->amazon
    applyTheme();
    save();
  }
  function applyTheme() {
    if (!appEl) return;
    appEl.classList.toggle("is-fresh", state.habitat === "amazon");
    appEl.classList.toggle("is-reef", state.habitat === "reef");
    // Theme --accent at the token layer (per styles.css render contract) without editing CSS.
    var accent = state.habitat === "reef" ? "var(--reef)" : state.habitat === "amazon" ? "var(--fresh)" : "var(--blue)";
    appEl.style.setProperty("--accent", accent);
  }

  /* ============================ tabs (roving tabindex) ============================ */
  function selectTab(i, focus) {
    i = (i % TABS.length + TABS.length) % TABS.length;
    activeTab = i;
    for (var k = 0; k < TABS.length; k++) {
      var on = k === i;
      TABS[k].tab.setAttribute("aria-selected", on ? "true" : "false");
      TABS[k].tab.tabIndex = on ? 0 : -1;
      TABS[k].panel.hidden = !on;
    }
    if (focus) TABS[i].tab.focus();
    renderActivePanel(currentSnap());
  }

  /* ============================ delegated actions ============================ */
  function handleAct(el) {
    var ds = el.dataset, act = ds.act;
    switch (act) {
      case "setup-fill": dispatchAction({ type: ACT.SETUP_FILL }); break;
      case "life-on": dispatchAction({ type: ACT.SETUP_LIFE_SUPPORT, on: true }); break;
      case "life-off": dispatchAction({ type: ACT.SETUP_LIFE_SUPPORT, on: false }); break;
      case "ammonia-on": dispatchAction({ type: ACT.ADD_AMMONIA_SOURCE, on: true }); break;
      case "ammonia-off": dispatchAction({ type: ACT.ADD_AMMONIA_SOURCE, on: false }); break;
      case "inoculate": doInoculate(); break;
      case "test": dispatchAction({ type: ACT.WATER_TEST }); toast("Water tested — readings and freshness updated.", "water"); break;
      case "wc25": dispatchAction({ type: ACT.WATER_CHANGE, fraction: 0.25 }); break;
      case "speed4": dispatchAction({ type: ACT.SET_SPEED, speed: 4 }); break;
      case "topoff": dispatchAction({ type: ACT.WATER_TOP_OFF }); break;
      case "buy-equip": dispatchAction({ type: ACT.PURCHASE_EQUIPMENT, category: ds.category, levelId: ds.level }); break;
      case "buy-tier": dispatchAction({ type: ACT.PURCHASE_TIER, tier: ds.tier }); break;
      case "buy-live": doBuyLivestock(ds.species, +ds.count || undefined); break;
      case "buy-coral": dispatchAction({ type: ACT.PURCHASE_CORAL, coral: ds.coral }); break;
      case "seed": dispatchAction({ type: ACT.SEED_MICROFAUNA, culture: ds.culture }); break;
      case "feed": feedCenter(); break;
      case "select": dispatchAction({ type: ACT.SELECT_ENTITY, entityType: ds.etype, id: ds.id }); break;
      case "insp-close": dispatchAction({ type: ACT.SELECT_ENTITY, id: null }); break;
      case "removedead": dispatchAction({ type: ACT.REMOVE_DEAD, id: +ds.id }); break;
      case "open-store": selectTab(STORE_TAB, false); break;
      case "open-water": selectTab(1, false); break;
      case "open-livestock": selectTab(2, false); break;
      case "open-dialog": openHabitatDialog(); break;
      case "startover": confirmStartOver(); break;
      case "modal-cancel": { var d1 = el.closest("dialog"); if (d1) d1.close(); break; }
      case "modal-startover": { var d2 = el.closest("dialog"); if (d2) d2.close(); doStartOver(); break; }
      default: break;
    }
  }
  // The shared feed helper: it dispatches the exact FEED_AT action the renderer's pointer-feed
  // uses (not FEED), so the guided feed beat and a tap on the water are one authoritative path.
  function feedCenter() { dispatchAction({ type: "FEED_AT", x: 0.5, y: 0.4 }); }
  // Live inoculation: dispatch the existing action, then — only when THIS click just completed
  // it (inoculated false -> true) — run the one-time eight-day cycle fast-forward through the
  // real public sim path. Boot/reload never reach here, so the boost can never replay.
  function doInoculate() {
    var wasInoculated = state.cycle.inoculated;
    if (!wasInoculated) dispatchAction({ type: ACT.INOCULATE_BACTERIA });
    if (!wasInoculated && state.cycle.inoculated) {
      pendingCycleBoostDays = GUIDE.inoculationAdvanceDays;
    }
    if (!state.cycle.inoculated || pendingCycleBoostDays <= 0) return;
    var boostStartDay = state.time.days, boostDays = pendingCycleBoostDays;
    try {
      fastForwardAfterInoculation(state, pendingCycleBoostDays, function () { pendingCycleBoostDays--; });
    } catch (e) {
      pendingCycleBoostDays = Math.max(0, boostDays - Math.floor(state.time.days - boostStartDay + 1e-9));
      markDirty(); renderNow();
      if (pendingCycleBoostDays) toast("Cycle boost paused — retry inoculating bacteria to continue.", "warn");
      return;
    }
    markDirty(); renderNow();
  }
  // Live validated purchase through the existing validator/action. When THIS purchase takes the
  // tank from zero living eaters to one or more, open the runtime-only first-feed prompt so the
  // guide's next beat is to feed. Any executed feed clears it (dispatchAction). Never persisted.
  function doBuyLivestock(species, count) {
    var eatersBefore = aliveEaters();
    dispatchAction({ type: ACT.PURCHASE_LIVESTOCK, species: species, count: count });
    if (eatersBefore === 0 && aliveEaters() > 0) {
      pendingFirstFeed = true;
      renderNow(); // dispatchAction painted the pre-purchase advice; repaint the first-feed beat.
    }
  }
  // Shared live-action surface. handleAct calls these exact helpers in the browser; tests drive
  // the same functions headlessly, so there is no parallel path. recommendedAction is read-only
  // (what careAdvice would surface). Nothing here is persisted or added to the save schema.
  PA._app = {
    setState: function (s) { state = s; pendingFirstFeed = false; pendingCycleBoostDays = 0; },
    isPendingFirstFeed: function () { return pendingFirstFeed; },
    inoculate: doInoculate,
    buyLivestock: doBuyLivestock,
    feed: feedCenter,
    startOver: doStartOver,
    recommendedAction: function () { return careAdvice(PA.snapshotSummary(state)).action.act; }
  };

  /* ============================ start over (accessible confirm) ============================ */
  function confirmStartOver() {
    var d = document.createElement("dialog");
    d.className = "app-modal";
    d.setAttribute("aria-labelledby", "soTitle");
    d.style.cssText = "max-width:440px;width:calc(100vw - 28px);padding:20px;border:var(--line);border-radius:var(--r-md);background:var(--chrome);color:var(--ink);box-shadow:var(--pop)";
    d.innerHTML =
      '<h2 id="soTitle" style="margin:0 0 8px;font-size:20px;font-weight:800">Start over?</h2>' +
      '<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:var(--ink-soft)">This clears your <b>ecosystem</b> progress — habitat, cycle, water, livestock, corals, journal and credits — and begins a fresh tank. Your preserved <b>arcade</b> progress is never touched.</p>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">' +
      '<button class="tbtn" type="button" data-act="modal-cancel" data-fk="so-cancel" style="border:var(--line);background:var(--paper)">Cancel</button>' +
      '<button class="offer-cta" type="button" data-act="modal-startover" data-fk="so-ok" style="background:var(--bad)">Clear &amp; start over</button>' +
      '</div>';
    modalRoot.appendChild(d);
    d.addEventListener("close", function () { if (d.parentNode) d.parentNode.removeChild(d); });
    if (typeof d.showModal === "function") { try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } }
    else d.setAttribute("open", "");
    var c = d.querySelector('[data-act="modal-cancel"]'); if (c) c.focus();
  }
  function doStartOver() {
    try { global.localStorage.removeItem(DATA.saveKey); } catch (e) {} // arcadeKey untouched
    state = PA.createState({ now: Date.now() });
    logCursor = state.log.length; lastToastMsg = ""; pendingFirstFeed = false; pendingCycleBoostDays = 0;
    applyTheme(); save(); renderNow();
    openHabitatDialog();
    toast("Started a fresh ecosystem. Choose a habitat to begin.", "care");
  }

  /* ============================ render: pipeline ============================ */
  function currentSnap() { if (!lastSnap) lastSnap = PA.snapshotSummary(state); return lastSnap; }
  function renderNow() {
    lastDomAt = nowMs();
    renderDynamic();
  }
  function nowMs() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
  function renderDynamic() {
    if (typeof document === "undefined") return; // headless (test) load has no DOM to paint
    var snap = PA.snapshotSummary(state);
    lastSnap = snap;
    renderChrome(snap);
    renderTransport(snap);
    renderCommand(snap);
    renderCanvasSummary(snap);
    renderInspector();
    renderActivePanel(snap);
    surfaceToasts();
  }

  function renderChrome(snap) {
    habitatLabel.textContent = snap.habitat ? (snap.habitat === "reef" ? "Reef" : "Amazon") : "Not set";
    if (snap.habitat) {
      var timePart = (snap.timeLabel || "").split(" ").pop();
      dayLabel.textContent = (snap.day + 1) + (timePart ? " · " + timePart : "");
    } else dayLabel.textContent = "—";
    welfareLabel.textContent = snap.welfare;
    creditCount.textContent = snap.credits;
    xpCount.textContent = snap.xp;
  }
  function setPressed(btn, on) { if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false"); }
  function renderTransport(snap) {
    var sp = snap.speed;
    setPressed(pauseBtn, sp === 0);
    setPressed(speed1Btn, sp === 1);
    setPressed(speed4Btn, sp === 4);
    setPressed(speed8Btn, sp === 8);
  }

  function renderCanvasSummary(snap) { canvasSummary.textContent = summaryText(snap); }
  function summaryText(snap) {
    if (!snap.habitat) return "No habitat yet — choose a freshwater Amazon or an Indo-Pacific reef to begin.";
    var parts = [snap.habitatName + "."];
    parts.push("Cycle: " + snap.cycle.stage + (snap.cycle.cycled ? " — safe to stock" : "") + ".");
    var su = snap.succession, vis = [];
    if (su.haze > 0.25) vis.push("bacterial haze");
    if (su.diatom > 0.25) vis.push("brown diatoms");
    if (su.greenFilm > 0.25) vis.push("green film");
    if (su.cyano > 0.25) vis.push("cyanobacteria");
    if (vis.length) parts.push("Visible: " + vis.join(", ") + ".");
    var alive = 0, dead = 0;
    for (var i = 0; i < snap.livestock.length; i++) snap.livestock[i].alive ? alive++ : dead++;
    var life = alive + " living animal" + (alive === 1 ? "" : "s");
    if (snap.corals.length) life += ", " + snap.corals.length + " coral" + (snap.corals.length === 1 ? "" : "s");
    if (dead) life += ", " + dead + " to remove";
    parts.push(life + ".");
    if (snap.clutches && snap.clutches.length) parts.push("Breeding: " + snap.clutches.map(function (c) { return c.count + " " + c.stage; }).join(", ") + ".");
    if (snap.alerts.length) parts.push("Alerts: " + snap.alerts.slice(0, 3).join(", ") + ".");
    // No forward-looking action clause here — the command surface is the single owner of the
    // care action, so this scene description stays purely factual and never competes with it.
    return parts.join(" ");
  }

  /* ============================ command surface ============================ */
  // One always-visible readout: STABLE / WATCH / CRITICAL, a plain-language reason,
  // data freshness, and ONE recommended action with why it helps. Everything is derived
  // from the current authoritative state (via the snapshot) — never from stale guesses.
  var lastCommandHTML = "", lastCommandCls = "";
  function renderCommand(snap) {
    if (!commandSurface) return;
    var m = careAdvice(snap);
    var html = commandHTML(m), cls = "command js-root is-" + m.level;
    // Only touch the DOM (an aria-live region) when guidance actually changes, so the
    // ~6 Hz re-render never re-announces the same status or steals focus.
    if (html === lastCommandHTML && cls === lastCommandCls) return;
    lastCommandHTML = html; lastCommandCls = cls;
    renderInto(commandSurface, function () {
      commandSurface.className = cls;
      commandSurface.innerHTML = html;
    });
  }
  function commandHTML(m) {
    var showFresh = state.habitat && state.cycle && state.cycle.filled && m.freshness;
    var fresh = showFresh
      ? '<p class="command-fresh"><span aria-hidden="true">◷</span> ' + esc(m.freshness) + "</p>" : "";
    var cta = actBtn("command-cta", m.action.label, m.action.act, m.action.ds, ' data-fk="cmd-action"');
    return '<span class="command-badge">' + esc(m.word) + "</span>" +
      '<div class="command-main">' +
        '<p class="command-reason">' + esc(m.reason) + "</p>" +
        '<p class="command-why">' + esc(m.why) + "</p>" + fresh +
      "</div>" + cta;
  }

  // Adapt the shared, pure GuideView to the legacy command-bar vocabulary. The Water
  // panel reuses this adapter, so both legacy surfaces still show one recommendation.
  function careAdvice(snap) {
    var view = GUIDE.project(state, { snapshot: snap, firstFeedPending: pendingFirstFeed,
      cycleBoostDays: pendingCycleBoostDays });
    var action = view.nextAction || {};
    return { level: action.tone || "stable", word: action.badge || "STABLE",
      reason: view.title, why: view.body,
      action: { label: action.label || "Open the store", act: action.type || "open-store", ds: null },
      freshness: action.freshness || "Never tested", stale: action.stale !== false };
  }
  function waterByKey(snap) { var m = {}, w = snap.water || []; for (var i = 0; i < w.length; i++) m[w[i].key] = w[i]; return m; }
  // Photoperiod phase read straight from the sim clock (same window explainCoral uses); no
  // persisted light setting is invented — daytime is a function of state.time.days only.
  function photoperiodDay() { var frac = state.time.days - Math.floor(state.time.days); return frac > 0.28 && frac < 0.86; }
  function coralParStatus(cd, par, day) {
    if (par > cd.par.high) return "too strong now";
    if (day && par < cd.par.low) return "too dim now";
    if (!day) return "dark (night)";
    return "in range";
  }

  /* ---------- focus/scroll-stable panel re-render ---------- */
  function renderInto(panel, fn) {
    var sc = panel.scrollTop;
    var ae = document.activeElement;
    var fk = (ae && ae.getAttribute && panel.contains(ae)) ? ae.getAttribute("data-fk") : null;
    fn();
    panel.scrollTop = sc;
    if (fk) {
      var el = panel.querySelector('[data-fk="' + fk.replace(/"/g, "") + '"]');
      if (el) { try { el.focus(); } catch (e) {} }
    }
  }
  function renderActivePanel(snap) {
    switch (activeTab) {
      case 0: renderInto(guidePanel, function () { renderGuide(snap); }); break;
      case 1: renderInto(waterPanel, function () { renderWater(snap); }); break;
      case 2: renderInto(livestockPanel, function () { renderLivestock(snap); }); break;
      case 3: renderInto(storePanel, function () { renderStore(snap); }); break;
      case 4: renderInto(journalPanel, function () { renderJournal(); }); break;
      default: break;
    }
  }

  /* ============================ render: buttons ============================ */
  function actBtn(cls, label, act, ds, extra) {
    var attrs = "";
    if (ds) for (var k in ds) if (ds.hasOwnProperty(k) && ds[k] != null) attrs += ' data-' + k + '="' + esc(ds[k]) + '"';
    return '<button class="' + cls + '" type="button" data-act="' + esc(act) + '"' + attrs + (extra || "") + ">" + esc(label) + "</button>";
  }
  function careBtn(label, act, ds, enabled, reason, fk) {
    var extra = ' style="min-height:44px" data-fk="' + fk + '"';
    if (!enabled) extra += ' disabled title="' + esc(reason || "Not available yet.") + '" aria-label="' + esc(label + " — " + (reason || "unavailable")) + '"';
    return actBtn("offer-cta", label, act, ds, extra);
  }

  /* ============================ render: Guide ============================ */
  var STAGE_NOTES = {
    "Setup": "Fill the tank, start life support, then add an ammonia source.",
    "Ammonia oxidation": "Ammonia climbing; ammonia-oxidising bacteria are establishing.",
    "Nitrite oxidation": "Nitrite rising as ammonia is converted.",
    "Nitrate present": "Nitrate appearing — the biofilter is nearly there.",
    "Cycled": "Ammonia & nitrite safe with nitrate present — safe to stock.",
    "Young biome": "Diatoms and films bloom while the biology settles in.",
    "Mature biome": "A stable, biodiverse, well-aged system."
  };
  function renderGuide(snap) {
    // Orientation only — never a second "next action". The command surface is the sole owner
    // of the recommended action; #nextAction just names the current cycle/maturity stage and
    // explains what it means, reusing the same STAGE_NOTES the phase timeline teaches below.
    if (!snap.habitat) { nextActionEl.innerHTML = ""; }
    else {
      var stage = STAGES[snap.cycle.index] || snap.cycle.stage || STAGES[0];
      nextActionEl.innerHTML =
        '<div class="next-card"><span class="next-eyebrow">Current stage</span>' +
        '<h3 class="next-title">' + esc(stage) + "</h3>" +
        '<p class="next-body">' + esc(STAGE_NOTES[stage] || "") + "</p></div>";
    }
    // phase timeline via stage index / isCycled (never literal-stage equality)
    phaseTimeline.innerHTML = phaseTimelineHTML(snap);
  }
  function phaseTimelineHTML(snap) {
    var cur = snap.cycle.index; // STAGES.indexOf(current stage)
    var cycled = DATA.isCycled(state);
    var out = [];
    for (var i = 0; i < STAGES.length; i++) {
      var cls = i < cur ? "is-done" : (i === cur ? "is-active" : "is-todo");
      // the stocking gate can jump past the literal "Cycled" label; if the gate is open,
      // never show Cycled (or earlier) as a pending/todo step.
      if (cycled && i <= STAGES.indexOf("Cycled") && cls === "is-todo") cls = "is-done";
      out.push('<li class="phase-step ' + cls + '"><span class="phase-dot"></span>' +
        '<span class="phase-name">' + esc(STAGES[i]) + "</span>" +
        '<span class="phase-note">' + esc(STAGE_NOTES[STAGES[i]] || "") + "</span></li>");
    }
    return out.join("");
  }

  /* ============================ render: Water ============================ */
  // Readings grouped by the ROLE each plays, so Test / Water change / Top-off map to a
  // clear cause. "Advanced" holds the deeper accumulation/chemistry behind a disclosure.
  var WATER_GROUPS = [
    { title: "Toxic waste", note: "Directly poisonous — must read safe before and after stocking.", keys: ["ammonia", "nitrite"] },
    { title: "Environment", note: "The livable envelope: temperature, pH, salinity and volume.", keys: ["tempC", "pH", "salinity", "level"] },
    { title: "Accumulation", note: "Builds up between water changes; dilute it, don't top it off.", keys: ["nitrate"] }
  ];
  var WATER_ADVANCED_KEYS = ["oxygen", "hardness", "tannin", "alkalinity", "calcium", "magnesium", "phosphate", "par", "flow"];

  function renderWater(snap) {
    waterControls.innerHTML = waterToolsHTML(snap);
    var byKey = waterByKey(snap), used = {}, main = [];
    for (var g = 0; g < WATER_GROUPS.length; g++) {
      var grp = WATER_GROUPS[g], rows = [];
      for (var i = 0; i < grp.keys.length; i++) {
        var m = byKey[grp.keys[i]];
        if (m) { rows.push(meterHTML(m)); used[grp.keys[i]] = 1; }
      }
      if (rows.length) main.push(waterGroupHead(grp.title, grp.note) + rows.join(""));
    }
    // Reef light: PAR + photoperiod grouped where it actually drives the coral care decision.
    if (isReef() && byKey.par) main.push(lightGroupHTML(byKey.par, used));
    var adv = [];
    for (var a = 0; a < WATER_ADVANCED_KEYS.length; a++) {
      var ak = WATER_ADVANCED_KEYS[a], am = byKey[ak];
      if (am && !used[ak]) { adv.push(meterHTML(am)); used[ak] = 1; }
    }
    // Any future/unclassified parameter still shows up rather than silently vanishing.
    var w = snap.water || [];
    for (var k = 0; k < w.length; k++) if (!used[w[k].key]) adv.push(meterHTML(w[k]));
    waterList.innerHTML = main.join("");
    waterAdvancedList.innerHTML = adv.join("");
  }
  function waterGroupHead(title, note) {
    return '<li class="meter-group"><span class="meter-group-title">' + esc(title) + "</span>" +
      '<span class="meter-group-note">' + esc(note) + "</span></li>";
  }
  // Light & photoperiod (reef): the PAR meter plus the current phase, the fixture, each coral's
  // usable-light target, and a plain explanation of what PAR means. All read from existing state
  // (state.time.days, state.water.par, state.equipment.light, DATA.CORALS) — no new settings.
  function lightGroupHTML(parM, used) {
    used.par = 1;
    var day = photoperiodDay(), par = state.water.par;
    var lvl = DATA.equipLevel("light", state.equipment.light) || {};
    var fixture = lvl.name || "Light fixture";
    var control = lvl.photoperiodControl ? "timed photoperiod" : "manual on/off";
    var lines = '<span class="light-phase"><b>' + esc(day ? "Daylight period" : "Night period") + "</b> · " +
      esc(fixture) + " (" + esc(control) + ")</span>";
    var corals = state.corals || [], seen = {}, shown = 0;
    for (var i = 0; i < corals.length; i++) {
      var cd = DATA.CORALS[corals[i].species];
      if (!cd || !cd.par || seen[corals[i].species]) continue;
      seen[corals[i].species] = 1; shown++;
      lines += '<span class="light-target">' + esc(cd.name) + " wants PAR " + fmtVal(cd.par.low) + "–" + fmtVal(cd.par.high) +
        " µmol — <b>" + esc(coralParStatus(cd, par, day)) + "</b></span>";
    }
    if (!shown) lines += '<span class="light-target">No coral yet — PAR becomes a care target once you add coral.</span>';
    lines += '<span class="light-explain">PAR is the usable light that actually reaches the coral at its spot on the reef — not the bulb’s wattage.</span>';
    return waterGroupHead("Light & photoperiod", "Usable light for coral across the day/night cycle.") +
      meterHTML(parM) + '<li class="light-note">' + lines + "</li>";
  }
  // Test / Water change / Top-off, each with what it does and whether it is recommended by
  // the current state. Recommendations are honest: water change dilutes waste/nitrate;
  // top-off only restores evaporated volume/salinity and never removes nitrate.
  function waterToolsHTML(snap) {
    var filled = state.cycle.filled, full = tierVol();
    var topEnabled = filled && state.water.levelL < full - 1e-6;
    // The single care ladder decides the ONE recommended operation; each tool is emphasised
    // only when its own action equals that action (recAct). Computing recommendation per tool
    // independently badged Test + water change + top-off together during a fishless cycle.
    // All tools stay available and explanatory — only the matching one carries the badge.
    var m = careAdvice(snap);
    var recAct = m.action.act;
    var tools = [
      waterTool("Test the water", "test", filled, filled ? null : "Fill the tank first.", recAct,
        "Reveals the current chemistry so every reading is known and fresh.", "wtool:test"),
      waterTool("25% water change", "wc25", filled, filled ? null : "Fill the tank first.", recAct,
        "Dilutes toxic ammonia and nitrite and draws down accumulated nitrate.", "wtool:wc"),
      waterTool("Freshwater top-off", "topoff", topEnabled, !filled ? "Fill the tank first." : (topEnabled ? null : "Water level is already full."), recAct,
        isReef() ? "Replaces evaporated water to restore volume and lower salinity — it does not remove nitrate."
                 : "Replaces evaporated water to restore volume — it does not remove nitrate.", "wtool:top")
    ];
    var ato = "";
    if (isReef()) {
      var auto = state.equipment.ato === "ato";
      ato = '<p class="wtool-ato">ATO: <b>' + (auto ? "Automatic" : "Manual") + "</b> — " +
        (auto ? "holding volume &amp; salinity steady across evaporation." : "top off to pull salinity back toward 35 ppt (buy an ATO to automate).") + "</p>";
    }
    // Compact current verdict leads the panel, reusing the same care action so the Water
    // tab and the command surface can never disagree; the tools below stay quieter.
    var verdict = '<div class="water-verdict is-' + m.level + '">' +
      '<span class="wv-word">' + esc(m.word) + "</span>" +
      '<span class="wv-reason">' + esc(m.reason) + "</span></div>";
    return verdict + '<ul class="water-tools">' + tools.join("") + "</ul>" + ato;
  }
  // A tool is "recommended" only when it is enabled AND its own action is the single action
  // careAdvice chose (recAct). Since the three tool actions are distinct, at most one badges.
  function waterTool(label, act, enabled, reason, recAct, caption, fk) {
    var isRec = enabled && act === recAct;
    var rec = isRec ? '<span class="wtool-rec">Recommended now</span>' : "";
    return '<li class="wtool' + (isRec ? " is-rec" : "") + '">' +
      '<div class="wtool-head">' + careBtn(label, act, null, enabled, reason, fk) + rec + "</div>" +
      '<p class="wtool-note">' + esc(caption) + "</p></li>";
  }
  // Compact meter value that can never visually contradict its OWN displayed target band.
  // fmtVal rounds coarsely, so a value just outside the band (e.g. 23.6°C against a 24–28 band)
  // would otherwise render as "24" and read as in-range — contradicting the command surface's
  // "outside the safe band". When, and only when, compact rounding would land an out-of-band
  // value inside the shown band, boundary-qualify it (<low / >high) at the band's own precision.
  // Ordinary in-band values render exactly as before; severity/colour stay authoritative (m.severity).
  function meterValueLabel(m) {
    var raw = fmtVal(m.value);
    if (m.good) {
      var lo = m.good[0], hi = m.good[1];
      if (m.value < lo && parseFloat(raw) >= parseFloat(fmtVal(lo))) return "<" + fmtVal(lo);
      if (m.value > hi && parseFloat(raw) <= parseFloat(fmtVal(hi))) return ">" + fmtVal(hi);
    }
    return raw;
  }
  function meterHTML(m) {
    var known = m.known;
    var sev = known ? "sev-" + (m.severity === "danger" ? "bad" : m.severity) : "is-unknown";
    var unit = m.unit ? " " + m.unit : "";
    var val = known ? (meterValueLabel(m) + unit) : "—";
    var band = m.good ? (fmtVal(m.good[0]) + "–" + fmtVal(m.good[1]) + unit) : "";
    var pctv = known ? meterPct(m) : 0;
    var trend = known ? trendArrow(m.trend) : "▬";
    var foot = (known ? "tested " + fmtAge(m.testAgeDays) : "untested") + (band ? " · target " + band : "");
    var teach = known ? "" : '<span class="meter-teach">A water test reveals this reading.</span>';
    return '<li class="meter ' + sev + '">' +
      '<span class="meter-head"><span class="meter-name">' + esc(m.label) + "</span>" +
      '<span class="meter-val">' + esc(val) + "</span></span>" +
      '<span class="meter-track"><span class="meter-fill" style="--pct:' + pctv + '%"></span></span>' +
      '<span class="meter-foot"><span class="meter-trend" title="change since last test">' + trend + "</span>" +
      '<span class="meter-age">' + esc(foot) + "</span></span>" + teach + "</li>";
  }
  function meterPct(m) {
    if (m.key === "level") return clamp(Math.round(m.value), 0, 100);
    var w = m.warn || m.good; if (!w) return 50;
    var lo = w[0], hi = w[1]; if (hi <= lo) return 50;
    return clamp(Math.round((m.value - lo) / (hi - lo) * 100), 0, 100);
  }
  function trendArrow(t) { return t > 0 ? "▲" : (t < 0 ? "▼" : "▬"); }

  /* ============================ render: Livestock ============================ */
  var SPECIES_STYLE = {
    neon_tetra: { c: "#2fb6d6", m: "NT" }, pygmy_cory: { c: "#b7a986", m: "PC" },
    ocellaris: { c: "#f57920", m: "OC" }, watchman_goby: { c: "#f0b81f", m: "WG" },
    pistol_shrimp: { c: "#d94f3d", m: "PS" }, epaulette_shark: { c: "#b89a68", m: "ES" }
  };
  var CORAL_STYLE = { zoanthid: { c: "#3fbf6f", m: "ZO" }, goniopora: { c: "#9a7bc4", m: "GO" } };
  function groupLabel(txt) { return '<li style="list-style:none;font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin-top:8px">' + esc(txt) + "</li>"; }
  function noteLine(txt) { return '<li style="list-style:none;font-size:12px;line-height:1.4;color:var(--ink-soft)">' + txt + "</li>"; }

  function renderLivestock(snap) {
    var out = [];
    var mem = state.memorial ? state.memorial.length : 0;
    if (mem > 0) out.push(noteLine('<b>In memoriam:</b> ' + mem + ' animal' + (mem === 1 ? "" : "s") + " remembered."));

    // living / dead animals
    if (!snap.livestock.length && !snap.corals.length) {
      out.push(noteLine("No residents yet — cycle the habitat, then stock a legal starter group from the Store."));
    }
    var animals = snap.livestock;
    if (animals.length) {
      out.push(groupLabel("Animals"));
      for (var i = 0; i < animals.length; i++) out.push(creatureCard(animals[i]));
    }
    // corals
    if (snap.corals.length) {
      out.push(groupLabel("Corals"));
      for (var c = 0; c < snap.corals.length; c++) out.push(coralCard(snap.corals[c]));
    }
    // clutches / eggs / fry
    if (snap.clutches && snap.clutches.length) {
      out.push(groupLabel("Eggs & fry"));
      for (var k = 0; k < snap.clutches.length; k++) out.push(noteLine(clutchLine(snap.clutches[k])));
    }
    // breeding status in plain language (why it has / hasn't happened)
    var breeding = breedingLines();
    if (breeding.length) { out.push(groupLabel("Breeding")); for (var b = 0; b < breeding.length; b++) out.push(noteLine(breeding[b])); }
    // microfauna / biodiversity
    out.push(groupLabel("Microfauna"));
    var mf = snap.microfauna;
    out.push(noteLine("Pods " + pct01(mf.pods) + " · infusoria " + pct01(mf.infusoria) + " · worms " + pct01(mf.worms) +
      " · <b>biodiversity " + pct01(mf.biodiversity) + "</b>. Microfauna feed fry and suppress cyanobacteria; seed a live culture or add a refugium to raise it."));

    livestockList.innerHTML = out.join("");
  }
  function miniBar(label, v, lowT, critT) {
    var cls = v < (critT == null ? 0.35 : critT) ? " is-crit" : (v < (lowT == null ? 0.6 : lowT) ? " is-low" : "");
    return '<span class="bar-row' + cls + '"><span class="bar-k">' + esc(label) + '</span>' +
      '<span class="mini-track"><span class="mini-fill" style="--pct:' + pct01(v) + '"></span></span></span>';
  }
  function creatureCard(a) {
    var sp = DATA.SPECIES[a.species] || {};
    var sty = SPECIES_STYLE[a.species] || { c: "#8aa0a8", m: "??" };
    var dead = !a.alive;
    var sev = dead || a.health < 0.5 ? "sev-bad" : (a.hunger > 0.85 || a.health < 0.75 ? "sev-warn" : "");
    var chips = '<span class="chip">' + esc(dead ? "deceased" : a.stage) + "</span>";
    if (!dead && a.sex && a.sex !== "unknown") chips += ' <span class="chip">' + esc(a.sex) + "</span>";
    var alerts = "";
    for (var i = 0; i < a.alerts.length; i++) alerts += '<span class="alert">' + esc(a.alerts[i]) + "</span>";
    var bars, action;
    if (dead) {
      bars = '<span style="font-size:12px;color:var(--ink-soft)">Decaying biomass — remove it before it fouls the water.</span>';
      action = actBtn("offer-cta", "Remove", "removedead", { id: a.id }, ' style="min-height:44px" data-fk="rm:' + a.id + '"');
    } else {
      bars = miniBar("Health", a.health) + miniBar("Condition", a.condition) + miniBar("Fed", 1 - clamp01(a.hunger));
      action = actBtn("offer-cta", "Inspect", "select", { id: a.id, etype: "livestock" }, ' style="min-height:44px;background:var(--blue)" data-fk="insp:' + a.id + '"');
    }
    return '<li class="creature ' + sev + '">' +
      '<span class="creature-art" style="--tint:' + sty.c + ';font-size:14px;font-weight:800;letter-spacing:.02em;color:var(--ink)">' + sty.m + "</span>" +
      '<span class="creature-body"><span class="creature-name">' + esc(sp.name || a.species) + " " + chips + "</span>" +
      '<span class="creature-sci">' + esc(sp.sci || "") + " · " + fmtVal(a.ageDays) + "d</span>" +
      bars +
      '<span class="alerts">' + alerts + action + "</span></span></li>";
  }
  function coralCard(co) {
    var cd = DATA.CORALS[co.species] || {};
    var sty = CORAL_STYLE[co.species] || { c: "#3fbf6f", m: "CO" };
    var sev = co.health < 0.5 || co.stress > 0.5 ? "sev-bad" : (co.stress > 0.3 ? "sev-warn" : "");
    var stage = co.growth >= 0.6 ? "mature" : (co.growth >= 0.3 ? "growing" : "settling");
    var alerts = "";
    if (co.stress > 0.4) alerts += '<span class="alert">stressed</span>';
    var action = actBtn("offer-cta", "Inspect", "select", { id: co.id, etype: "coral" }, ' style="min-height:44px;background:var(--blue)" data-fk="insp:' + co.id + '"');
    return '<li class="creature ' + sev + '">' +
      '<span class="creature-art" style="--tint:' + sty.c + ';font-size:14px;font-weight:800;color:var(--ink)">' + sty.m + "</span>" +
      '<span class="creature-body"><span class="creature-name">' + esc(cd.name || co.species) + ' <span class="chip">' + stage + "</span></span>" +
      '<span class="creature-sci">' + esc(cd.sci || "") + " · " + Math.round(co.polyps) + " polyps</span>" +
      miniBar("Extension", co.extension) + miniBar("Health", co.health) + miniBar("Calm", 1 - clamp01(co.stress)) +
      '<span class="alerts">' + alerts + action + "</span></span></li>";
  }
  function clutchLine(cl) {
    var sp = DATA.SPECIES[cl.species] || {}; var name = sp.name || cl.species;
    if (cl.stage === "eggs") return "<b>" + esc(name) + " eggs:</b> " + cl.count + " — " + (cl.species === "ocellaris" ? "male tending, ~7-day incubation." : "short incubation in soft, dim water.");
    if (cl.stage === "hatched") return "<b>" + esc(name) + " larvae:</b> " + cl.count + " — need " + (cl.species === "ocellaris" ? "copepods" : "infusoria") + " and stable water to survive.";
    if (cl.stage === "fry") return "<b>" + esc(name) + " fry:</b> " + cl.count + " — surviving past the critical larval stage.";
    return esc(name) + ": " + cl.count;
  }
  function breedingLines() {
    var out = [], w = state.water, def = DATA.SPECIES.ocellaris.breeding, tdef = DATA.SPECIES.neon_tetra.breeding;
    // clownfish
    if (isReef() && aliveOf("ocellaris") > 0) {
      var cb = state.breeding.clown, clowns = aliveAdults("ocellaris");
      if (clowns.length < 2) out.push("Clownfish need <b>two mature adults</b> to pair — you have " + clowns.length + " adult" + (clowns.length === 1 ? "" : "s") + ".");
      else if (cb.paired) {
        out.push("Clownfish: <b>bonded pair</b> (a female and a male, protandrous hierarchy).");
        out.push(cb.spawnCooldown > 0 ? "Resting " + cb.spawnCooldown.toFixed(1) + "d before the next clutch." : "Ready to spawn adhesive eggs while water stays stable.");
        out.push("Fry survival needs copepods (pods " + pct01(state.microfauna.pods) + ", need &gt;20%).");
      } else {
        out.push("Clownfish: forming a hierarchy (bond " + cb.bondDays.toFixed(1) + "/" + def.pairBondDays + "d).");
        var why = clownBlockers();
        if (why.length) out.push("Held back by: " + why.join(", ") + ".");
      }
    }
    // neon tetra
    if (state.habitat === "amazon" && aliveOf("neon_tetra") > 0) {
      var tb = state.breeding.tetra, tetras = aliveAdults("neon_tetra");
      if (tetras.length < tdef.socialMin) out.push("Neon tetra spawn in a <b>school of ≥" + tdef.socialMin + " adults</b> — you have " + tetras.length + ".");
      else {
        out.push("Neon tetra: school ready (" + tetras.length + " adults)." + (tb.spawnCooldown > 0 ? " Resting " + tb.spawnCooldown.toFixed(1) + "d." : ""));
        var twhy = tetraBlockers();
        if (twhy.length) out.push("Waiting on: " + twhy.join(", ") + ".");
        else out.push("Fry survival needs infusoria (infusoria " + pct01(state.microfauna.infusoria) + ", need &gt;20%).");
      }
    }
    return out;
  }
  function clownBlockers() {
    var w = state.water, r = [], clowns = aliveAdults("ocellaris").slice(0, 2);
    var healthy = clowns.length >= 2 && clowns[0].health >= 0.7 && clowns[1].health >= 0.7;
    if (!healthy) r.push("adult health under 70%");
    if (!(DATA.waterSafeForLife(state) && Math.abs(w.tempC - 26) < 3 && w.salinity >= 33 && w.salinity <= 36)) r.push("unstable water / salinity");
    if (!DATA.tankFeatures(state).host) r.push("no host territory");
    if (DATA.currentBioload(state) > DATA.bioloadCapacity(state)) r.push("over capacity");
    return r;
  }
  function tetraBlockers() {
    var w = state.water, r = [], tdef = DATA.SPECIES.neon_tetra.breeding, tetras = aliveAdults("neon_tetra");
    var healthy = tetras.length > 0; for (var i = 0; i < tetras.length; i++) if (tetras[i].health < 0.7) healthy = false;
    if (!healthy) r.push("school health under 70%");
    if (!(w.pH <= tdef.water.pHMax && w.hardness <= tdef.water.hardnessMax)) r.push("water not soft/acidic enough");
    if (!(DATA.equipLevel("light", state.equipment.light).parCeiling <= 80)) r.push("lighting too bright (needs dim blackwater)");
    if (!DATA.tankFeatures(state).cover) r.push("no planted cover");
    if (!DATA.waterSafeForLife(state)) r.push("unsafe ammonia/nitrite");
    if (DATA.currentBioload(state) > DATA.bioloadCapacity(state)) r.push("over capacity");
    return r;
  }

  /* ============================ render: Store ============================ */
  function renderStore(snap) {
    var out = [];
    // livestock (habitat-filtered)
    out.push(groupLabel("Livestock"));
    var any = false;
    for (var id in DATA.SPECIES) if (DATA.SPECIES.hasOwnProperty(id) && DATA.SPECIES[id].habitat === state.habitat) { out.push(speciesOffer(DATA.SPECIES[id])); any = true; }
    if (!any) out.push(noteLine("Choose a habitat to see its livestock."));
    // corals (reef)
    if (isReef()) { out.push(groupLabel("Corals")); for (var cid in DATA.CORALS) if (DATA.CORALS.hasOwnProperty(cid)) out.push(coralOffer(DATA.CORALS[cid])); }
    // microfauna cultures
    out.push(groupLabel("Microfauna cultures"));
    out.push(cultureOffer());
    // equipment
    out.push(groupLabel("Equipment"));
    out.push(equipmentOffers());
    // tank tiers
    out.push(groupLabel("Tank upgrades"));
    out.push(tierOffers());
    storeList.innerHTML = out.join("");
  }
  function lockReasons(reasons) {
    if (!reasons.length) return "";
    var li = ""; for (var i = 0; i < reasons.length; i++) li += "<li>" + esc(reasons[i]) + "</li>";
    return '<ul class="lock-reasons">' + li + "</ul>";
  }
  function offer(opts) {
    // opts: {tint, mono, name, sci, meta, reasons, price, priceIcon, act, ds, fk, owned, ownedLabel, extra}
    if (opts.owned) {
      return '<li class="offer"><span class="offer-art" style="--tint:' + opts.tint + ';font-size:13px;font-weight:800;color:var(--ink)">' + opts.mono + "</span>" +
        '<span class="offer-body"><span class="offer-name">' + esc(opts.name) + ' <span class="chip">' + esc(opts.ownedLabel || "installed") + "</span></span>" +
        (opts.sci ? '<span class="offer-sci">' + esc(opts.sci) + "</span>" : "") +
        '<span class="offer-meta">' + (opts.meta || "") + "</span>" + (opts.extra || "") + "</span></li>";
    }
    var ok = !opts.reasons.length;
    var btn = actBtn("offer-cta", ok ? "Buy" : "Locked", opts.act, opts.ds, ' data-fk="' + opts.fk + '"' + (ok ? "" : ' disabled title="' + esc(opts.reasons.join(" ")) + '"'));
    return '<li class="offer ' + (ok ? "is-buyable" : "is-locked") + '">' +
      '<span class="offer-art" style="--tint:' + opts.tint + ';font-size:13px;font-weight:800;color:var(--ink)">' + opts.mono + "</span>" +
      '<span class="offer-body"><span class="offer-name">' + esc(opts.name) + "</span>" +
      (opts.sci ? '<span class="offer-sci">' + esc(opts.sci) + "</span>" : "") +
      '<span class="offer-meta">' + (opts.meta || "") + "</span>" + (opts.extra || "") + lockReasons(opts.reasons) + "</span>" +
      '<span class="offer-side"><span class="offer-price">' + (opts.priceIcon || "◉") + " " + opts.price + "</span>" + btn + "</span></li>";
  }
  function speciesOffer(sp) {
    var sty = SPECIES_STYLE[sp.id] || { c: "#8aa0a8", m: "??" };
    var count = DATA.BUNDLES[sp.id] || 1;
    var v = PA.validatePurchase(state, { kind: "livestock", id: sp.id, count: count });
    var meta = [];
    meta.push(sp.waterType === "salt" ? "Saltwater" : "Freshwater");
    meta.push("adult " + sp.adultSizeCm + " cm");
    if (sp.socialMin > 1) meta.push("group ≥" + sp.socialMin);
    meta.push("min " + sp.minVolumeL + " L / " + DATA.TIERS[sp.minTier].name);
    meta.push(sp.diet);
    var extra = "";
    var flags = [];
    if (sp.predator) flags.push("predator");
    if (sp.expert) flags.push("expert-only");
    if (!sp.invertSafe) flags.push("not invert-safe");
    if (flags.length) extra += '<span class="offer-meta">' + esc(flags.join(" · ")) + "</span>";
    if (sp.breeding) extra += '<span class="offer-meta">Breeds: ' + esc(sp.breeding.note || sp.breeding.type) + "</span>";
    if (sp.teachNote) extra += '<span class="offer-meta" style="color:var(--bad)">' + esc(sp.teachNote) + "</span>";
    return offer({
      tint: sty.c, mono: sty.m, name: sp.name + (count > 1 ? " ×" + count : ""), sci: sp.sci + " · " + sp.nativeHabitat,
      meta: esc(meta.join(" · ")), extra: extra, reasons: v.reasons, price: sp.price * count,
      act: "buy-live", ds: { species: sp.id, count: count }, fk: "buy:" + sp.id
    });
  }
  function coralOffer(cd) {
    var sty = CORAL_STYLE[cd.id] || { c: "#3fbf6f", m: "CO" };
    var v = PA.validatePurchase(state, { kind: "coral", id: cd.id });
    var meta = "PAR " + cd.par.min + "–" + cd.par.max + " µmol (best " + cd.par.low + "–" + cd.par.high + ") · flow " + cd.flow.min + "–" + cd.flow.max + " · needs a " + (cd.maturityGate === "mature" ? "mature" : "cycled") + " system";
    return offer({ tint: sty.c, mono: sty.m, name: cd.name, sci: cd.sci, meta: esc(meta) + '<span class="offer-meta">' + esc(cd.note) + "</span>", reasons: v.reasons, price: cd.price, act: "buy-coral", ds: { coral: cd.id }, fk: "coral:" + cd.id });
  }
  function cultureOffer() {
    var reef = isReef();
    var culture = reef ? "pods" : "infusoria";
    var name = reef ? "Copepod culture" : "Infusoria starter culture";
    var meta = reef ? "Seeds pods — raises biodiversity and feeds clownfish larvae." : "Live microfood — lets neon-tetra fry survive their first days.";
    var reasons = [];
    if ((state.credits || 0) < 15) reasons.push("Not enough credits (need 15, have " + Math.floor(state.credits || 0) + ").");
    return offer({ tint: "#7fae5a", mono: reef ? "PD" : "IN", name: name, meta: esc(meta), reasons: reasons, price: 15, act: "seed", ds: { culture: culture }, fk: "culture:" + culture });
  }
  function equipmentOffers() {
    var out = [];
    for (var cat in DATA.EQUIPMENT) {
      if (!DATA.EQUIPMENT.hasOwnProperty(cat)) continue;
      var def = DATA.EQUIPMENT[cat];
      var curId = state.equipment[cat];
      var cur = DATA.equipLevel(cat, curId) || def.levels[0];
      var curIdx = 0; for (var q = 0; q < def.levels.length; q++) if (def.levels[q].id === cur.id) curIdx = q;
      // installed marker
      out.push(offer({ tint: "#c9d3d8", mono: monoOf(def.label), name: def.label, meta: "Installed: <b>" + esc(cur.name) + "</b>" + (curIdx === def.levels.length - 1 ? " (max)" : ""), owned: true, ownedLabel: "installed" }));
      for (var l = curIdx + 1; l < def.levels.length; l++) {
        var lvl = def.levels[l];
        var v = PA.validatePurchase(state, { kind: "equipment", category: cat, levelId: lvl.id });
        out.push(offer({ tint: "#aebfc7", mono: monoOf(lvl.name), name: lvl.name, meta: esc(equipCopy(cat, cur, lvl)), reasons: v.reasons, price: lvl.price, act: "buy-equip", ds: { category: cat, level: lvl.id }, fk: "equip:" + cat + ":" + lvl.id }));
      }
    }
    return out.join("");
  }
  function equipCopy(cat, cur, lvl) {
    switch (cat) {
      case "filter": return "Biofilter surface " + cur.biofilterSurface + "→" + lvl.biofilterSurface + "× (more nitrifier capacity → higher bioload cap) · flow " + cur.flow + "→" + lvl.flow;
      case "heater": return "Holds temperature near " + lvl.target + "°C · stability " + cur.stability + "→" + lvl.stability + " (less thermal swing)";
      case "circulation": return "Flow " + cur.flow + "→" + lvl.flow + " · O₂ " + cur.oxygen + "→" + lvl.oxygen + " · dead-zones " + cur.deadzone + "→" + lvl.deadzone + " (less cyanobacteria)";
      case "light": return "PAR ceiling " + cur.parCeiling + "→" + lvl.parCeiling + " µmol" + (lvl.photoperiodControl && !cur.photoperiodControl ? " · adds photoperiod control" : "");
      case "skimmer": return "Organic export " + cur.organicExport + "→" + lvl.organicExport + " (faster phosphate/nitrate drawdown)";
      case "refugium": return "Nitrate export " + cur.nitrateExport + "→" + lvl.nitrateExport + " · pod capacity " + cur.podCapacity + "→" + lvl.podCapacity;
      case "ato": return "Auto top-off — replaces evaporated freshwater to hold volume &amp; salinity steady";
      default: return "Upgrade";
    }
  }
  function tierOffers() {
    var out = [], curIdx = DATA.tierIndex(state.tier), cur = DATA.TIERS[state.tier];
    for (var i = 0; i < DATA.TIER_ORDER.length; i++) {
      var t = DATA.TIERS[DATA.TIER_ORDER[i]];
      if (i <= curIdx) { out.push(offer({ tint: "#cdb488", mono: "T" + (i + 1), name: t.name, meta: t.volumeL + " L · " + t.footprintCm2 + " cm² floor · capacity " + t.bioloadCap, owned: true, ownedLabel: i === curIdx ? "current" : "owned" })); continue; }
      var v = PA.validatePurchase(state, { kind: "tier", id: t.id });
      out.push(offer({ tint: "#cdb488", mono: "T" + (i + 1), name: t.name, meta: esc(tierCopy(cur, t)), reasons: v.reasons, price: t.price, act: "buy-tier", ds: { tier: t.id }, fk: "tier:" + t.id }));
    }
    return out.join("");
  }
  function tierCopy(cur, t) {
    return "Volume " + cur.volumeL + "→" + t.volumeL + " L (more dilution) · floor " + cur.footprintCm2 + "→" + t.footprintCm2 + " cm² · biofilter base " + cur.biofilterBase + "→" + t.biofilterBase + " · capacity " + cur.bioloadCap + "→" + t.bioloadCap;
  }
  function monoOf(name) { var w = String(name).replace(/[^A-Za-z ]/g, "").trim().split(/\s+/); return ((w[0] || "?")[0] + (w[1] ? w[1][0] : (w[0] || "x")[1] || "")).toUpperCase(); }

  /* ============================ render: Journal ============================ */
  function renderJournal() {
    var log = state.log || [];
    var out = [];
    for (var i = log.length - 1; i >= 0 && out.length < 80; i--) {
      var e = log[i];
      var sev = e.type === "death" ? "sev-bad" : (e.type === "warn" || e.type === "quarantine" ? "sev-warn" : (e.type === "milestone" || e.type === "breeding" ? "sev-ok" : ""));
      out.push('<li class="log-entry ' + sev + '">' +
        '<time class="log-day">Day ' + ((e.day || 0) + 1) + "</time>" +
        '<span class="log-text">' + esc(clockOf(e.t) + " · " + e.message) + "</span></li>");
    }
    journalList.innerHTML = out.join("");
  }
  function clockOf(t) {
    t = +t || 0; var frac = t - Math.floor(t);
    var h = Math.floor(frac * 24), m = Math.floor((frac * 24 - h) * 60);
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  /* ============================ render: Inspector ============================ */
  function findLivestock(id) { var ls = state.livestock; for (var i = 0; i < ls.length; i++) if (String(ls[i].id) === id) return ls[i]; return null; }
  function findCoral(id) { var cs = state.corals; for (var i = 0; i < cs.length; i++) if (String(cs[i].id) === id) return cs[i]; return null; }
  function renderInspector() {
    var html = inspectorHTML();
    if (inspector.innerHTML !== html) inspector.innerHTML = html;
  }
  function inspectorHTML() {
    var sel = state.selection; if (!sel || sel.id == null) return "";
    var id = String(sel.id);
    var a = findLivestock(id); if (a) return animalInspector(a);
    var co = findCoral(id); if (co) return coralInspector(co);
    return ""; // selected entity absent (e.g. removed) — resting hint returns; no crash
  }
  function inspHead(title, sci) {
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
      '<div><p class="insp-title">' + esc(title) + '</p><p class="insp-sci">' + esc(sci) + "</p></div>" +
      '<button type="button" class="tbtn" data-act="insp-close" data-fk="insp-close" aria-label="Close inspector" style="min-width:44px;min-height:44px;color:#eaf6f8">×</button></div>';
  }
  function insRow(k, v) { return '<div class="insp-row"><span>' + esc(k) + "</span><span>" + esc(v) + "</span></div>"; }
  function animalInspector(a) {
    var sp = DATA.SPECIES[a.species] || {};
    var title = (sp.name || a.species) + " — " + (a.alive === false ? "deceased" : a.stage);
    var rows = "";
    if (a.sex && a.sex !== "unknown") rows += insRow("Sex", a.sex);
    rows += insRow("Health", pct01(a.health));
    rows += insRow("Condition", pct01(a.condition));
    rows += insRow("Fed", pct01(1 - clamp01(a.hunger)));
    return inspHead(title, (sp.sci || "") + " · " + fmtVal(a.ageDays) + "d old") + rows +
      '<p style="margin:8px 0 0;font-size:12px;line-height:1.45">' + esc(explainAnimal(a)) + "</p>";
  }
  function coralInspector(co) {
    var cd = DATA.CORALS[co.species] || {};
    var rows = insRow("Polyp extension", pct01(co.extension)) + insRow("Health", pct01(co.health)) +
      insRow("Stress", pct01(co.stress)) + insRow("Polyps", Math.round(co.polyps)) + insRow("Growth", pct01(co.growth));
    return inspHead(cd.name || co.species, cd.sci || "") + rows +
      '<p style="margin:8px 0 0;font-size:12px;line-height:1.45">' + esc(explainCoral(co)) + "</p>";
  }
  function explainAnimal(a) {
    var sp = DATA.SPECIES[a.species] || {}, w = state.water;
    if (a.alive === false) return "Deceased — proximate cause: " + (a.causeOfDeath || "unknown") + ". Remove the body so it stops fouling the water.";
    var parts = [];
    if (a.species === "ocellaris" && DATA.tankFeatures(state).host) parts.push("Hugging its host territory");
    else if (sp.layer === "bottom") parts.push("Foraging along the substrate");
    else if (sp.layer === "top") parts.push("Holding near the surface");
    else parts.push("Cruising mid-water");
    if (a.health < 0.4) parts.push("and in poor health");
    else if (a.health < 0.7) parts.push("and a little stressed");
    else parts.push("and looks healthy");
    var drivers = [];
    if (a.hunger > 0.85) drivers.push("hungry — feed the tank");
    if (waterToxic()) drivers.push("the water is toxic — do a water change");
    if (Math.abs(w.tempC - 26) > 4) drivers.push("temperature is off-target");
    if (isReef() && Math.abs(w.salinity - 35) > 3) drivers.push("salinity is off-target");
    if (w.oxygen < 4.5) drivers.push("oxygen is low");
    var s = parts.join(" ") + ".";
    if (drivers.length) s += " Right now: " + drivers.join("; ") + ".";
    return s;
  }
  function explainCoral(co) {
    var cd = DATA.CORALS[co.species] || {}, w = state.water;
    var frac = state.time.days - Math.floor(state.time.days);
    var day = frac > 0.28 && frac < 0.86;
    var lead = co.extension > 0.6 ? "Polyps fully extended" : (co.extension > 0.3 ? "Polyps partly open" : (day ? "Polyps retracted" : "Polyps closed for the night"));
    var reasons = [];
    if (day && cd.par && w.par < cd.par.low) reasons.push("not enough daytime PAR");
    if (cd.par && w.par > cd.par.high) reasons.push("PAR is too strong");
    if (cd.flow && w.flow < cd.flow.min) reasons.push("flow too weak");
    if (cd.flow && w.flow > cd.flow.max) reasons.push("flow too strong");
    if (co.stress > 0.4) reasons.push("chemistry/stress high");
    var s = lead + ".";
    if (reasons.length) s += " Cause: " + reasons.join(", ") + ".";
    else if (co.extension > 0.5) s += " Responding well to the current light and flow.";
    s += " Polyps " + Math.round(co.polyps) + ", growth " + Math.round(co.growth * 100) + "%.";
    return s;
  }

  /* ============================ clock loop ============================ */
  function loop(ts) {
    rafId = raf(loop);
    if (lastTs == null) lastTs = ts;
    var dtSec = clamp((ts - lastTs) / 1000, 0, 0.25); // bounded real delta
    lastTs = ts;
    var running = state && state.habitat && state.speed > 0;
    if (running && dtSec > 0) PA.step(state, dtSec); // fixed-step sim advance at the selected 0/1/4/8x
    if (running && ts - lastDomAt >= DOM_INTERVAL) needsRender = true;
    if (needsRender) { needsRender = false; lastDomAt = ts; renderDynamic(); }
    if (running) markDirty();
    if (pendingSave && Date.now() - lastSaveAt >= 2000) save(); // <=1 write / 2 s
  }
  function raf(fn) {
    return (typeof requestAnimationFrame === "function") ? requestAnimationFrame(fn) : setTimeout(function () { fn(nowMs()); }, 16);
  }

  /* ============================ wiring ============================ */
  function buildScaffold() {
    // The always-visible command surface now owns the single recommended action, so the
    // Guide no longer carries an equal-weight quick-care grid. Only the Water tools and
    // journal footer are injected here.
    waterControls = document.createElement("div");
    waterControls.id = "waterControls";
    waterList.insertAdjacentElement("beforebegin", waterControls);

    journalFooter = document.createElement("div");
    journalFooter.id = "journalFooter";
    journalFooter.style.cssText = "margin-top:8px;padding-top:10px;border-top:2px dashed color-mix(in srgb,var(--ink) 22%,transparent)";
    journalFooter.innerHTML = actBtn("offer-cta", "Start over…", "startover", null, ' style="background:var(--bad)" data-fk="startover"') +
      '<p class="meter-foot" style="margin:6px 0 0">Clears ecosystem progress only — your preserved arcade save is never touched.</p>';
    journalList.insertAdjacentElement("afterend", journalFooter);
  }
  function wire() {
    // habitat dialog: native form(method="dialog") sets returnValue to the button's value
    if (habitatDialog) {
      habitatDialog.addEventListener("close", function () {
        var v = habitatDialog.returnValue;
        if (v === "freshwater" || v === "reef") chooseHabitat(v);
        else if (!state.habitat) setTimeout(openHabitatDialog, 0); // a habitat choice is required
      });
    }
    // transport
    if (pauseBtn) pauseBtn.addEventListener("click", function () { dispatchAction({ type: ACT.TOGGLE_PAUSE }); });
    if (speed1Btn) speed1Btn.addEventListener("click", function () { dispatchAction({ type: ACT.SET_SPEED, speed: 1 }); });
    if (speed4Btn) speed4Btn.addEventListener("click", function () { dispatchAction({ type: ACT.SET_SPEED, speed: 4 }); });
    if (speed8Btn) speed8Btn.addEventListener("click", function () { dispatchAction({ type: ACT.SET_SPEED, speed: 8 }); });
    // tabs: click + roving arrow/home/end
    for (var i = 0; i < TABS.length; i++) (function (idx) { TABS[idx].tab.addEventListener("click", function () { selectTab(idx, false); }); })(i);
    var tablist = document.querySelector(".dock-tabs");
    if (tablist) tablist.addEventListener("keydown", function (e) {
      var handled = true;
      switch (e.key) {
        case "ArrowRight": case "ArrowDown": selectTab(activeTab + 1, true); break;
        case "ArrowLeft": case "ArrowUp": selectTab(activeTab - 1, true); break;
        case "Home": selectTab(0, true); break;
        case "End": selectTab(TABS.length - 1, true); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    });
    // delegated action clicks (document-level: modals live outside #app)
    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || t.disabled) return;
      handleAct(t);
    });
    // canvas: Enter/Space feeds at centre (pointer feed/select comes from the renderer)
    if (tankCanvas) tankCanvas.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); feedCenter(); }
    });
    // Escape closes the inspector or an app modal
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (habitatDialog && habitatDialog.open) return; // native dialog handles its own Escape
      var m = modalRoot.querySelector("dialog[open]");
      if (m) { m.close(); return; }
      if (state.selection) dispatchAction({ type: ACT.SELECT_ENTITY, id: null });
    });
    // pause with the page; resume the prior speed only if it was running
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (state && state.speed > 0) { visibilityPaused = true; dispatchAction({ type: ACT.TOGGLE_PAUSE }); save(); }
      } else if (visibilityPaused) {
        visibilityPaused = false;
        if (state && state.speed === 0) dispatchAction({ type: ACT.TOGGLE_PAUSE });
        lastTs = null;
      }
    });
    // flush the save on the way out
    global.addEventListener("pagehide", function () { save(); });
    global.addEventListener("beforeunload", function () { save(); });
  }

  /* ============================ bootstrap ============================ */
  function bootstrap() {
    var parsed = load();
    if (parsed) state = PA.sanitizeState(parsed);
    else state = PA.createState({ now: Date.now() });
    pendingFirstFeed = false; pendingCycleBoostDays = 0; // resident/loaded saves never enter transient guide beats

    // offline catch-up (capped by the sim) with a concise return report when meaningful
    var report = null;
    if (state.habitat && state.lastRealTimestamp > 0) {
      var elapsed = Date.now() - state.lastRealTimestamp;
      if (elapsed > 1000) report = PA.offlineCatchUp(state, elapsed);
    }
    logCursor = state.log.length; // don't toast historical log lines

    buildScaffold();
    wire();
    renderer = PA.createRenderer(tankCanvas, rendererState, dispatchAction);
    applyTheme();
    selectTab(0, false);
    renderNow();

    if (report && (report.appliedDays >= 0.02 || report.deaths > 0)) {
      toast("Welcome back — " + report.appliedDays + " game day" + (report.appliedDays === 1 ? "" : "s") + " passed" +
        (report.capped ? " (capped at " + DATA.offlineCapDays + ")" : "") + (report.deaths > 0 ? "; " + report.deaths + " animal(s) were lost" : "") + ".", "offline");
    }
    if (!state.habitat) openHabitatDialog();

    save();
    registerServiceWorker();
    rafId = raf(loop);
  }

  // Register the offline-shell worker only on a real HTTP(S) origin (localhost or the
  // GitHub Pages subpath). Never on file:// — there is no service-worker scope there and
  // the relative "sw.js" resolves against the document base, so it stays subpath-safe.
  function registerServiceWorker() {
    try {
      var nav = global.navigator, loc = global.location;
      if (nav && nav.serviceWorker && loc && /^https?:$/.test(loc.protocol)) {
        nav.serviceWorker.register("sw.js")["catch"](function () { /* offline shell optional */ });
      }
    } catch (e) { /* SW unsupported — the app still runs directly from the network/file */ }
  }

  // Bootstrap only in a real document. Under a headless test load (no document) the module
  // just publishes PA._app above and returns — bootstrap and all DOM binding are skipped.
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap);
    else bootstrap();
  }

})(typeof window !== "undefined" ? window : this);
