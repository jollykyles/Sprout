// background.js — service worker.
// Question engine with three tiers, chosen by settings.aiProvider:
//   "local"     -> Chrome's on-device model (Gemini Nano) via the offscreen doc (default AI)
//   "anthropic" -> hosted API (advanced; sends transcript off-device)
//   "off"       -> content.js just uses the built-in bank (no message reaches here)

const MODEL = "claude-haiku-4-5-20251001"; // only used for the "anthropic" tier

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "GEN_QUESTION") {
    generateQuestion(msg).then((question) => sendResponse({ ok: true, question }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "GEN_MOMENTS") {
    generateMoments(msg).then((moments) => sendResponse({ ok: true, moments }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "AI_STATUS") {
    aiStatus().then((state) => sendResponse({ ok: true, state }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

// ---- On-device (offscreen) plumbing ----------------------------------------
// Just the Nano LLM offscreen doc. Transcripts are handled entirely by the
// content script's inject.js pipeline (DOM scrape + InnerTube get_transcript).

let creating = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Run the on-device language model for warm-up questions."
    }).finally(() => { creating = null; });
  }
  await creating;
}
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("on-device timed out")), ms))
  ]);
}
async function runLocal(kind, prompt) {
  await ensureOffscreen();
  const resp = await withTimeout(chrome.runtime.sendMessage({ type: "OFFSCREEN_RUN", kind, prompt }), 30000);
  if (!resp || !resp.ok) throw new Error((resp && resp.error) || "on-device generation failed");
  return resp.result;
}
async function aiStatus() {
  await ensureOffscreen();
  const resp = await chrome.runtime.sendMessage({ type: "OFFSCREEN_RUN", kind: "status" });
  return (resp && resp.ok && resp.result && resp.result.state) || "unsupported";
}

// ---- Hosted (Anthropic) plumbing -------------------------------------------

async function callAnthropic(system, user, maxTokens) {
  const { apiKey } = await chrome.storage.local.get({ apiKey: "" });
  if (!apiKey) throw new Error("No API key set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] })
  });
  if (!res.ok) {
    let bodyText = "";
    try { bodyText = await res.text(); } catch (e) {}
    console.warn("[Sprout] Anthropic HTTP " + res.status, bodyText.slice(0, 300));
    throw new Error("API " + res.status);
  }
  const data = await res.json();
  console.log("[Sprout] Anthropic OK", { input_tokens: data.usage && data.usage.input_tokens, output_tokens: data.usage && data.usage.output_tokens });
  return (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}
const stripJson = (t) => JSON.parse(String(t).replace(/```json|```/g, "").trim());

// ---- Prompt builders (shared by both engines) ------------------------------

function fmtTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return m + ":" + String(s).padStart(2, "0"); }

function generalPrompt({ age, grade, subject }) {
  const who = age ? `${age}-year-old child` : (grade === "K" ? "kindergartner" : `grade ${grade} child`);
  const subj = subject || "general knowledge";
  const flavor = subj === "puzzle"
    ? "a fun, simple logic puzzle or riddle"
    : `a ${subj} question`;
  const system =
    "You write ONE short, fresh multiple-choice learning question for a " + who + ". " +
    "It should be " + flavor + ", NOT about any video. Match difficulty to that age " +
    "(e.g. most 6-year-olds can add but not multiply). Vary it so it isn't a common repeat. " +
    "Exactly 3 choices, one correct. " +
    'Return ONLY JSON: {"q":"...","choices":["...","...","..."],"answer":0,"subject":"' + subj + '"} ' +
    "(answer = 0-based index).";
  const user = "Write the " + (subj === "puzzle" ? "puzzle" : subj + " question") + " as JSON only.";
  return { system, user };
}

function questionPrompt({ age, grade, title, description, transcript }, local) {
  const who = age ? `${age}-year-old child` : (grade === "K" ? "kindergartner" : `grade ${grade} child`);
  const hasT = transcript && transcript.trim().length > 120;
  const clip = (transcript || "").slice(0, local ? 900 : 1800);
  const topic = [title, description].filter(Boolean).join(" — ").slice(0, 300);
  const system = hasT
    ? "You write ONE short multiple-choice question about a video a " + who + " just watched, " +
      "based ONLY on the transcript below. STRICT RULES: " +
      "1) The correct answer's key words MUST appear in the transcript. " +
      "2) Do NOT invent details (characters, colors, actions, places) that are not in the transcript. " +
      "3) If the transcript does not contain enough factual detail to ground a good question, " +
      'return exactly {"insufficient": true} and nothing else. ' +
      "4) Otherwise return ONLY JSON: " +
      '{"q":"...","choices":["...","...","..."],"answer":0,"subject":"science","evidence":"<the phrase from the transcript that proves the answer>"}. ' +
      "Match difficulty to the age. Exactly 3 choices, one correct."
    : "You write ONE short multiple-choice learning question suitable for a " + who + ". " +
      "Match difficulty to age. Connect to the video topic. Exactly 3 choices, one correct. " +
      'Return ONLY JSON: {"q":"...","choices":["...","...","..."],"answer":0,"subject":"science"}.';
  const user = hasT
    ? `Transcript:\n"""${clip}"""\n\nRespond as JSON only.`
    : `Video topic: "${topic || "a kids video"}".\nRespond as JSON only.`;
  return { system, user };
}

