// content.js — runs on youtube.com (isolated world).
// Wraps YouTube in a Sprout frame, enforces content rules, and gates videos
// behind a question geared to the child's age (and to what they just watched).

const DEFAULTS = {
  enabled: true,
  age: null,               // set on first run; anchors difficulty
  childName: "",
  questionsPerVideo: 1,
  subjects: [],
  pin: "1234",
  aiProvider: "off",  // "off" | "local" | "anthropic"
  apiKey: "",
  gateTiming: "smart",     // "smart" | "start" | "moments"
  level: null,             // derived from age; drifts as they answer
  blockShorts: false,
  blockLive: false,
  blockNonKid: false,
  readAloud: false
};

let settings = { ...DEFAULTS };
let gateActive = false;
let handledKey = null;      // path/video we've already acted on
let guardedVideo = null;
let navToken = 0;

const GRADES = ["K", "1", "2", "3", "4", "5"];
const ageToLevel = (age) => Math.min(5, Math.max(0, (age || 5) - 5));
const numToGrade = (n) => GRADES[Math.min(5, Math.max(0, Math.round(n)))];
// Engine routing.
//  "off"       -> built-in bank for everything
//  "local"     -> on-device Nano for warm-ups; NO video comprehension (Nano hallucinates on it)
//  "premium"   -> on-device Nano for warm-ups; Anthropic for video comprehension (needs key)
function effectiveProvider(kind) {
  const p = settings.aiProvider;
  if (p === "off") return "off";
  if (p === "premium") {
    if (kind === "video") return settings.apiKey ? "anthropic" : "off";
    return "local";
  }
  if (p === "local") return kind === "video" ? "off" : "local";
  return "off";
}
function aiOnFor(kind) { return effectiveProvider(kind) !== "off"; }
function aiOn() { return aiOnFor("general") || aiOnFor("video"); }
function premiumActive() { return settings.aiProvider === "premium" && !!settings.apiKey; }

// After an extension reload, old content scripts lose their context. Guard every
// chrome.* call so those calls fail quietly instead of throwing.
function extAlive() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; } }
function safeSet(obj) { try { if (extAlive()) chrome.storage.local.set(obj); } catch (e) {} }
async function safeSend(msg) { try { if (!extAlive()) return null; return await chrome.runtime.sendMessage(msg); } catch (e) { return null; } }

chrome.storage.local.get(DEFAULTS, (s) => {
  settings = { ...DEFAULTS, ...s };
  if (settings.level == null && settings.age != null) settings.level = ageToLevel(settings.age);
  if (settings.gateTiming === "before") settings.gateTiming = "start";
  else if (settings.gateTiming === "60" || settings.gateTiming === "180") settings.gateTiming = "moments";
  refillGeneral();
  drawFrame();
  handleNav();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const k in changes) settings[k] = changes[k].newValue;
  if (!settings.enabled) { removeGate(); detachComprehension(); removeFrame(); handledKey = null; }
  else { drawFrame(); applyHiding(); }
});

function currentVideoId() {
  if (location.pathname !== "/watch") return null;
  return new URLSearchParams(location.search).get("v");
}
function getVideoEl() {
  return document.querySelector("video.html5-main-video") || document.querySelector("video");
}
function getVideoMeta() {
  const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string");
  const title = (titleEl && titleEl.textContent.trim()) ||
    document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
  const descEl = document.querySelector('meta[name="description"]');
  return { title, description: descEl ? descEl.getAttribute("content") || "" : "" };
}

// ---- Talk to the MAIN-world inject.js --------------------------------------

const INJECT_KEY = { "get-info": "info", "get-transcript": "transcript", "get-timed-transcript": "timed" };
const INJECT_MISS = { "get-info": null, "get-transcript": "", "get-timed-transcript": [] };
function askInject(cmd, extra) {
  return new Promise((resolve) => {
    const id = "s" + Math.random().toString(36).slice(2);
    const key = INJECT_KEY[cmd] || "transcript";
    let done = false;
    function onMsg(e) {
      const m = e.data;
      if (!m || m.__sprout !== key || m.id !== id) return;
      done = true; window.removeEventListener("message", onMsg);
      resolve(cmd === "get-info" ? m.info : cmd === "get-timed-transcript" ? (m.chunks || []) : (m.text || ""));
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ __sprout: cmd, id, ...extra }, "*");
    setTimeout(() => { if (!done) { window.removeEventListener("message", onMsg); resolve(INJECT_MISS[cmd]); } }, 6000);
  });
}

