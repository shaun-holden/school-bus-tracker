import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import "./index.css";
import "leaflet/dist/leaflet.css";

// Captured at process bootstrap so the SplashProvider can enforce a minimum
// display floor (prevents a sub-300ms flash on warm starts where auth is
// cached and the dashboard mounts almost immediately).
const splashShownAt = Capacitor.isNativePlatform() ? Date.now() : null;

// Q141: a page restored from the back-forward cache (iPhone back swipe after
// Sign Out / Change Role / View As) reloads fresh instead of coming back frozen.
if (!Capacitor.isNativePlatform()) {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(<App splashShownAt={splashShownAt} />);