function momentsPrompt({ age, grade, title, chunks, max }, local) {
  const who = age ? `${age}-year-old child` : (grade === "K" ? "kindergartner" : `grade ${grade} child`);
  const k = Math.max(1, Math.min(3, max || 1));
  let lines = (chunks || []).map((c) => `[${fmtTime(c.t)}] ${c.text}`);
  const BUDGET = local ? 1400 : 3600;
  while (lines.join("\n").length > BUDGET && lines.length > 10) lines = lines.filter((_, i) => i % 2 === 0);
  const transcript = lines.join("\n").slice(0, BUDGET);
  const system =
    "You get a timestamped transcript of a video a child is watching. " +
    `Pick up to ${k} moment(s) right AFTER the video clearly explains something — a natural place ` +
    `to pause and check understanding. For each, write ONE multiple-choice question about what was ` +
    `explained BEFORE that timestamp, for a ${who}. Exactly 3 choices, one correct. Skip the first ~15s. ` +
    'Return ONLY a JSON array: [{"atSec":<int seconds>,"question":{"q":"...","choices":["..","..",".."],"answer":0,"subject":"science"}}]. ' +
    "If nothing is teachable, return [].";
  const user = `Transcript:\n${transcript}\n\nReturn the JSON array now.`;
  return { system, user };
}

// ---- Generators -------------------------------------------------------------

function textHas(hay, needle) {
  if (!hay || !needle) return false;
  const norm = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const H = norm(hay), N = norm(needle);
  if (!N) return false;
  if (H.includes(N)) return true;
  // fall back to word-overlap: >=60% of the answer's content words appear in the transcript
  const stop = new Set(["a","an","the","of","and","or","to","in","on","for","is","are","was","were","it","this","that","with","by"]);
  const words = N.split(" ").filter((w) => w && !stop.has(w));
  if (!words.length) return false;
  const hit = words.filter((w) => H.includes(w)).length;
  return hit / words.length >= 0.6;
}
function groundedInTranscript(q, transcript) {
  if (!transcript) return true; // no transcript given -> validator not applicable
  const correct = q.choices[q.answer];
  if (!textHas(transcript, correct)) return false;
  // if the model provided evidence, require it too
  if (q.evidence && !textHas(transcript, q.evidence)) return false;
  return true;
}
function validQuestion(p) {
  return p && typeof p.q === "string" && Array.isArray(p.choices) && p.choices.length >= 2 &&
    typeof p.answer === "number" && p.answer >= 0 && p.answer < p.choices.length;
}

async function generateQuestion(msg) {
  const local = msg.provider !== "anthropic";
  const tag = "[Sprout] " + (msg.mode === "general" ? "warm-up" : "video") + " · " + (local ? "on-device" : "Anthropic");
  console.log(tag + " · start", { provider: msg.provider, subject: msg.subject || null, hasTranscript: !!msg.transcript, transcriptLen: (msg.transcript || "").length });
  const { system, user } = msg.mode === "general" ? generalPrompt(msg) : questionPrompt(msg, local);
  let parsed;
  try {
    parsed = local ? await runLocal("question", system + "\n\n" + user)
                   : stripJson(await callAnthropic(system, user, 320));
  } catch (e) {
    console.warn(tag + " · call failed:", e && e.message);
    throw e;
  }
  if (parsed && parsed.insufficient) { console.log(tag + " · model said insufficient — falling back"); throw new Error("Insufficient transcript"); }
  if (!validQuestion(parsed)) { console.warn(tag + " · malformed JSON", parsed); throw new Error("Malformed question"); }
  // Grounding check: ONLY for local (Nano hallucinates). Anthropic is trusted.
  if (local && msg.mode !== "general" && msg.transcript && !groundedInTranscript(parsed, msg.transcript)) {
    console.warn(tag + " · rejected: answer not in transcript", { answer: parsed.choices[parsed.answer] });
    throw new Error("Not grounded in transcript");
  }
  console.log(tag + " · success:", parsed.q);
  return parsed;
}

async function generateMoments(msg) {
  const local = msg.provider !== "anthropic";
  if (!Array.isArray(msg.chunks) || !msg.chunks.length) return [];
  const { system, user } = momentsPrompt(msg, local);
  const arr = local ? await runLocal("moments", system + "\n\n" + user)
                    : stripJson(await callAnthropic(system, user, 700));
  if (!Array.isArray(arr)) return [];
  return arr.filter((m) => m && typeof m.atSec === "number" && validQuestion(m.question));
}