// ---- Question sourcing ------------------------------------------------------

let prep = { key: null, promise: null };
const recentQ = [];               // last-shown question texts, to avoid repeats
function rememberQ(q) { if (q && q.q) { recentQ.push(q.q); if (recentQ.length > 20) recentQ.shift(); } return q; }

// Persisted rotation: every bank question is asked once before ANY repeats.
let askedBank = new Set();
let lastAskedText = "";
function loadAsked() { chrome.storage.local.get({ askedBank: [] }, (r) => { askedBank = new Set(r.askedBank || []); }); }
function saveAsked() { safeSet({ askedBank: Array.from(askedBank).slice(-600) }); }
function nextBankQuestion(grade, subjects) {
  let cands = (QUESTION_BANK[grade] || QUESTION_BANK["2"]).filter(
    (i) => !subjects || subjects.length === 0 || subjects.includes(i.subject));
  if (!cands.length) cands = QUESTION_BANK[grade] || QUESTION_BANK["2"];
  let un = cands.filter((i) => !askedBank.has(i.q));
  if (!un.length) {                          // finished a full cycle -> reset this pool
    cands.forEach((i) => askedBank.delete(i.q));
    un = cands.filter((i) => i.q !== lastAskedText);
    if (!un.length) un = cands.slice();
  }
  const q = un[Math.floor(Math.random() * un.length)];
  askedBank.add(q.q); lastAskedText = q.q; saveAsked();
  return q;
}

// Opening (non-video) questions: buffered in the background so they're instant.
const GENERAL_SUBJECTS = ["math", "reading", "science", "geography", "history", "puzzle"];
let genIdx = 0;
const generalQueue = [];
let refilling = false;

async function genGeneralAI() {
  if (!aiOnFor("general")) return null;
  const subject = GENERAL_SUBJECTS[genIdx++ % GENERAL_SUBJECTS.length];
  try {
    const resp = await safeSend({
      type: "GEN_QUESTION", provider: effectiveProvider("general"), mode: "general",
      subject, age: settings.age, grade: numToGrade(settings.level)
    });
    if (resp && resp.ok && resp.question && Array.isArray(resp.question.choices)) return resp.question;
  } catch (e) {}
  return null;
}
async function refillGeneral(target) {
  target = target || 2;
  if (!aiOn() || refilling) return;
  refilling = true;
  try {
    while (generalQueue.length < target) {
      const q = await genGeneralAI();
      if (!q) break;
      generalQueue.push(q);
    }
  } finally { refilling = false; }
}
// Instant: prefer a buffered AI question, else the bank. Never blocks on a live call.
function takeOpeningQuestion() {
  let q = generalQueue.shift();
  if (q) rememberQ(q);
  else q = rememberQ(nextBankQuestion(numToGrade(settings.level), settings.subjects));
  refillGeneral();
  return q;
}

// Grace: after answering, don't re-quiz on rapid video switches.
let lastAnswerAt = 0;
const OPENING_COOLDOWN_MS = 120000; // 2 minutes
function inCooldown() { return Date.now() - lastAnswerAt < OPENING_COOLDOWN_MS; }

async function buildQuestion(untilMs) {
  if (aiOn()) {
    try {
      const meta = getVideoMeta();
      const transcript = await askInject("get-transcript", { untilMs: untilMs || 0 });
      const resp = await safeSend({
        type: "GEN_QUESTION",
        provider: settings.aiProvider,
        age: settings.age,
        grade: numToGrade(settings.level),
        title: meta.title,
        description: meta.description,
        transcript,
        subjects: settings.subjects
      });
      if (resp && resp.ok && resp.question && Array.isArray(resp.question.choices)) return rememberQ(resp.question);
    } catch (e) { /* fall back */ }
  }
  return rememberQ(pickBankQuestion(numToGrade(settings.level), settings.subjects, recentQ));
}
function prepareQuestion(key, untilMs) {
  if (prep.key === key && prep.promise) return prep.promise;
  prep = { key, promise: buildQuestion(untilMs) };
  return prep.promise;
}

// ---- Navigation + content rules --------------------------------------------

function handleNav() {
  if (!settings.enabled) return;
  applyHiding();

  // Shorts rule
  if (settings.blockShorts && location.pathname.startsWith("/shorts/")) {
    if (handledKey === "shorts") return;
    handledKey = "shorts";
    showBlock("Shorts are turned off", () => { location.href = "https://www.youtube.com/"; });
    return;
  }

  const vid = currentVideoId();
  if (!vid) { removeGate(); detachComprehension(); handledKey = null; return; }
  if (vid === handledKey) return;
  removeGate();
  detachComprehension();
  handledKey = vid;
  navToken++;
  const token = navToken;

  gateOrBlock(token, vid);
}

