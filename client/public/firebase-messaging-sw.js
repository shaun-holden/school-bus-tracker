importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging-compat.js');

self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(clients.claim()); });

const firebaseConfig = {
  apiKey: "AIzaSyAOg2uZ56TxYUinHnH7Qq_y1coUmEDwvbc",
  authDomain: "school-bus-tracker-7fb31.firebaseapp.com",
  projectId: "school-bus-tracker-7fb31",
  storageBucket: "school-bus-tracker-7fb31.firebasestorage.app",
  messagingSenderId: "712614189937",
  appId: "1:712614189937:web:62cfaff5ed1c5ebfc574d0",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification?.title || 'SchoolBus Tracker';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data,
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
