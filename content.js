// content.js
(() => {
  // Don’t run in iframes
  if (window.top !== window) return;
  if (!location || !location.hostname) return;

  // DEV: confirm injection
  console.log("[Brick Layers] injected on:", location.href);

  // Fantasy domains where we show the badge/UI (script still injects everywhere for now)
  const allowedHosts = new Set([
    "fantasy.espn.com",
    "espn.com",
    "www.espn.com",
    "basketball.fantasysports.yahoo.com",
    "sports.yahoo.com",
    "yahoo.com",
    "sleeper.app",
    "www.sleeper.app"
  ]);

  const isFantasyHost = [...allowedHosts].some(h => location.hostname.endsWith(h));
  if (!isFantasyHost) return;

  // Ask background for (stub) normalized data — verifies messaging path.
  chrome.runtime.sendMessage({ type: "GET_NORMALIZED_DATA" }, (resp) => {
    if (!resp) {
      console.warn("[Brick Layers] no response from background (check service worker)");
      return;
    }
    if (!resp.ok) {
      console.warn("[Brick Layers] background error:", resp.error);
      return;
    }
    console.debug("[Brick Layers] background data:", resp.data);
  });

  // Avoid duplicate badge injection
  const HOST_ID = "brick-layers-host";
  if (document.getElementById(HOST_ID)) return;

  // Host element with Shadow DOM to isolate styles
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.bottom = "16px";
  host.style.right = "16px";
  host.style.width = "auto";
  host.style.height = "auto";
  host.style.pointerEvents = "none"; // allow clicks to pass unless on our badge
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // Styles for the small badge
  const style = document.createElement("style");
  style.textContent = `
    .badge {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(17, 24, 39, 0.92);
      color: #fff;
      padding: 8px 10px;
      border-radius: 999px;
      box-shadow: 0 6px 18px rgba(0,0,0,.25);
      font: 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      user-select: none;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e; /* green */
      box-shadow: 0 0 0 3px rgba(34,197,94,.25);
      display: inline-block;
    }
    .x {
      display: inline-block;
      font-weight: 700;
      margin-left: 2px;
      opacity: .8;
      cursor: pointer;
    }
    .x:hover { opacity: 1; }
    .btn {
      margin-left: 6px;
      padding: 4px 8px;
      border-radius: 8px;
      background: #111827;
      border: 1px solid rgba(255,255,255,.15);
      color: #fff;
      cursor: pointer;
      font-size: 12px;
    }
    .btn:hover { background: #0b1220; }
  `;

  // Badge UI
  const wrap = document.createElement("div");
  wrap.className = "badge";
  wrap.innerHTML = `
    <span class="dot"></span>
    <span>Brick Layers active on ${location.hostname}</span>
    <span class="btn" id="ping">Ping</span>
    <span class="x" title="Hide">×</span>
  `;

  // Close button
  wrap.querySelector(".x").addEventListener("click", () => {
    host.remove();
    console.log("[Brick Layers] badge removed by user");
  });

  // Ping button (tests roundtrip messaging)
  wrap.querySelector("#ping").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "PING" }, (resp) => {
      if (resp?.ok) {
        console.log("[Brick Layers] PONG from background:", new Date(resp.ts).toLocaleString());
      } else {
        console.warn("[Brick Layers] Ping failed:", resp?.error);
      }
    });
  });

  shadow.appendChild(style);
  shadow.appendChild(wrap);

  console.log("[Brick Layers] badge injected on:", location.hostname);
})();
