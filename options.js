// options.js — full parent settings, auto-saved. Handles the question engine
// (built-in bank / on-device AI / hosted API) and on-device model setup.

const DEFAULTS = {
  enabled: true, age: null, childName: "", questionsPerVideo: 1, pin: "1234",
  aiProvider: "off", apiKey: "", gateTiming: "smart",
  blockShorts: false, blockLive: false, blockNonKid: false, readAloud: false
};
const $ = (id) => document.getElementById(id);

$("age").innerHTML = `<option value="">—</option>` +
  [3,4,5,6,7,8,9,10,11,12,13,14].map((a)=>`<option value="${a}">${a}</option>`).join("");

const checks = ["enabled","blockShorts","blockLive","blockNonKid","readAloud"];
const selects = ["age","questionsPerVideo","gateTiming","aiProvider"];
const texts = ["childName","pin","apiKey"];

function reflectProvider() {
  const p = $("aiProvider").value;
  document.body.classList.toggle("prov-local", p === "local");
  document.body.classList.toggle("prov-premium", p === "premium");
  if (p === "local" || p === "premium") refreshLocalStatus();
  refreshPremiumStatus();
}
function refreshPremiumStatus() {
  const el = $("premiumStatus"); if (!el) return;
  const active = ($("aiProvider").value === "premium") && !!(($("apiKey").value || "").trim());
  el.textContent = active ? "active ✓" : "not set up";
  el.classList.toggle("on", active); el.classList.toggle("off", !active);
}
let t;
function flashSaved(){ const e=$("saved"); e.classList.add("show"); clearTimeout(t); t=setTimeout(()=>e.classList.remove("show"),1200); }

function save() {
  return new Promise((resolve) => {
  const age = $("age").value ? parseInt($("age").value,10) : null;
  const patch = {
    enabled: $("enabled").checked,
    age, childName: $("childName").value.trim(),
    questionsPerVideo: parseInt($("questionsPerVideo").value,10),
    pin: $("pin").value.trim() || "1234",
    aiProvider: $("aiProvider").value, apiKey: $("apiKey").value.trim(),
    gateTiming: $("gateTiming").value,
    blockShorts: $("blockShorts").checked, blockLive: $("blockLive").checked, blockNonKid: $("blockNonKid").checked,
    readAloud: $("readAloud").checked
  };
  if (age != null) patch.level = Math.min(5, Math.max(0, age - 5));
  chrome.storage.local.set(patch, () => { flashSaved(); resolve(); });
  });
}

chrome.storage.local.get(DEFAULTS, (s) => {
  $("enabled").checked = s.enabled;
  $("age").value = s.age == null ? "" : String(s.age);
  $("childName").value = s.childName || "";
  $("questionsPerVideo").value = String(s.questionsPerVideo);
  $("gateTiming").value = s.gateTiming;
  $("pin").value = s.pin;
  $("aiProvider").value = s.aiProvider;
  $("apiKey").value = s.apiKey;
  $("blockShorts").checked = s.blockShorts;
  $("blockLive").checked = s.blockLive;
  $("blockNonKid").checked = s.blockNonKid;
  $("readAloud").checked = s.readAloud;
  reflectProvider();
});

[...checks, ...selects].forEach((id) => $(id).addEventListener("change", () => { if(id==="aiProvider") reflectProvider(); save(); }));
texts.forEach((id) => $(id).addEventListener("input", save));

const LM_OPTS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }]
};

// ---- On-device model status + setup ----------------------------------------

async function refreshLocalStatus() {
  const el = $("localStatus"), btn = $("localSetup");
  if (!("LanguageModel" in window)) {
    el.textContent = "not available in this browser (needs Chrome desktop)";
    btn.style.display = "none";
    return;
  }
  let a = "unavailable";
  try { a = await LanguageModel.availability(LM_OPTS); } catch (e) { a = "unavailable"; }
  if (a === "available") { el.textContent = "ready \u2713"; btn.style.display = "none"; return; }
  if (a === "downloading") { el.textContent = "downloading\u2026"; btn.textContent = "Re-check"; btn.style.display = ""; return; }
  if (a === "downloadable") { el.textContent = "needs a one-time ~4 GB download"; btn.textContent = "Download model"; btn.style.display = ""; return; }
  // unavailable: could be space/hardware — let them retry now that space was freed
  el.textContent = "not ready — free disk space, then retry";
  btn.textContent = "Set up / retry";
  btn.style.display = "";
}

