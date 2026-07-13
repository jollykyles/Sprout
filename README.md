# 🌱 Sprout — Learn to Watch (v1.1)

A Chrome/Edge extension that wraps **YouTube** in a Sprout "learning mode" frame, keeps kids on
age-appropriate content, and pauses videos with a quick question — including questions about
what they just watched.

## What's new in v1.1 — Python + yt-dlp inside the extension
YouTube's 2026 captions rollout returns empty responses to plain browser fetches for many
videos. To get around this without a backend, Sprout now bundles **Pyodide** (Python running
as WebAssembly inside the extension) and installs **yt-dlp** on first premium use. Everything
still runs entirely on your device.
- **First-time install** takes ~30 seconds. In Settings → Question engine → Premium, click
  "Install / warm up" once. After that, transcript fetches are automatic.
- **The extension is ~13 MB now** because it bundles the Python runtime. That's the tradeoff
  for having no server.
- **Two-stage fetch:** the extension first tries the browser's direct fetch (fast, works on
  most videos). If that returns empty, it falls back to yt-dlp inside Pyodide, which does the
  signed-request dance that YouTube requires.
- **No CDN calls** — Pyodide loads from files bundled in the extension. Only yt-dlp itself
  is fetched from PyPI on first install.

## What's new in v1.0 — the premium split
Video comprehension is now a proper premium feature. Everything else stays free and local.

- **Two clear tiers.** *Free/local* runs on-device: warm-ups, read-aloud, log, content
  filters, adaptive level — all private, no key, no cost. *Premium* adds real questions about
  the video your child just watched, using Anthropic's Claude Haiku.
- **Guided setup.** Settings → Question engine → pick "Premium ⭐" → click **Set up premium**
  and a 5-step walkthrough handles account, credit, key. Sprout live-tests the key before
  activating.
- **Discovery, not nagging.** After a fallback question on the free tier, a small dismissable
  bar mentions premium — at most once a day.
- **Guardrails still apply.** Even on premium, transcript-grounding validation stays on, so
  bird-and-nest hallucinations can't reach a kid.

## What's new in v0.10 (the "why did it say the nest was yellow" release)
- **Hallucination guardrails.** When a question is supposed to be about the video, the model
  now has strict rules: base it ONLY on the transcript, don't invent details, and if the
  transcript isn't rich enough, return `{"insufficient": true}` and Sprout falls back. On top
  of that, the extension itself checks that the correct answer's words actually appear in the
  transcript — anything that doesn't is thrown out. No more birds-and-nests scenes conjured
  from nothing.
- **Hybrid engine (recommended).** A new "Hybrid" question engine keeps warm-ups fully local
  (private, free, fast) but sends the transcript to Anthropic for the video-comprehension
  question, which is the one Nano can't do reliably. Only the transcript, only when a video
  question is being written; nothing else leaves your device.
