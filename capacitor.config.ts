import type { CapacitorConfig } from '@capacitor/cli';

// Set PRODUCTION_SERVER_URL to your deployed Railway URL
// e.g. https://your-app.up.railway.app
// Leave empty to use bundled web assets (requires API calls to same server)
const PRODUCTION_SERVER_URL = process.env.PRODUCTION_SERVER_URL || '';

const config: CapacitorConfig = {
  appId: 'com.schoolbustracker.app',
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
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Geolocation: {
      permissions: ['location'],
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1e40af',
      showSpinner: false,
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
