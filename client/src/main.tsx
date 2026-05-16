import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import "./index.css";
import "leaflet/dist/leaflet.css";

// Captured at process bootstrap so the SplashProvider can enforce a minimum
// display floor (prevents a sub-300ms flash on warm starts where auth is
// cached and the dashboard mounts almost immediately).
const splashShownAt = Capacitor.isNativePlatform() ? Date.now() : null;

createRoot(document.getElementById("root")!).render(<App splashShownAt={splashShownAt} />);
