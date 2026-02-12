// Piano Practice V2 (clean build)
// - session state machine
// - metronome + count-in (Web Audio)
// - harmonic field (canvas)
// - keyboard diagram (long keys) + auto-fade during ACTIVE
// No audio grading.

const $ = (id) => document.getElementById(id);

// UI refs
const phaseLabel = $("phaseLabel");
const movementKicker = $("movementKicker");
const instructionText = $("instructionText");
const instructionSub = $("instructionSub");

const hintBtn = $("hintBtn");
const hintCount = $("hintCount");
const prevBtn = $("prevBtn");
const skipBtn = $("skipBtn");
const primaryBtn = $("primaryBtn");
const secondaryBtn = $("secondaryBtn");
const checkinRow = $("checkinRow");
const statusLine = $("statusLine");

const statePill = $("statePill");
const blockTimerEl = $("blockTimer");

const metroBtn = $("metroBtn");
const bpm = $("bpm");
const bpmVal = $("bpmVal");
const beatDot = $("beatDot");

const field = $("field");
const keys = $("keys");

// ------------------------------
// Storage
// ------------------------------
const STORAGE_KEY = "piano_v2_state";
const todayISO = () => new Date().toISOString().slice(0,10);

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveState(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ------------------------------
// Session definition (45 min default)
// ------------------------------
const SESSION = [
  {
    phase: "ARRIVAL",
    title: "Arrival",
    blocks: [
      { kind:"info", seconds: 180,
        line:"Sit comfortably. Today’s focus: fluency over speed.",
        sub:"Tap Begin when your hands are on the keys.",
        metronome:false, diagram:false, checkin:false
      },
    ]
  },
  {
    phase: "WARMUP",
    title: "Technical Warmup",
    blocks: [
      { kind:"play", seconds: 480,
        line:"C major. Hands separate. Left hand first. 60 BPM.",
        sub:"Clean notes. Even tone. No rushing.",
        metronome:true, diagram:true, checkin:true
      },
    ]
  },
  {
    phase: "THINKING",
    title: "Thinking While Playing",
    blocks: [
      { kind:"play", seconds: 600,
        line:"Build diatonic triads in G major. Root position. Say quality out loud.",
        sub:"Then broken: 1–3–5–3. Stay relaxed.",
        metronome:true, diagram:true, checkin:true
      },
    ]
  },
  {
    phase: "APPLICATION",
    title: "Application",
    blocks: [
      { kind:"play", seconds: 900,
        line:"In D major: play I–V–vi–IV. Block → Broken → Improv (2 min).",
        sub:"Musicality first. Metronome optional.",
        metronome:false, diagram:false, checkin:true
      },
    ]
  },
  {
    phase: "REFLECTION",
    title: "Reflection",
    blocks: [
      { kind:"reflect", seconds: 300,
        line:"What improved today?",
        sub:"Then: what felt tense? what should tomorrow emphasize?",
        metronome:false, diagram:false, checkin:false
      },
    ]
  }
];

// ------------------------------
// Session machine
// ------------------------------
const Machine = {
  phaseIdx: 0,
  blockIdx: 0,
  blockState: "READY", // READY | COUNT_IN | ACTIVE | CHECK_IN | DONE
  hintsLeft: 3,
  bpm: 60,
  metroEnabled: false,
  startedAt: null,
  remaining: null,
  lastTick: null,
  diagramAlpha: 1.0, // fades while playing
  fingeringAlpha: 1.0
};

const appState = loadState();
if (appState?.hintsLeft != null) Machine.hintsLeft = appState.hintsLeft;
if (appState?.bpm != null) Machine.bpm = appState.bpm;

bpm.value = String(Machine.bpm);
bpmVal.textContent = String(Machine.bpm);
hintCount.textContent = String(Machine.hintsLeft);

// ------------------------------
// Metronome (Web Audio)
// ------------------------------
let audioCtx = null;
let metroTimer = null;
let metroOn = false;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function clickSound(isAccent=false) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.value = isAccent ? 1200 : 900;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(isAccent ? 0.18 : 0.12, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(audioCtx.destination);
  o.start(t);
  o.stop(t + 0.06);
}

function startMetronome() {
  ensureAudio();
  stopMetronome();
  metroOn = true;

  let beat = 0;
  const ms = () => Math.round((60_000) / Machine.bpm);

  const tick = () => {
    if (!metroOn) return;
    const accent = (beat % 4 === 0);
    clickSound(accent);
    pulseBeat();
    beat++;
    metroTimer = setTimeout(tick, ms());
  };
  tick();
}

function stopMetronome() {
  metroOn = false;
  if (metroTimer) clearTimeout(metroTimer);
  metroTimer = null;
}

function pulseBeat() {
  beatDot.style.opacity = "1";
  setTimeout(() => (beatDot.style.opacity = "0.25"), 70);
}

// ------------------------------
// Timer
// ------------------------------
let blockInterval = null;

function startBlockTimer(seconds) {
  stopBlockTimer();
  Machine.remaining = seconds;
  Machine.lastTick = performance.now();
  updateTimerUI();

  blockInterval = setInterval(() => {
    const now = performance.now();
    const dt = (now - Machine.lastTick) / 1000;
    Machine.lastTick = now;

    Machine.remaining = Math.max(0, Machine.remaining - dt);

    if (Machine.blockState === "ACTIVE") {
      // gradual fade while playing
      const total = currentBlock().seconds;
      const progress = 1 - (Machine.remaining / total);
      Machine.fingeringAlpha = Math.max(0, 1 - progress * 1.15); // fades first
      Machine.diagramAlpha = Math.max(0, 1 - progress * 0.95);
    }

    updateTimerUI();
    renderKeys();

    if (Machine.remaining <= 0.01) {
      onBlockComplete();
    }
  }, 80);
}

function stopBlockTimer() {
  if (blockInterval) clearInterval(blockInterval);
  blockInterval = null;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

function updateTimerUI() {
  blockTimerEl.textContent = fmtTime(Machine.remaining ?? 0);
}

// ------------------------------
// Session helpers
// ------------------------------
function currentPhase() { return SESSION[Machine.phaseIdx]; }
function currentBlock() { return currentPhase().blocks[Machine.blockIdx]; }

function persist() {
  saveState({
    hintsLeft: Machine.hintsLeft,
    bpm: Machine.bpm,
    lastUsed: todayISO(),
  });
}

function setUIForState() {
  const ph = currentPhase();
  const b = currentBlock();

  phaseLabel.textContent = `V2 • ${ph.title}`;
  movementKicker.textContent = ph.title;
  instructionText.textContent = b.line;
  instructionSub.textContent = b.sub;

  hintCount.textContent = String(Machine.hintsLeft);
  statePill.textContent = Machine.blockState;

  // Buttons
  prevBtn.disabled = (Machine.phaseIdx === 0 && Machine.blockIdx === 0);
  skipBtn.disabled = false;

  checkinRow.style.display = (Machine.blockState === "CHECK_IN" && b.checkin) ? "" : "none";

  primaryBtn.style.display = (Machine.blockState === "READY") ? "" : "none";
  primaryBtn.textContent = (Machine.blockState === "READY" && b.kind === "reflect") ? "Reflect" : "Begin";

  secondaryBtn.style.display = (Machine.blockState === "COUNT_IN") ? "" : "none";
  secondaryBtn.textContent = "Start";

  statusLine.textContent =
    b.kind === "reflect"
      ? "A calm close. One sentence. Tomorrow adapts."
      : "You play on your real piano. The app conducts.";

  // Metronome toggle allowed always, but auto behavior depends on block
  if (b.metronome && (Machine.blockState === "COUNT_IN" || Machine.blockState === "ACTIVE")) {
    Machine.metroEnabled = true;
  }

  // Diagram visibility rules
  if (b.diagram) {
    // reset fade at start of block
    if (Machine.blockState === "READY") {
      Machine.diagramAlpha = 1.0;
      Machine.fingeringAlpha = 1.0;
    }
  } else {
    Machine.diagramAlpha = 0.0;
    Machine.fingeringAlpha = 0.0;
  }

  renderField(); // update palette by phase
  renderKeys();
}

// ------------------------------
// State transitions
// ------------------------------
function beginBlock() {
  const b = currentBlock();

  // Some blocks start with count-in if metronome is intended
  if (b.metronome) {
    Machine.blockState = "COUNT_IN";
    setUIForState();
    // Count-in: 1 bar (4 beats) then start
    ensureAudio();
    let beats = 0;
    stopMetronome();
    const tick = () => {
      beats++;
      clickSound(beats === 1);
      pulseBeat();
      if (beats >= 4) {
        Machine.blockState = "ACTIVE";
        setUIForState();
        startMetronome();
        startBlockTimer(b.seconds);
      } else {
        setTimeout(tick, Math.round(60_000 / Machine.bpm));
      }
    };
    tick();
  } else {
    Machine.blockState = "ACTIVE";
    setUIForState();
    stopMetronome();
    startBlockTimer(b.seconds);
  }
}

function onBlockComplete() {
  stopBlockTimer();
  stopMetronome();

  const b = currentBlock();
  if (b.checkin) {
    Machine.blockState = "CHECK_IN";
    setUIForState();
  } else {
    advance();
  }
}

function advance() {
  const ph = currentPhase();

  // move to next block or phase
  if (Machine.blockIdx < ph.blocks.length - 1) {
    Machine.blockIdx++;
  } else {
    if (Machine.phaseIdx < SESSION.length - 1) {
      Machine.phaseIdx++;
      Machine.blockIdx = 0;
    } else {
      // complete
      Machine.blockState = "DONE";
      phaseLabel.textContent = "V2 • Complete";
      instructionText.textContent = "Session complete.";
      instructionSub.textContent = "Nice. Tomorrow we build fluency again.";
      primaryBtn.style.display = "none";
      secondaryBtn.style.display = "none";
      checkinRow.style.display = "none";
      statePill.textContent = "DONE";
      persist();
      return;
    }
  }
  Machine.blockState = "READY";
  setUIForState();
}

function back() {
  // simple back: previous phase/block
  if (Machine.blockIdx > 0) {
    Machine.blockIdx--;
  } else if (Machine.phaseIdx > 0) {
    Machine.phaseIdx--;
    Machine.blockIdx = currentPhase().blocks.length - 1;
  }
  Machine.blockState = "READY";
  setUIForState();
}

function skip() {
  stopBlockTimer();
  stopMetronome();
  advance();
}

// ------------------------------
// Hints (3 per session)
// ------------------------------
function useHint() {
  if (Machine.hintsLeft <= 0) return;

  Machine.hintsLeft--;
  hintCount.textContent = String(Machine.hintsLeft);
  persist();

  // restore diagram briefly (dimmed) if this block uses diagrams
  const b = currentBlock();
  if (b.diagram) {
    Machine.diagramAlpha = Math.max(Machine.diagramAlpha, 0.65);
    Machine.fingeringAlpha = Math.max(Machine.fingeringAlpha, 0.85);
    renderKeys();
  }

  // subtle “teacher nudge”
  const original = instructionSub.textContent;
  instructionSub.textContent = hintForBlock(b);
  setTimeout(() => (instructionSub.textContent = original), 3500);
}

function hintForBlock(b) {
  // Directional hints only.
  if (b.line.includes("C major")) return "Hint: keep wrists loose. Thumb crosses after 3 (RH) / after 3 (LH) in two-octave shapes.";
  if (b.line.includes("diatonic triads")) return "Hint: in major keys the pattern is M–m–m–M–M–m–dim. Say quality as you build.";
  if (b.line.includes("I–V–vi–IV")) return "Hint: keep the top note smooth; aim for even chord changes more than speed.";
  return "Hint: slow down. Clean > fast. One perfect rep beats five messy ones.";
}

// ------------------------------
// Harmonic Field (canvas)
// ------------------------------
const fctx = field.getContext("2d");
let fieldT = 0;

function fieldPalette() {
  const ph = currentPhase().phase;
  // restrained palette changes by phase
  if (ph === "ARRIVAL") return {a:[111,146,255], b:[43,212,194], bg:[11,15,25]};
  if (ph === "WARMUP") return {a:[111,146,255], b:[90,110,200], bg:[11,15,25]};
  if (ph === "THINKING") return {a:[43,212,194], b:[111,146,255], bg:[11,15,25]};
  if (ph === "APPLICATION") return {a:[140,180,255], b:[43,212,194], bg:[11,15,25]};
  return {a:[111,146,255], b:[43,212,194], bg:[11,15,25]};
}

function renderField() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const rect = field.getBoundingClientRect();
  field.width = Math.floor(rect.width * dpr);
  field.height = Math.floor(rect.height * dpr);
  fctx.setTransform(dpr,0,0,dpr,0,0);
}

function drawFieldFrame() {
  fieldT += 0.008;
  const w = field.clientWidth;
  const h = field.clientHeight;
  const {a,b,bg} = fieldPalette();

  // background
  fctx.clearRect(0,0,w,h);
  fctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  fctx.fillRect(0,0,w,h);

  // bands (architectural “harmonic field”)
  const bands = 7;
  for (let i=0;i<bands;i++){
    const y = (i/(bands-1))*h;
    const amp = 18 + i*3;
    const phase = fieldT + i*0.6;
    const thickness = 26 + i*4;

    const r = Math.round(a[0]*(1-i/(bands))+b[0]*(i/(bands)));
    const g = Math.round(a[1]*(1-i/(bands))+b[1]*(i/(bands)));
    const bb = Math.round(a[2]*(1-i/(bands))+b[2]*(i/(bands)));
    fctx.strokeStyle = `rgba(${r},${g},${bb},${0.12 + i*0.01})`;
    fctx.lineWidth = thickness;

    fctx.beginPath();
    for (let x=0;x<=w;x+=18){
      const t = x/w;
      const bend = Math.sin(t*2.8 + phase) * amp
                 + Math.sin(t*6.2 + phase*0.7) * (amp*0.35);
      fctx.lineTo(x, y + bend);
    }
    fctx.stroke();
  }

  // subtle “center gravity” glow
  const cx = w*0.52, cy = h*0.42;
  const grd = fctx.createRadialGradient(cx,cy, 10, cx,cy, h*0.9);
  grd.addColorStop(0, "rgba(111,146,255,0.10)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  fctx.fillStyle = grd;
  fctx.fillRect(0,0,w,h);

  requestAnimationFrame(drawFieldFrame);
}

// ------------------------------
// Keyboard diagram (canvas) — longer keys + fade
// ------------------------------
const kctx = keys.getContext("2d");

// Simple scale highlights for demo (C major)
const HIGHLIGHT_WHITE = new Set([0,2,4,5,7,9,11]); // C D E F G A B within octave
const HIGHLIGHT_BLACK = new Set([]); // none in C major for black keys

function renderKeys() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const rect = keys.getBoundingClientRect();
  keys.width = Math.floor(rect.width * dpr);
  keys.height = Math.floor(rect.height * dpr);
  kctx.setTransform(dpr,0,0,dpr,0,0);

  const w = keys.clientWidth;
  const h = keys.clientHeight;

  kctx.clearRect(0,0,w,h);
  // background
  kctx.fillStyle = "rgba(11,19,38,.55)";
  kctx.fillRect(0,0,w,h);

  const b = currentBlock();
  const showDiagram = b.diagram && (Machine.diagramAlpha > 0.01);

  // Key geometry (longer whites)
  const octaves = 2; // visual only
  const whitePerOct = 7;
  const totalWhite = octaves * whitePerOct;
  const pad = 16;
  const whiteW = (w - pad*2) / totalWhite;
  const whiteH = h * 0.90; // longer keys (less toy)
  const top = (h - whiteH)/2;

  // draw white keys
  for (let i=0;i<totalWhite;i++){
    const x = pad + i*whiteW;
    const isHighlighted = showDiagram && HIGHLIGHT_WHITE.has(i%7===0?0:[0,2,4,5,7,9,11][i%7]) // simple mapping
    // base
    kctx.fillStyle = "rgba(232,238,252,0.08)";
    kctx.fillRect(x, top, whiteW-1, whiteH);
    // outline
    kctx.strokeStyle = "rgba(42,59,97,0.85)";
    kctx.lineWidth = 1;
    kctx.strokeRect(x, top, whiteW-1, whiteH);

    if (showDiagram && isHighlighted) {
      kctx.fillStyle = `rgba(111,146,255,${0.18 * Machine.diagramAlpha})`;
      kctx.fillRect(x, top, whiteW-1, whiteH);
    }

    // fingering overlay (demo: subtle numbers on first few keys)
    if (showDiagram && Machine.fingeringAlpha > 0.02 && i < 5) {
      kctx.fillStyle = `rgba(232,238,252,${0.22 * Machine.fingeringAlpha})`;
      kctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      kctx.fillText(String(i+1), x+8, top + whiteH - 14);
    }
  }

  // black keys (pattern per octave: C# D# _ F# G# A#)
  const blackH = whiteH * 0.62;
  const blackW = whiteW * 0.62;
  const blackOffsets = [1,2,4,5,6]; // positions between whites
  for (let o=0;o<octaves;o++){
    for (let j=0;j<blackOffsets.length;j++){
      const wp = o*7 + blackOffsets[j];
      const x = pad + wp*whiteW - blackW/2;
      kctx.fillStyle = "rgba(0,0,0,0.72)";
      kctx.fillRect(x, top, blackW, blackH);
      kctx.strokeStyle = "rgba(42,59,97,0.65)";
      kctx.strokeRect(x, top, blackW, blackH);

      if (showDiagram && HIGHLIGHT_BLACK.has(j)) {
        kctx.fillStyle = `rgba(43,212,194,${0.20 * Machine.diagramAlpha})`;
        kctx.fillRect(x, top, blackW, blackH);
      }
    }
  }

  // subtle caption when diagram hidden
  if (!b.diagram) {
    kctx.fillStyle = "rgba(184,198,234,0.30)";
    kctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    kctx.fillText("Diagram hidden for application / recall.", pad, 18);
  }
}

// ------------------------------
// Event wiring
// ------------------------------
primaryBtn.addEventListener("click", () => {
  if (!audioCtx) ensureAudio(); // allow audio by user gesture
  beginBlock();
});

secondaryBtn.addEventListener("click", () => {
  // unused in current flow (count-in auto-advances), kept for future
});

prevBtn.addEventListener("click", back);
skipBtn.addEventListener("click", skip);

hintBtn.addEventListener("click", useHint);

checkinRow.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-checkin]");
  if (!btn) return;
  const val = btn.getAttribute("data-checkin");
  // store check-in (v2.1 uses it for adaptation)
  const s = loadState();
  const log = s.checkins || [];
  log.push({ date: todayISO(), phase: currentPhase().phase, val });
  s.checkins = log;
  saveState(s);

  Machine.blockState = "DONE";
  advance();
});

metroBtn.addEventListener("click", () => {
  // manual toggle; useful in application too
  ensureAudio();
  if (metroOn) stopMetronome(); else startMetronome();
});

bpm.addEventListener("input", () => {
  Machine.bpm = Number(bpm.value);
  bpmVal.textContent = String(Machine.bpm);
  persist();
});

// Service worker (offline)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try { await navigator.serviceWorker.register("./service-worker.js"); }
    catch {}
  });
}

// Resize handling
function onResize() {
  renderField();
  renderKeys();
}
window.addEventListener("resize", onResize);

// Boot
Machine.blockState = "READY";
setUIForState();
renderField();
renderKeys();
requestAnimationFrame(drawFieldFrame);
