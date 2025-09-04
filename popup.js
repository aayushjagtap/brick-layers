// Show extension version (read from manifest)
const { version, name } = chrome.runtime.getManifest();
document.querySelector("#name").textContent = name;
document.querySelector("#version").textContent = version;

// Test a simple click interaction
document.querySelector("#testBtn").addEventListener("click", () => {
  // Try a lightweight Chrome API call so we know JS is working
  chrome.runtime.getPlatformInfo(info => {
    alert(`Brick Layers is running!\nOS: ${info.os}\nArch: ${info.arch}`);
  });
});
