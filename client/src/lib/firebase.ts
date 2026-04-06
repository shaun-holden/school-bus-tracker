import { initializeApp, FirebaseApp } from "firebase/app";
import { getMessaging, getToken, onMessage, Messaging } from "firebase/messaging";

// Firebase config - values come from Vite env vars (VITE_FIREBASE_*)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;

function getFirebase() {
  if (!firebaseConfig.apiKey) return null;
  if (!app) {
    app = initializeApp(firebaseConfig);
  }
  return app;
}

function getFirebaseMessaging(): Messaging | null {
  if (typeof window === "undefined") return null;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;
  const firebaseApp = getFirebase();
  if (!firebaseApp) return null;
  if (!messaging) {
    try {
      messaging = getMessaging(firebaseApp);
    } catch (err) {
      console.error("Failed to initialize Firebase messaging:", err);
      return null;
    }
  }
  return messaging;
}

export async function requestNotificationPermission(): Promise<string | null> {
  const msg = getFirebaseMessaging();
  if (!msg) {
    console.warn("Firebase messaging not available in this environment");
    return null;
  }
  if (!vapidKey) {
    console.warn("VITE_FIREBASE_VAPID_KEY not set");
    return null;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("Notification permission denied");
      return null;
    }
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );
    const token = await getToken(msg, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    return token;
  } catch (err) {
    console.error("Error getting FCM token:", err);
    return null;
  }
}

export function onForegroundMessage(
  callback: (title: string, body: string) => void
) {
  const msg = getFirebaseMessaging();
  if (!msg) return () => {};
  return onMessage(msg, (payload) => {
    const title = payload.notification?.title || "New notification";
    const body = payload.notification?.body || "";
    callback(title, body);
  });
}
