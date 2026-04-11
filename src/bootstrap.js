/* =========================================================
   src/bootstrap.js
   Runtime Config Loader
   
   This script must run BEFORE any modules import from
   src/config/firebase.js. It fetches runtime config from
   the server and sets up window.DISASTER_ALERT_CONFIG
   and window.DISASTER_ALERT_CONFIG_READY for modules.
   
   Usage in HTML:
   <script src="src/bootstrap.js"></script>
   <script type="module" src="src/index.js"></script>
   ========================================================= */

window.DISASTER_ALERT_CONFIG_READY = (async function initializeRuntimeConfig() {
  try {
    // Fetch runtime config from the public API endpoint
    const response = await fetch("/api/runtime-config", {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(
        `[bootstrap] Failed to fetch runtime config: ${response.status} - ${errData.error || response.statusText}`
      );
    }

    const data = await response.json();

    if (!data.success || !data.config) {
      throw new Error("[bootstrap] Invalid runtime config response structure");
    }

    // Validate required fields
    const requiredFields = [
      "apiKey",
      "authDomain",
      "databaseURL",
      "projectId",
      "storageBucket",
      "messagingSenderId",
      "appId",
      "vapidKey"
    ];

    for (const field of requiredFields) {
      if (!data.config[field]) {
        throw new Error(`[bootstrap] Missing required config field: ${field}`);
      }
    }

    // Set global config object
    window.DISASTER_ALERT_CONFIG = data.config;
    console.info("[bootstrap] Runtime config loaded successfully");
    return data.config;
  } catch (err) {
    console.error("[bootstrap] Fatal error:", err.message);

    // Show user-visible error
    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0;
      background: #dc2626; color: white;
      padding: 16px; text-align: center;
      font-family: monospace; z-index: 99999;
      border-bottom: 2px solid #991b1b;
    `;
    errorDiv.textContent = `⚠ Configuration initialization failed: ${err.message}. Please refresh the page.`;
    document.body.insertBefore(errorDiv, document.body.firstChild);
    throw err;
  }
})();