async function gateOrBlock(token, vid) {
  // Content checks that need player info
  if (settings.blockLive || settings.blockNonKid) {
    const info = await askInject("get-info");
    if (token !== navToken) return;
    if (info && settings.blockLive && info.isLive) {
      pausePlayer(); showBlock("Live streams are turned off", () => { location.href = "https://www.youtube.com/"; });
      return;
    }
    if (info && settings.blockNonKid && info.isFamilySafe === false) {
      pausePlayer(); showBlock("This video isn't marked for kids", () => resumeAndClear());
      return;
    }
  }

  if (settings.age == null) { schedule(token, vid, "onboard"); return; }

  const mode = settings.gateTiming;                 // "smart" | "start" | "moments"
  const aiReady = aiOn();
  let wantOpening = (mode === "start" || mode === "smart") && !inCooldown();
  const wantMoments = (mode === "moments" || mode === "smart") && aiOnFor("video");
  // If moments-only but AI can't run, still give an opening question so they learn something.
  if (mode === "moments" && !aiReady && !inCooldown()) wantOpening = true;

  if (wantOpening) scheduleOpening(token, vid, wantMoments);
  else if (wantMoments) scheduleComprehension(token, vid);
  // else: within grace and nothing to do -> let them watch freely
}

function scheduleOpening(token, vid, alsoMoments, attempt = 0) {
  if (token !== navToken || vid !== handledKey) return;
  const video = getVideoEl();
  if (!video) { if (attempt < 12) setTimeout(() => scheduleOpening(token, vid, alsoMoments, attempt + 1), 400); return; }
  gateActive = true;
  guardVideo(video);
  try { video.pause(); } catch (e) {}
  if (alsoMoments) scheduleComprehension(token, vid, video); // pace mid-video checks
  runOpening(video);
}

async function runOpening(video) {
  const host = buildHost("🌱 Warm-up question");
  const q = takeOpeningQuestion();                   // instant
  await showQuestion(host, q, false, { source: "warmup" });
  adaptLevel(true);
  lastAnswerAt = Date.now();
  closeGate(host, video);
}

function schedule(token, vid, mode, mid, attempt = 0) {
  if (token !== navToken || vid !== handledKey) return;
  const video = getVideoEl();
  if (!video) { if (attempt < 12) setTimeout(() => schedule(token, vid, mode, mid, attempt + 1), 400); return; }
  gateActive = true;
  guardVideo(video);
  try { video.pause(); } catch (e) {}
  if (mode === "onboard") runOnboarding(video);
  else runGate(video, settings.questionsPerVideo, mid ? Math.floor(video.currentTime * 1000) : 0);
}

function pausePlayer() { const v = getVideoEl(); if (v) { gateActive = true; guardVideo(v); try { v.pause(); } catch (e) {} } }
function resumeAndClear() { const h = document.getElementById("sprout-gate"); closeGate(h, getVideoEl()); }
function guardVideo(video) {
  if (!video || guardedVideo === video) return;
  guardedVideo = video;
  video.addEventListener("play", () => { if (gateActive) video.pause(); });
}

// ---- Comprehension checks (code-paced; question from transcript-so-far) ------
// We choose WHEN to pause in code (reliable) and only ask the model WHAT to ask
// (a single question from what's been watched) — the part small models handle well.

let comp = { token: 0, times: [], idx: 0, video: null, chunks: [], pending: null, handler: null };

function scheduleComprehension(token, vid, videoMaybe, attempt = 0) {
  if (token !== navToken || vid !== handledKey) return;
  const video = videoMaybe || getVideoEl();
  if (!video) { if (attempt < 12) setTimeout(() => scheduleComprehension(token, vid, null, attempt + 1), 400); return; }
  setupComprehension(token, vid, video);
}

