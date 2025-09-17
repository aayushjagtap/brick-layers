// content.js
(() => {
  // Don’t run in iframes
  if (window.top !== window) return;

  if (!location || !location.hostname) return;

  // DEV LOG: confirm injection
  console.log("[Brick Layers] injected on:", location.href);

  // Only show badge on fantasy domains (but keep script injected everywhere)
  const allowedHosts = [
    "fantasy.espn.com",
    "espn.com",
    "www.espn.com",
    "basketball.fantasysports.yahoo.com",
    "sports.yahoo.com", // some pages load from here too
    "sleeper.app",
    "sleeper.com",
    "www.sleeper.com"
  ];
  const hostOk = allowedHosts.some(h => location.hostname.includes(h));
  if (!hostOk) {
    // Stay quiet on non-target sites
    return;
  }

  // Avoid duplicate injections on SPA navigations
  if (document.getElementById("brick-layers-badge-host")) return;

  // Badge host in shadow to avoid CSS conflicts
  const host = document.createElement("div");
  host.id = "brick-layers-badge-host";
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.bottom = "16px";
  host.style.right = "16px";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    .badge {
      font: 12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: #ffffff;
      border: 1px solid #e5e5e5;
      border-radius: 999px;
      padding: 6px 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,.12);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      user-select: none;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #ff6b6b; }
    .x { margin-left: 8px; opacity: .5; cursor: pointer; font-weight: 600; }
    .x:hover { opacity: .9; }
  `;

  const wrap = document.createElement("div");
  wrap.className = "badge";
  wrap.innerHTML = `
    <span class="dot"></span>
    <span>Brick Layers active on ${location.hostname}</span>
    <span class="x">×</span>
  `;

  wrap.querySelector(".x").addEventListener("click", () => host.remove());
  shadow.appendChild(style);
  shadow.appendChild(wrap);

  console.log("[Brick Layers] badge injected on:", location.hostname);
})();