$("localSetup").addEventListener("click", async () => {
  const el = $("localStatus"), btn = $("localSetup");
  if (!("LanguageModel" in window)) return;
  btn.disabled = true; el.textContent = "checking\u2026";
  try {
    const s = await LanguageModel.create({
      ...LM_OPTS,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          const pct = Math.round(((e && e.loaded) || 0) * 100);
          el.textContent = "downloading " + (isFinite(pct) ? pct : 0) + "%\u2026";
        });
      }
    });
    try { s.destroy(); } catch (e) {}
    el.textContent = "ready \u2713"; btn.style.display = "none";
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    el.textContent = "couldn't set up (" + msg + ") — the bank will be used";
    // keep the button so they can try again
  } finally { btn.disabled = false; }
});


// ---- Premium walkthrough ----------------------------------------------------

function showStep(n) {
  document.querySelectorAll(".pm-step").forEach((el) => { el.hidden = (parseInt(el.dataset.step, 10) !== n); });
}
function openPremiumModal() {
  $("premiumModal").hidden = false;
  const cur = ($("apiKey").value || "").trim();
  $("pmKeyInput").value = cur;
  showStep(cur ? 5 : 1);
  $("pmTest").textContent = ""; $("pmTest").classList.remove("ok","err");
}
function closePremiumModal() { $("premiumModal").hidden = true; }
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!t) return;
  if (t.id === "premiumSetup") openPremiumModal();
  else if (t.id === "pmClose" || t.id === "pmDone") closePremiumModal();
  else if (t.dataset && t.dataset.goto) showStep(parseInt(t.dataset.goto, 10));
});

async function testApiKey(key) {
  // Minimal, cheap round-trip: 1-token completion. Anthropic will return an auth error fast
  // if the key is bad, and a valid response if it's good.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }]
    })
  });
  if (res.status === 401 || res.status === 403) throw new Error("That key was rejected. Double-check you copied it right.");
  if (res.status === 429) throw new Error("Rate limited — try again in a minute (the key looks fine).");
  if (res.status === 402) throw new Error("Your account has no credit yet. Add $5 in Anthropic Billing, then retry.");
  if (!res.ok) throw new Error("Anthropic responded with status " + res.status + ". Try again.");
}

document.addEventListener("click", async (e) => {
  if (!e.target || e.target.id !== "pmActivate") return;
  const key = ($("pmKeyInput").value || "").trim();
  const test = $("pmTest");
  test.classList.remove("ok","err");
  if (!key.startsWith("sk-ant-")) { test.textContent = "That doesn't look like an Anthropic key (should start with sk-ant-)."; test.classList.add("err"); return; }
  test.textContent = "Testing your key…";
  try {
    await testApiKey(key);
    // save + switch provider to premium
    $("apiKey").value = key;
    $("aiProvider").value = "premium";
    await save();
    reflectProvider();
    // Confirm the write actually landed in storage before we celebrate
    const verify = await new Promise((r) => chrome.storage.local.get({ apiKey: "", aiProvider: "off" }, r));
    if (verify.apiKey !== key || verify.aiProvider !== "premium") {
      test.textContent = "Saved locally but couldn't confirm storage — try refreshing YouTube.";
      test.classList.add("err");
      return;
    }
    console.log("[Sprout] premium activated. aiProvider=" + verify.aiProvider + " keyPresent=true");
    test.textContent = "Success! Premium is set up.";
    test.classList.add("ok");
    setTimeout(() => showStep(6), 500);
  } catch (err) {
    test.textContent = (err && err.message) ? err.message : "Something went wrong.";
    test.classList.add("err");
  }
});

chrome.storage.local.get({ __openPremium: 0 }, (r) => {
  if (r.__openPremium && Date.now() - r.__openPremium < 15000) {
    chrome.storage.local.remove("__openPremium");
    setTimeout(() => document.getElementById("premiumSetup") && document.getElementById("premiumSetup").click(), 200);
  }
});