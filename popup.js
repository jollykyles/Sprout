// popup.js — quick controls; full controls live on the options page.
const DEFAULTS = { enabled: true, age: null, gateTiming: "smart" };
const $ = (id) => document.getElementById(id);

const ageSel = $("age");
ageSel.innerHTML = `<option value="">—</option>` +
  [3,4,5,6,7,8,9,10,11,12,13,14].map((a)=>`<option value="${a}">${a}</option>`).join("");

function flashSaved(){ const e=$("saved"); e.classList.add("show"); setTimeout(()=>e.classList.remove("show"),1200); }

chrome.storage.local.get(DEFAULTS, (s) => {
  $("enabled").checked = s.enabled;
  $("age").value = s.age == null ? "" : String(s.age);
  $("gateTiming").value = s.gateTiming;
});

$("enabled").addEventListener("change", () => { chrome.storage.local.set({ enabled: $("enabled").checked }, flashSaved); });
$("gateTiming").addEventListener("change", () => { chrome.storage.local.set({ gateTiming: $("gateTiming").value }, flashSaved); });
$("age").addEventListener("change", () => {
  const age = $("age").value ? parseInt($("age").value, 10) : null;
  const patch = { age };
  if (age != null) patch.level = Math.min(5, Math.max(0, age - 5)); // realign difficulty to age
  chrome.storage.local.set(patch, flashSaved);
});
$("openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());

document.getElementById("openPremium").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  // options page picks up #premium hash on load and opens the walkthrough
  setTimeout(() => { try { chrome.runtime.getURL && chrome.storage.local.set({ __openPremium: Date.now() }); } catch (e) {} }, 100);
});
