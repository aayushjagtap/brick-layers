(() => {
  // Only show on real pages (avoid Chrome internal pages)
  if (!location || !location.hostname) return;

  // DEV: show everywhere; later we’ll restrict to fantasy sites:
  // const allowedHosts = ["fantasy.espn.com", "basketball.fantasysports.yahoo.com", "sleeper.app"];
  // if (!allowedHosts.some(h => location.hostname.includes(h))) return;

  // Avoid duplicate injections on SPA navigations
  if (document.getElementById("brick-layers-badge-host")) return;

  // Create a Shadow DOM host so site CSS can’t break our styles
  const host = document.createElement("div");
  host.id = "brick-layers-badge-host";
  host.style.all = "initial"; // isolate just in case
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.bottom = "16px";
  host.style.right = "16px";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // Badge styles
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
    .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #ff6b6b; /* brick-ish */
    }
    .x {
      margin-left: 8px;
      opacity: .5; cursor: pointer; font-weight: 600;
    }
    .x:hover { opacity: .9; }
  `;

  const wrap = document.createElement("div");
  wrap.className = "badge";
  wrap.innerHTML = `<span class="dot"></span><span>Brick Layers active</span><span class="x">×</span>`;

  wrap.querySelector(".x").addEventListener("click", () => {
    host.remove();
  });

  shadow.appendChild(style);
  shadow.appendChild(wrap);
})();