async function setupComprehension(token, vid, video) {
  const n = Math.max(1, Math.min(3, settings.questionsPerVideo || 1));

  // wait briefly for a real duration
  let dur = video.duration, tries = 0;
  while ((!dur || !isFinite(dur)) && tries < 10 && token === navToken) {
    await new Promise((r) => setTimeout(r, 500)); dur = video.duration; tries++;
  }
  if (token !== navToken) return;

  // Fetch the full timestamped transcript. inject.js now runs three strategies
  // (DOM scrape → InnerTube get_transcript → legacy timedtext), so we don't
  // need any extension-side fallback here — just retry once for cold-start
  // races where the player element wasn't ready.
  let chunks = await askInject("get-timed-transcript");
  for (let attempt = 1; attempt <= 2 && (!chunks || !chunks.length); attempt++) {
    await new Promise((r) => setTimeout(r, 1500 * attempt));
    if (token !== navToken) return;
    chunks = await askInject("get-timed-transcript");
  }
  if (token !== navToken) return;

  if (!chunks || !chunks.length) {
    console.warn("[Sprout] gave up trying to load the transcript for this video");
  } else {
    console.log("[Sprout] transcript loaded: " + chunks.length + " chunks, first=" + Math.round(chunks[0].t) + "s");
  }

  // spread N pause points across the video (after some watching, before the end)
  let times = [];
  if (dur && isFinite(dur) && dur > 45) {
    for (let i = 1; i <= n; i++) {
      let t = Math.round(dur * (i / (n + 1)));
      t = Math.max(25, Math.min(t, Math.floor(dur) - 8));
      times.push(t);
    }
  } else {
    for (let i = 1; i <= n; i++) times.push(25 + (i - 1) * 45); // unknown/short duration
  }
  times = [...new Set(times)].sort((a, b) => a - b);

  // Kick off ALL question generations in parallel, right now, while the video plays.
  // Each promise resolves independently — one slow/failed call doesn't block the others,
  // and by the time playback reaches each pause point the question is already sitting there.
  const pending = times.map((t) => makeComprehensionQuestion(chunks, t));

  comp = { token, times, idx: 0, video, chunks, pending, handler: null };

  const handler = () => {
    if (comp.token !== navToken) { detachComprehension(); return; }
    if (gateActive) return;
    const t = comp.times[comp.idx];
    if (t == null) { detachComprehension(); return; }
    if (video.currentTime >= t) fireComprehension(video);
  };
  comp.handler = handler;
  video.addEventListener("timeupdate", handler);
}

async function fireComprehension(video) {
  if (gateActive) return;
  gateActive = true; guardVideo(video); try { video.pause(); } catch (e) {}
  const host = buildHost("\uD83C\uDF31 Quick check on what you watched");
  showLoading(host, "One sec\u2026");
  const idx = comp.idx;
  let q = null;
  try { q = await comp.pending[idx]; } catch (e) {}
  const fromVideo = !!q;
  if (!q) q = takeOpeningQuestion();               // just this one falls back
  if (!document.getElementById("sprout-gate")) return; // PIN-skipped
  const source = fromVideo
    ? (q._engine === "anthropic" ? "video-anthropic" : "video-local")
    : "fallback-video";
  await showQuestion(host, q, false, { source, video: getVideoMeta().title });
  adaptLevel(true); lastAnswerAt = Date.now();
  comp.idx++;
  closeGate(host, video);
  if (!premiumActive()) maybePremiumNudge();
}

async function makeComprehensionQuestion(chunks, untilSec) {
  const transcript = chunksText(chunks, untilSec);
  const engine = effectiveProvider("video");
  console.log("[Sprout] video question · engine=" + engine + " · aiProvider=" + settings.aiProvider + " · hasKey=" + !!settings.apiKey + " · transcript=" + transcript.length + " chars");
  if (engine === "off" || !transcript) {
    console.log("[Sprout] video question · SKIPPED (engine=" + engine + (transcript ? "" : ", no transcript") + ") — will fall back to warm-up");
    return null;
  }
  try {
    const resp = await safeSend({
      type: "GEN_QUESTION", provider: engine, age: settings.age,
      grade: numToGrade(settings.level), title: getVideoMeta().title, transcript
    });
    if (resp && resp.ok && resp.question && Array.isArray(resp.question.choices)) {
      const q = rememberQ(resp.question);
      q._engine = engine;
      return q;
    }
    console.warn("[Sprout] video question · response not usable:", resp);
  } catch (e) { console.warn("[Sprout] video question · exception:", e && e.message); }
  return null; // caller falls back
}

function chunksText(chunks, untilSec) {
  if (!chunks || !chunks.length) return "";
  return chunks.filter((c) => c.t <= untilSec).map((c) => c.text).join(" ").slice(0, 1800);
}

function detachComprehension() {
  if (comp.video && comp.handler) comp.video.removeEventListener("timeupdate", comp.handler);
  comp = { token: 0, times: [], idx: 0, video: null, chunks: [], pending: null, handler: null };
}

