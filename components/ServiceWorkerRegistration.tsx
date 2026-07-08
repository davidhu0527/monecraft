"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js after load in production builds. In development it does
 * the opposite — unregisters any service worker and deletes monecraft-*
 * caches. That cleanup is mandatory, not a nicety: e2e runs a prod build on
 * localhost:3000, and a service worker left registered there would serve
 * stale chunks to `bun run dev` on the same origin.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch(() => {});
      if ("caches" in window) {
        void caches
          .keys()
          .then((keys) => Promise.all(keys.filter((k) => k.startsWith("monecraft-")).map((k) => caches.delete(k))))
          .catch(() => {});
      }
      return;
    }

    // Registering twice (StrictMode double-effect) is idempotent; waiting for
    // load keeps SW installation off the game's startup path. updateViaCache
    // "none" + the no-cache header on /sw.js make updates purely server-driven.
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
        // The app is fully functional without offline support.
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
