// offscreen.js — runs the on-device model (Chrome's Prompt API / Gemini Nano).
// Extension documents get access to the LanguageModel global; the service worker
// drives us via messages so inference never touches the network.

const Q_SCHEMA = {
  type: "object",
  properties: {
    q: { type: "string" },
    choices: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
    answer: { type: "integer" },
    subject: { type: "string" }
  },
  required: ["q", "choices", "answer"]
};
const M_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: { atSec: { type: "integer" }, question: Q_SCHEMA },
    required: ["atSec", "question"]
  }
};

// Declaring the language improves output quality and silences the API's warning.
const LM_OPTS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }]
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "OFFSCREEN_RUN") return;
  handle(msg).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true; // async
});

async function handle(msg) {
  if (msg.kind === "status") return { ok: true, result: await status() };
  const schema = msg.kind === "moments" ? M_SCHEMA : Q_SCHEMA;
  const result = await generate(msg.prompt, schema);
  return { ok: true, result };
}

async function status() {
  if (!("LanguageModel" in self)) return { state: "unsupported" };
  try { return { state: await LanguageModel.availability() }; }
  catch (e) { return { state: "unsupported" }; }
}

async function generate(prompt, schema) {
  if (!("LanguageModel" in self)) throw new Error("on-device AI not available in this browser");
  // Only touch the model once it's actually downloaded and ready. Downloading is
  // triggered from the settings page (which has a user gesture), never from here.
  const avail = await LanguageModel.availability(LM_OPTS);
  if (avail !== "available") throw new Error("on-device model not ready (" + avail + ")");
  const session = await LanguageModel.create(LM_OPTS);
  try {
    let text;
    try { text = await session.prompt(prompt, { responseConstraint: schema }); }
    catch (e) { text = await session.prompt(prompt); } // some builds ignore schema
    return JSON.parse(String(text).replace(/```json|```/g, "").trim());
  } finally { try { session.destroy(); } catch (e) {} }
}