// ---- Gate / block host ------------------------------------------------------

function buildHost(eyebrow) {
  const host = document.createElement("div");
  host.id = "sprout-gate";
  host.innerHTML = `
    <div class="sprout-card" role="dialog" aria-modal="true" aria-label="Sprout">
      <div class="sprout-eyebrow">${eyebrow}</div>
      <div class="sprout-body"></div>
      <button class="sprout-grownup" type="button">I'm a grown-up</button>
    </div>`;
  document.documentElement.appendChild(host);
  host.querySelector(".sprout-grownup").addEventListener("click", grownupOverride);
  return host;
}
function showLoading(host, text) {
  host.querySelector(".sprout-body").innerHTML =
    `<div class="sprout-loading"><div class="sprout-spinner"></div>${escapeHtml(text)}</div>`;
}
function showBlock(message, onOverride) {
  removeGate();
  const host = buildHost("🌱 Sprout");
  host.querySelector(".sprout-body").innerHTML =
    `<h2 class="sprout-question">${escapeHtml(message)}</h2>
     <p class="sprout-topic">Ask a grown-up if you think this is a mistake.</p>`;
  host._override = onOverride;
  const v = getVideoEl();
  if (v) { gateActive = true; guardVideo(v); try { v.pause(); } catch (e) {} }
}

function showQuestion(host, q, oneShot, meta) {
  return new Promise((resolve) => {
    const body = host.querySelector(".sprout-body");
    const qWords = renderWords(q.q);
    body.innerHTML = `
      ${q.subject ? `<p class="sprout-topic">${escapeHtml(cap(q.subject))}</p>` : ""}
      <div class="sprout-q-row">
        <button class="sprout-speak sprout-speak-q" type="button" aria-label="Read the question aloud">🔊</button>
        <h2 class="sprout-question">${qWords.html}</h2>
      </div>
      <div class="sprout-choices"></div>
      <div class="sprout-feedback" aria-live="polite"></div>`;
    const qSpans = Array.from(body.querySelectorAll(".sprout-question .sprout-w"));
    const choicesEl = body.querySelector(".sprout-choices");
    const feedback = body.querySelector(".sprout-feedback");
    const choiceButtons = [];
    let locked = false, logged = false;
    const shownAt = Date.now();

    body.querySelector(".sprout-speak-q").addEventListener("click", () => speakText(q.q, qSpans, qWords.ranges));

    q.choices.forEach((choice, i) => {
      const row = document.createElement("div");
      row.className = "sprout-choice-row";
      const spk = document.createElement("button");
      spk.className = "sprout-speak sprout-speak-choice"; spk.type = "button"; spk.textContent = "🔊";
      spk.setAttribute("aria-label", "Read this answer aloud");
      spk.addEventListener("click", (e) => { e.stopPropagation(); speakText(choice, null, null); });
      const btn = document.createElement("button");
      btn.className = "sprout-choice"; btn.type = "button"; btn.textContent = choice;
      choiceButtons.push(btn);
      btn.addEventListener("click", () => {
        if (locked) return;
        const correct = i === q.answer;
        if (!logged) { logged = true; logAnswer(q, choice, correct, Date.now() - shownAt, meta); }
        if (correct) {
          locked = true; btn.classList.add("is-correct");
          feedback.textContent = pickPraise(); feedback.classList.remove("is-wrong");
          celebrate(host); stopSpeak(); setTimeout(() => resolve(true), 850);
        } else if (oneShot) {
          locked = true; btn.classList.add("is-wrong");
          if (choiceButtons[q.answer]) choiceButtons[q.answer].classList.add("is-correct");
          feedback.textContent = "Good try!"; feedback.classList.add("is-wrong");
          stopSpeak(); setTimeout(() => resolve(false), 850);
        } else {
          btn.classList.add("is-wrong"); btn.disabled = true;
          feedback.textContent = "Not quite — try again!"; feedback.classList.add("is-wrong");
        }
      });
      row.appendChild(spk); row.appendChild(btn); choicesEl.appendChild(row);
    });
    if (choiceButtons[0]) choiceButtons[0].focus();
    if (settings.readAloud) setTimeout(() => speakAll(q, qSpans, qWords.ranges), 350);
  });
}

// ---- Text to speech + word highlighting ------------------------------------

