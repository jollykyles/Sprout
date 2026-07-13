// inject.js — runs in the PAGE (MAIN) world on youtube.com.
// Ships three transcript-acquisition strategies (adapted from the standalone
// yt-transcript-ext extension), tried in this order:
//   1. DOM-scrape: read the "Show transcript" panel directly. Most robust.
//   2. InnerTube get_transcript: the same endpoint YouTube's own transcript
//      button calls. No proof-of-origin token needed.
//   3. Legacy timedtext (json3/XML): may return empty due to PO token gating
//      but works on older videos.
//
// Sends results back to the content script via window.postMessage.

(function () {
  window.addEventListener("message", async (event) => {
    const msg = event.data;
    if (!msg || typeof msg.__sprout !== "string") return;

    if (msg.__sprout === "get-info") {
      window.postMessage({ __sprout: "info", id: msg.id, info: getInfo() }, "*");
    } else if (msg.__sprout === "get-timed-transcript") {
      let chunks = [];
      try { chunks = await getTimedTranscript(); } catch (e) {}
      window.postMessage({ __sprout: "timed", id: msg.id, chunks }, "*");
    } else if (msg.__sprout === "get-transcript") {
      let text = "";
      try { text = await getTranscript(msg.untilMs); } catch (e) {}
      window.postMessage({ __sprout: "transcript", id: msg.id, text }, "*");
    }
  });

  // ---- basic player data --------------------------------------------------

  function playerResponse() {
    const player = document.getElementById("movie_player");
    if (player && typeof player.getPlayerResponse === "function") {
      try { return player.getPlayerResponse(); } catch (e) {}
    }
    return window.ytInitialPlayerResponse || null;
  }
  async function playerResponseReady() {
    for (let i = 0; i < 20; i++) {
      const pr = playerResponse();
      const tracks = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
        pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (pr && (tracks || (pr.videoDetails && pr.videoDetails.videoId))) return pr;
      await new Promise((r) => setTimeout(r, 250));
    }
    return playerResponse();
  }
  function getInfo() {
    const pr = playerResponse();
    const vd = (pr && pr.videoDetails) || {};
    const micro = pr && pr.microformat && pr.microformat.playerMicroformatRenderer;
    const tracks = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.captionTracks;
    return {
      isLive: !!(vd.isLive || vd.isLiveContent),
      isFamilySafe: micro ? micro.isFamilySafe !== false : true,
      hasCaptions: !!(tracks && tracks.length)
    };
  }
  function currentVideoId() {
    const pr = playerResponse();
    return (pr && pr.videoDetails && pr.videoDetails.videoId) ||
      new URLSearchParams(location.search).get("v");
  }
  function currentClientVersion() {
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const t = s.textContent || "";
      const m = t.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) ||
                t.match(/"clientVersion":"([\d.]+)"/);
      if (m) return m[1];
    }
    return "2.20260101.00.00";
  }

  // ---- helpers ------------------------------------------------------------

  function parseTimestamp(ts) {
    const parts = (ts || "").trim().split(":").map(Number);
    if (parts.some(isNaN)) return 0;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  function segsToChunks(segs) {
    // Merge into ~10s / 160-char chunks so we don't overflow Anthropic prompts.
    const chunks = [];
    let curT = null, cur = "";
    for (const s of segs) {
      const t = Math.floor(s.start || 0);
      const txt = String(s.text || "").replace(/\s+/g, " ").trim();
      if (!txt) continue;
      if (curT === null) curT = t;
      cur = cur ? cur + " " + txt : txt;
      if (t - curT >= 10 || cur.length >= 160) {
        chunks.push({ t: curT, text: cur });
        curT = null; cur = "";
      }
    }
    if (cur) chunks.push({ t: curT || 0, text: cur });
    return chunks.slice(0, 250);
  }

  // ---- METHOD 1: DOM scrape of the transcript panel -----------------------

  async function scrapePanel() {
    const parse = () => {
      const out = [];
      // Modern view-model
      document.querySelectorAll("transcript-segment-view-model").forEach((el) => {
        const ts = el.querySelector(".ytwTranscriptSegmentViewModelTimestamp")?.textContent?.trim() || "";
        const text = el.querySelector(".ytAttributedStringHost")?.textContent?.trim() || "";
        if (text) out.push({ start: parseTimestamp(ts), text });
      });
      if (out.length) return out;
      // Legacy renderer
      document.querySelectorAll("ytd-transcript-segment-renderer").forEach((el) => {
        const ts = el.querySelector(".segment-timestamp")?.textContent?.trim() || "";
        const text = el.querySelector(".segment-text, yt-formatted-string.segment-text")?.textContent?.trim() || "";
        if (text) out.push({ start: parseTimestamp(ts), text });
      });
      return out;
    };

    let segs = parse();
    if (segs.length) { console.log("[Sprout/inject] DOM scrape: panel already open, got " + segs.length + " segments"); return segs; }

    // Try clicking "Show transcript"
    const buttons = [...document.querySelectorAll("button, ytd-button-renderer button")];
    const showBtn = buttons.find((b) => {
      const label = (b.getAttribute("aria-label") || "").toLowerCase();
      const text = (b.textContent || "").trim().toLowerCase();
      return label.includes("show transcript") || text === "show transcript";
    });
    if (!showBtn) {
      // "...more" menu might hide it — try clicking the expand button first
      const moreBtn = buttons.find((b) => {
        const label = (b.getAttribute("aria-label") || "").toLowerCase();
        return label === "show more" || label.includes("more actions");
      });
      if (moreBtn) moreBtn.click();
    }
    if (showBtn) {
      console.log("[Sprout/inject] DOM scrape: clicking 'Show transcript'");
      showBtn.click();
    }

    // Poll up to ~10 seconds
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      segs = parse();
      if (segs.length) { console.log("[Sprout/inject] DOM scrape: got " + segs.length + " segments"); return segs; }
    }
    return [];
  }

  // ---- METHOD 2: InnerTube get_transcript ---------------------------------

  function encVarint(n) { const out = []; n = n >>> 0; while (n > 127) { out.push((n & 0x7f) | 0x80); n >>>= 7; } out.push(n); return out; }
  function encString(field, str) { const bytes = new TextEncoder().encode(str); return [(field << 3) | 2, ...encVarint(bytes.length), ...bytes]; }
  function encVarintField(field, val) { return [(field << 3) | 0, ...encVarint(val)]; }
  function bytesToB64(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
  function buildTranscriptParams(videoId, languageCode, isAsr) {
    const inner = [
      ...encString(1, isAsr ? "asr" : ""),
      ...encString(2, languageCode || "en"),
      ...encString(3, "")
    ];
    const outer = [
      ...encString(1, videoId),
      ...encString(2, encodeURIComponent(bytesToB64(inner))),
      ...encVarintField(3, 1),
      ...encString(5, "engagement-panel-searchable-transcript-search-panel"),
      ...encVarintField(6, 1),
      ...encVarintField(7, 1),
      ...encVarintField(8, 1)
    ];
    return bytesToB64(outer);
  }
  function buildDefaultTranscriptParams(videoId) { return bytesToB64(encString(1, videoId)); }
  function collectSegments(node, out) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) collectSegments(n, out); return; }
    const seg = node.transcriptSegmentRenderer || node.transcriptSegmentViewModel ||
      (typeof node.startMs !== "undefined" && (node.snippet || node.text) ? node : null);
    if (seg && (seg.snippet || seg.text)) {
      const snip = seg.snippet || seg.text;
      let text = "";
      if (typeof snip === "string") text = snip;
      else if (typeof snip.content === "string") text = snip.content;
      else if (snip.runs) text = snip.runs.map((x) => x.text || "").join("");
      else if (snip.simpleText) text = snip.simpleText;
      text = text.replace(/\n/g, " ").trim();
      if (text) { out.push({ start: Number(seg.startMs || 0) / 1000, text }); return; }
    }
    for (const k in node) collectSegments(node[k], out);
  }
  async function innertubeGetTranscript(videoId, track) {
    const clientVersion = currentClientVersion();
    const attempts = [
      buildTranscriptParams(videoId, (track && track.languageCode) || "en", track && track.kind === "asr"),
      buildDefaultTranscriptParams(videoId)
    ];
    for (const params of attempts) {
      try {
        const res = await fetch("https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false", {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" } },
            params
          })
        });
        if (!res.ok) continue;
        const data = await res.json();
        const out = [];
        collectSegments(data, out);
        if (out.length) { console.log("[Sprout/inject] InnerTube: got " + out.length + " segments"); return out; }
      } catch (e) { /* try next */ }
    }
    return [];
  }

  // ---- METHOD 3: legacy timedtext (empty on many 2026 videos) -------------

  async function timedtextFetch(baseUrl) {
    try {
      const res = await fetch(baseUrl + "&fmt=json3", { credentials: "omit" });
      if (res.ok) {
        const text = await res.text();
        if (text.trim()) {
          const data = JSON.parse(text);
          const out = [];
          for (const ev of data.events || []) {
            if (!ev.segs) continue;
            const line = ev.segs.map((s) => s.utf8 || "").join("").replace(/\n/g, " ").trim();
            if (line) out.push({ start: (ev.tStartMs || 0) / 1000, text: line });
          }
          if (out.length) return out;
        }
      }
    } catch (e) {}
    try {
      const res = await fetch(baseUrl, { credentials: "omit" });
      if (!res.ok) return [];
      const xml = await res.text();
      if (!xml.trim()) return [];
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      const out = [];
      doc.querySelectorAll("text").forEach((node) => {
        const text = (node.textContent || "").replace(/\n/g, " ").trim();
        if (text) out.push({ start: parseFloat(node.getAttribute("start") || "0"), text });
      });
      return out;
    } catch (e) { return []; }
  }

  // ---- Orchestration ------------------------------------------------------

  async function getTimedTranscript() {
    const videoId = currentVideoId();
    if (!videoId) return [];

    // Need player response for track selection
    const pr = await playerResponseReady();
    const tracks = (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
    const en = (t) => (t.languageCode || "").toLowerCase().startsWith("en");
    const pickedTrack = tracks.find((t) => en(t) && t.kind !== "asr") ||
                        tracks.find((t) => t.kind !== "asr") ||
                        tracks.find((t) => en(t) && t.kind === "asr") ||
                        tracks[0] || null;

    // Method 1: InnerTube get_transcript. Same source YouTube's own transcript
    // button uses — silent, no visible UI. This is the primary path.
    try {
      const segs = await innertubeGetTranscript(videoId, pickedTrack);
      if (segs.length) return segsToChunks(segs);
    } catch (e) { console.warn("[Sprout/inject] InnerTube threw:", e && e.message); }

    // Method 2: legacy timedtext (often empty on 2026 videos but cheap to try)
    if (pickedTrack && pickedTrack.baseUrl) {
      try {
        const segs = await timedtextFetch(pickedTrack.baseUrl);
        if (segs.length) return segsToChunks(segs);
      } catch (e) { console.warn("[Sprout/inject] timedtext threw:", e && e.message); }
    }

    // Method 3: DOM scrape as last resort. Opens YouTube's transcript panel,
    // which is visible to the user — a minor UX hiccup, but robust.
    try {
      const segs = await scrapePanel();
      if (segs.length) return segsToChunks(segs);
    } catch (e) { console.warn("[Sprout/inject] DOM scrape threw:", e && e.message); }

    console.warn("[Sprout/inject] all three transcript methods returned empty");
    return [];
  }

  async function getTranscript(untilMs) {
    // Text-only variant used by the older code path; now backed by the
    // same three-method pipeline.
    const chunks = await getTimedTranscript();
    if (!chunks.length) return "";
    const filtered = untilMs && untilMs > 0 ? chunks.filter((c) => c.t * 1000 <= untilMs) : chunks;
    return filtered.map((c) => c.text).join(" ").slice(0, 4000);
  }
})();