- **Log tells you which engine wrote each question.** Entries now show "from video 📽️
  (Anthropic)" or "from video 📽️ (on-device)" or "fallback ⚠️ (video didn't ground)" so you
  can see exactly what happened.

## What's new in v0.9
- **Full transcript downloaded at startup.** As soon as a video loads, Sprout waits for the
  player, fetches the whole timestamped transcript (retrying once if it lost the race), and
  now handles **manual → auto-generated → auto-translated** caption tracks, so Mark Rober,
  no-caption channels, and non-English videos all work.
- **All mid-video questions generated in parallel while the video plays.** Instead of the old
  "generate one at a time, at the last moment" pipeline (which is why so many came back as
  fallbacks), Sprout now kicks off every question generation right at video start. By the time
  playback reaches a pause point, the question is already sitting there. One slow/failed call
  no longer poisons the others — only that one falls back.
- **Log tells you which was which.** The learning log now labels each entry: *"from video 📽️"*
  when it truly used the transcript, *"fallback (video) ⚠️"* when that one call failed. That
  gives you a visible read on how the on-device model is doing on real videos.

## What's new in v0.8
- **Read aloud + word highlighting.** Every question has a 🔊 button (and one on each answer);
  it reads the text and highlights each word as it's spoken — great for pre-readers. Turn on
  "Read questions aloud automatically" in settings to have it read on its own. All local (browser
  speech), no data leaves.
- **Daily learning log.** A 📋 button (bottom-right) opens a sidebar of every question answered:
  what was asked, what the child chose, right/wrong, and time spent — with day-by-day navigation,
  a daily summary, and **Export this day** to save a JSON file for tracking progress over time.
- **Crash fixed.** The "Extension context invalidated" error after reloading the extension is
  gone — all extension calls now fail quietly on stale tabs.
- **On-device warning fixed.** The model now declares its language (improves quality too).
- **Puzzles surface more** (now in the K–5 bank as well as the AI warm-up rotation).

## What's new in v0.7
- **Mid-video checks actually fire now.** The old design asked the small on-device model to
  scan the whole transcript and invent "moments" in one shot — the thing it's worst at, so it
  usually produced nothing. Now Sprout **picks the pause points in code** (spread across the
  video) and only asks the model the easy part: one question about what's been watched so far.
  Reliable, and it fires the number you set.
- **Respects "questions per video."** Set 3 and you get 3 spread-out checks (plus the warm-up).
- **True no-repeat.** Bank questions now rotate — every question is asked once before ANY
  repeats, and the rotation is saved across sessions so kids can't memorize a short loop.
- **Cooldown is visible.** The Sprout frame shows a "Free to switch · m:ss" countdown so you can
  see the grace window.
- Hang-proof: on-device calls now time out and fall back instead of stalling.

## What's new in v0.6
- **No more waiting.** Opening questions are instant now — Sprout keeps a small buffer of
  pre-generated questions topped up in the background and pulls from it (or the bank), so kids
  never stare at a spinner. The slow transcript work happens quietly while the video plays.
- **Right question, right time.** New default "Smart" flow: a quick **warm-up** question at the
  start (math / reading / science / geography / history / **puzzle** — not about the video), then
  a **comprehension check that fires only after the video has taught the answer**, so kids apply
  what they just learned instead of guessing at load.
- **Grace for switching.** After a kid answers, there's a 2-minute cooldown — they can hop
  between videos without being re-quizzed each time. The mid-video check only happens if they
  actually stick around and watch to the teaching moment.
- Bigger bank (110+) with anti-repeat, and the on-device model is only touched once it's ready.

## What's new in v0.5
- **On-device AI — no API key, nothing leaves the browser.** New "Question engine" setting with
  three tiers: **Built-in bank** (no AI), **On-device AI** (Chrome's built-in Gemini Nano, runs
  locally — no key, no network), and **Anthropic API** (advanced, higher quality, but sends the
  transcript off-device). Default is the bank; switch to On-device in Settings → Question engine.
- On first use of On-device, click **Download** in settings (one-time ~4 GB, handled by Chrome).
  Requires Chrome on a laptop/desktop with a capable GPU; on unsupported devices Sprout silently
  uses the built-in bank so it always works.

## What's new in v0.4
- **Smart moment detection.** Set **When to ask → "At the right moment"** (with video questions
  on). Sprout pulls the timestamped transcript, the model scans it for where the video just
  *taught* something, and pre-writes a question for that spot. As the child watches, it pauses
  exactly there and quizzes on what was explained — your Mark Rober rocket case, automatically.
  Because the question is generated during the intro, the pause is instant. Falls back to a
  timed gate if a video has no captions or nothing clearly teachable.

## What's new in v0.3
- **Age, not grade.** Onboarding just asks the child's age (one tap). Difficulty is set from
  age — a 6-year-old won't get multiplication. The parent can set/change age in settings.
- **Sprout frame around YouTube.** A branded border wraps the whole page with a "🌱 Sprout ·
  Learning mode · [name], age N" tab, so it feels like YouTube lives *inside* Sprout. It hides
  automatically in fullscreen so it never covers video controls.
- **Parent settings page.** Click the toolbar icon → "Open full settings" for a full control
  panel (age, name, timing, PIN, content rules, AI).
- **Content rules.** Toggle off **Shorts**, **live streams**, and **videos not marked
  family-safe**. Blocked items show a friendly stop screen with a parent-PIN override.
- **Quiz on what they watched.** With "After 1–3 min" timing + AI on, Sprout reads the
  transcript **up to the current moment** and asks about it — your Mark Rober rocket example.

## Load / update
1. `chrome://extensions` → Developer mode on → **Load unpacked** → this `sprout` folder.
   (Updating from an earlier version? Just hit the refresh ↻ on the card.)
2. Pin 🌱. First YouTube video asks the child's age, then you're running.

## Try the headline feature
Settings → turn on **Make questions from what they watched**, paste an Anthropic key, set
**When to ask → After 1 min**. Play something explanatory with captions (Mark Rober, a
"Science for Kids" channel). After a minute it pauses and asks about what was just explained.

## Honest notes on the new bits
- **"Family-safe" is YouTube's own flag**, not a true "made for kids" rating — it's the best
  lever an extension gets, so treat it as a coarse filter. It fails *open* (won't block if it
  can't read the flag) to avoid false blocks.
- **Smart moments are model-picked, so they're only as good as the captions + model.** It skips
  the first ~15s, spaces multiple checks out, and won't ask about anything past the pause point.
  Auto-generated captions can be messy, which can make a question feel slightly off — worth
  eyeballing a few before trusting it unattended.
- **Transcript needs captions.** No captions → it falls back to a topic question.
- **On-device AI is Chrome-desktop only and heavier than "lightweight"** — ~4 GB model, needs a
  GPU with ~4 GB VRAM and lots of free disk, not on phones/tablets. And Gemini Nano is small, so
  it's weaker than a hosted model — fine for simple questions, rougher on smart moment-detection
  over a long transcript. The bank is the always-works floor.
- Still **desktop YouTube only**, and **store publishing has a review step**.

## Files
| File | Job |
|------|-----|
| `manifest.json` | MV3 config, options page, MAIN + isolated content scripts |
| `content.js` | Frame, age onboarding, content rules, gating, mid-video quiz |
| `inject.js` | Page-world reader: captions/transcript + live/family-safe flags |
| `gate.css` | Frame, gate, block screen, celebration, Shorts-hiding |
| `questions.js` | Built-in K–5 fallback bank |
| `background.js` | Question engine: routes to on-device / hosted / bank |
| `offscreen.*` | Runs Chrome's on-device model (Gemini Nano) locally |
| `popup.*` | Quick controls (on/off, age, timing) |
| `options.*` | Full parent settings (content rules, PIN, AI) |

## Next candidates
- Model picks the pause moment from the transcript (true "he just explained it" detection).
- Per-subject difficulty. Streak/coin progress. Real parent dashboard → accounts + payments.