function renderWords(text) {
  const toks = String(text).split(/(\s+)/);
  let pos = 0, html = "", ranges = [];
  toks.forEach((tok) => {
    if (!tok.length) return;
    if (/\S/.test(tok)) { html += `<span class="sprout-w">${escapeHtml(tok)}</span>`; ranges.push({ start: pos, end: pos + tok.length }); }
    else html += escapeHtml(tok);
    pos += tok.length;
  });
  return { html, ranges };
}
function stopSpeak() { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {} }
function speakOne(text, spans, ranges, onDone) {
  if (!window.speechSynthesis) { onDone && onDone(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.9; u.pitch = 1.05;
  const clear = () => { if (spans) spans.forEach((s) => s.classList.remove("sprout-w-on")); };
  if (spans && ranges) {
    u.onboundary = (e) => {
      if (e.name && e.name !== "word") return;
      clear();
      const ri = ranges.findIndex((r) => e.charIndex >= r.start && e.charIndex < r.end);
      if (ri >= 0 && spans[ri]) spans[ri].classList.add("sprout-w-on");
    };
  }
  u.onend = () => { clear(); onDone && onDone(); };
  u.onerror = () => { clear(); onDone && onDone(); };
  window.speechSynthesis.speak(u);
}
function speakSequence(items) {
  stopSpeak();
  let i = 0;
  const next = () => { if (i >= items.length) return; const it = items[i++]; speakOne(it.text, it.spans, it.ranges, next); };
  next();
}
function speakText(text, spans, ranges) { speakSequence([{ text, spans, ranges }]); }
function speakAll(q, qSpans, qRanges) {
  speakSequence([{ text: q.q, spans: qSpans, ranges: qRanges }, { text: "Your choices are: " + q.choices.join(". ") + "." }]);
}

// ---- Daily learning log -----------------------------------------------------

function dayStr(d) { d = d || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function logKey(d) { return "log:" + dayStr(d); }
function logAnswer(q, chosen, correct, timeMs, meta) {
  if (!extAlive()) return;
  const entry = {
    ts: Date.now(), q: q.q, chosen, correct, answer: q.choices[q.answer],
    subject: q.subject || "", timeMs, source: (meta && meta.source) || "warmup", video: (meta && meta.video) || ""
  };
  const key = logKey();
  try {
    chrome.storage.local.get({ [key]: [] }, (r) => {
      const arr = (r[key] || []); arr.push(entry);
      safeSet({ [key]: arr.slice(-800) });
      if (document.getElementById("sprout-review")) renderReview();
    });
  } catch (e) {}
}

// ---- Onboarding: just ask age ----------------------------------------------

async function runOnboarding(video) {
  const host = buildHost("🌱 Welcome to Sprout");
  const ages = [4, 5, 6, 7, 8, 9, 10, 11, 12];
  host.querySelector(".sprout-body").innerHTML =
    `<h2 class="sprout-question">How old are you?</h2>
     <div class="sprout-choices sprout-ages">${ages.map((a) => `<button class="sprout-choice" data-age="${a}">${a}</button>`).join("")}</div>`;
  const age = await new Promise((resolve) => {
    host.querySelectorAll("[data-age]").forEach((b) =>
      b.addEventListener("click", () => resolve(parseInt(b.dataset.age, 10))));
  });
  settings.age = age; settings.level = ageToLevel(age);
  safeSet({ age, level: settings.level });
  host.querySelector(".sprout-body").innerHTML =
    `<div class="sprout-eyebrow" style="margin-bottom:14px">You're all set! 🎉</div>
     <h2 class="sprout-question">Let's learn while we watch.</h2>`;
  celebrate(host);
  setTimeout(() => closeGate(host, video), 1500);
}

// ---- Normal / mid-video gate -----------------------------------------------

async function runGate(video, remaining, untilMs) {
  const host = buildHost(untilMs ? "🌱 Quick check on what you watched" : "🌱 One question to keep watching");
  showLoading(host, aiOn() ? "Thinking about the video…" : "Getting your question…");
  for (let n = 0; n < remaining; n++) {
    const q = await (n === 0 ? prepareQuestion(handledKey + ":" + (untilMs || 0), untilMs) : buildQuestion(untilMs));
    if (!document.getElementById("sprout-gate")) return; // PIN-skipped
    await showQuestion(host, q, false);
    adaptLevel(true);
    if (n < remaining - 1) showLoading(host, "Nice! One more…");
  }
  closeGate(host, video);
}

function adaptLevel(correct) {
  const next = Math.min(5, Math.max(0, (settings.level || 0) + (correct ? 0.15 : -0.2)));
  settings.level = next; safeSet({ level: next });
}

// ---- Grown-up override ------------------------------------------------------

function grownupOverride() {
  const entered = window.prompt("Parent PIN:");
  if (entered === null) return;
  if (entered !== settings.pin) { alert("That PIN didn't match."); return; }
  const host = document.getElementById("sprout-gate");
  if (host && typeof host._override === "function") host._override();
  else closeGate(host, getVideoEl());
}
function maybePremiumNudge() {
  if (!extAlive()) return;
  if (settings.aiProvider === "premium") return;
  const today = dayStr();
  chrome.storage.local.get({ premiumNudge: "" }, (r) => {
    if (r.premiumNudge === today) return;                 // one nudge per day, max
    safeSet({ premiumNudge: today });
    const bar = document.createElement("div");
    bar.id = "sprout-nudge";
    bar.innerHTML = `<span>\u2b50 <b>Sprout Premium</b> can ask real questions about the video your child just watched.</span>
                     <span><button class="sn-x" aria-label="Dismiss">\u2715</button>
                     <button class="sn-cta">Set up</button></span>`;
    (document.body || document.documentElement).appendChild(bar);
    bar.querySelector(".sn-cta").addEventListener("click", () => {
      try { safeSet({ __openPremium: Date.now() }); chrome.runtime.openOptionsPage(); } catch(e){}
      bar.remove();
    });
    bar.querySelector(".sn-x").addEventListener("click", () => bar.remove());
    setTimeout(() => { if (bar.isConnected) bar.remove(); }, 12000);
  });
}
function closeGate(host, video) {
  stopSpeak();
  gateActive = false;
  if (host) host.remove();
  try { if (video) video.play(); } catch (e) {}
}
function removeGate() {
  gateActive = false;
  const host = document.getElementById("sprout-gate");
  if (host) host.remove();
}

// ---- Sprout frame (wraps YouTube) ------------------------------------------

function drawFrame() {
  if (location.hostname.indexOf("youtube.com") === -1) return;
  if (!settings.enabled) { removeFrame(); return; }
  let frame = document.getElementById("sprout-frame");
  if (!frame) {
    frame = document.createElement("div");
    frame.id = "sprout-frame";
    frame.innerHTML = `<div class="sprout-frame-tab"></div>`;
    (document.body || document.documentElement).appendChild(frame);
  }
  ensureReviewButton();
  const age = settings.age ? ` · age ${settings.age}` : "";
  let who, dotClass = "";
  if (inCooldown()) {
    who = "Free to switch · " + mmss(Math.ceil((OPENING_COOLDOWN_MS - (Date.now() - lastAnswerAt)) / 1000));
    dotClass = " sprout-dot-rest";
  } else {
    who = settings.childName ? `${settings.childName} is learning` : "Learning mode";
  }
  frame.querySelector(".sprout-frame-tab").innerHTML =
    `<span class="sprout-frame-dot${dotClass}"></span>🌱 Sprout · ${escapeHtml(who)}${age}`;
}
function removeFrame() {
  const f = document.getElementById("sprout-frame"); if (f) f.remove();
  const b = document.getElementById("sprout-review-btn"); if (b) b.remove();
  const p2 = document.getElementById("sprout-review"); if (p2) p2.remove();
}

// ---- Daily review sidebar ---------------------------------------------------

let reviewDate = new Date();
function ensureReviewButton() {
  if (!settings.enabled) return;
  if (document.getElementById("sprout-review-btn")) return;
  const b = document.createElement("button");
  b.id = "sprout-review-btn"; b.type = "button"; b.textContent = "📋";
  b.title = "Today's learning";
  b.addEventListener("click", toggleReview);
  (document.body || document.documentElement).appendChild(b);
}
function toggleReview() {
  const p = document.getElementById("sprout-review");
  if (p) { p.remove(); return; }
  reviewDate = new Date();
  const panel = document.createElement("div");
  panel.id = "sprout-review";
  document.documentElement.appendChild(panel);
  renderReview();
}
function renderEntry(e) {
  const secs = Math.round((e.timeMs || 0) / 1000);
  const badges = {
    "video-anthropic": " · from video 📽️ (Anthropic)",
    "video-local":     " · from video 📽️ (on-device)",
    "video":           " · from video 📽️",
    "fallback-video":  " · fallback ⚠️ (video didn't ground)",
    "warmup":          "",
    "warmup-local":    "",
    "warmup-anthropic":""
  };
  const from = badges[e.source] != null ? badges[e.source] : "";
  return `<div class="sr-item ${e.correct ? "ok" : "no"}">
    <div class="sr-q">${escapeHtml(e.q)}</div>
    <div class="sr-a">Chose: ${escapeHtml(e.chosen)} ${e.correct ? "✓" : "✗ · answer: " + escapeHtml(e.answer)}</div>
    <div class="sr-meta">${escapeHtml(cap(e.subject || ""))}${from} · ${secs}s</div>
  </div>`;
}
function renderReview() {
  const panel = document.getElementById("sprout-review");
  if (!panel || !extAlive()) return;
  const key = logKey(reviewDate);
  chrome.storage.local.get({ [key]: [] }, (r) => {
    const arr = r[key] || [];
    const correct = arr.filter((e) => e.correct).length;
    const acc = arr.length ? Math.round((correct / arr.length) * 100) : 0;
    const label = reviewDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    panel.innerHTML = `
      <div class="sr-head">
        <div class="sr-title">🌱 Learning log</div>
        <button class="sr-x" id="sr-close" aria-label="Close">✕</button>
      </div>
      <div class="sr-daynav">
        <button id="sr-prev" aria-label="Previous day">‹</button>
        <span>${escapeHtml(label)}</span>
        <button id="sr-next" aria-label="Next day">›</button>
      </div>
      <div class="sr-summary">${arr.length} answered · ${correct} correct · ${acc}%</div>
      <div class="sr-list">${arr.slice().reverse().map(renderEntry).join("") || '<p class="sr-empty">Nothing yet for this day.</p>'}</div>
      <button class="sr-export" id="sr-export">Export this day</button>`;
    panel.querySelector("#sr-close").onclick = () => panel.remove();
    panel.querySelector("#sr-prev").onclick = () => { reviewDate.setDate(reviewDate.getDate() - 1); renderReview(); };
    panel.querySelector("#sr-next").onclick = () => { reviewDate.setDate(reviewDate.getDate() + 1); renderReview(); };
    panel.querySelector("#sr-export").onclick = () => exportDay(dayStr(reviewDate), arr);
  });
}
function exportDay(day, arr) {
  try {
    const blob = new Blob([JSON.stringify({ day, entries: arr }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "sprout-" + day + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) {}
}
function mmss(sec) { const m = Math.floor(sec / 60), s = Math.max(0, sec % 60); return m + ":" + String(s).padStart(2, "0"); }
setInterval(() => { if (!extAlive()) return; if (settings.enabled && document.getElementById("sprout-frame")) drawFrame(); }, 1000);

// ---- Content hiding (Shorts entry points) ----------------------------------

function applyHiding() {
  const root = document.documentElement;
  root.classList.toggle("sprout-hide-shorts", !!(settings.enabled && settings.blockShorts));
}

// ---- Delights + utils -------------------------------------------------------

const PRAISE = ["Nice work! 🎉", "You got it! ⭐", "Brainy! 🧠", "Correct! 🌟", "Boom! 💥"];
function pickPraise() { return PRAISE[Math.floor(Math.random() * PRAISE.length)]; }
function celebrate(host) {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#ffc24b", "#4ade80", "#6d4aa8", "#fb7185", "#ffffff"];
  for (let i = 0; i < 26; i++) {
    const bit = document.createElement("div");
    bit.className = "sprout-confetti";
    bit.style.left = Math.random() * 100 + "vw";
    bit.style.background = colors[i % colors.length];
    bit.style.animationDuration = 1 + Math.random() * 0.9 + "s";
    bit.style.animationDelay = Math.random() * 0.15 + "s";
    host.appendChild(bit); setTimeout(() => bit.remove(), 2200);
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ---- Fullscreen: hide the frame so it never covers video controls ----------

document.addEventListener("fullscreenchange", () => {
  const f = document.getElementById("sprout-frame");
  if (f) f.classList.toggle("sprout-fs", !!document.fullscreenElement);
});

// ---- Nav wiring -------------------------------------------------------------

window.addEventListener("yt-navigate-finish", () => { drawFrame(); handleNav(); });
let lastPath = location.pathname + location.search;
setInterval(() => {
  if (!extAlive()) return;
  const now = location.pathname + location.search;
  if (now !== lastPath) { lastPath = now; drawFrame(); handleNav(); }
}, 800);


// Receive diagnostic logs from the offscreen document (Innertube/yt-dlp
// pipeline) so they appear in the YouTube page's DevTools console.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "SPROUT_LOG") return;
  if (msg.level === "warn") console.warn(msg.msg);
  else console.log(msg.msg);
});
