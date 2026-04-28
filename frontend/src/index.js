import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Service Worker — cold-boot offline support + auto-update detection.
// Registered in production builds only so dev hot-reload isn't trapped behind
// a cached bundle.
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      // Detect a waiting SW (already installed by a previous tab in this profile)
      if (reg.waiting) {
        window.dispatchEvent(new CustomEvent('audinexa:sw-update-ready', { detail: reg }));
      }
      // Detect a NEW SW installing while the page is already open
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          // 'installed' + an existing controller = an update is waiting to take over
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('audinexa:sw-update-ready', { detail: reg }));
          }
        });
      });
    }).catch(() => { /* registration failure is non-fatal */ });

    // When the new SW activates, reload once so the page picks up the fresh bundle.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}
