import type { CapacitorConfig } from '@capacitor/cli';

// Default (env var unset): serve the bundled web assets from `webDir`
// (dist/public) locally via capacitor://localhost. API calls go cross-origin
// to the remote server and are handled by the Phase A CORS allowlist +
// SameSite=None; Secure cookie.
// Set PRODUCTION_SERVER_URL ONLY to resurrect the old remote-bundle behavior
// (WKWebView loads the deployed site instead of the bundle). This is the
// code-free rollback escape hatch — keep it indefinitely.
const PRODUCTION_SERVER_URL = process.env.PRODUCTION_SERVER_URL || '';

const config: CapacitorConfig = {
  appId: 'com.TopNotchTrainingCenter.SchoolBusTracker',
  appName: 'School Bus Tracker',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https',
    ...(PRODUCTION_SERVER_URL
      ? {
          url: PRODUCTION_SERVER_URL,
          cleartext: false,
        }
      : {}),
  },
  plugins: {
    // Route native fetch/XHR through the native HTTP layer so the session
    // cookie is stored/sent by the native cookie jar (URLSession), not the
    // WKWebView — which drops cross-site cookies under iOS tracking prevention.
    // This is what lets cookie auth survive now that the app is served from
    // capacitor://localhost while the API stays on schoolbustracker.org.
    CapacitorHttp: {
      enabled: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Geolocation: {
      permissions: ['location'],
    },
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: '#1e40af',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'Light',
      backgroundColor: '#1e40af',
    },
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#ffffff',
  },
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: false,
  },
};

export default config;
