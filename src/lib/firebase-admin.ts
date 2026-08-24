import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Constructed lazily, same reason as getFgaClient() in fga.ts: initializeApp
// validates its config eagerly, which would throw during `next build`'s
// page-data collection (or on cold start) for routes that don't even use
// Firebase, whenever env vars aren't set yet.
let _app: App | undefined;
function adminApp(): App {
  if (!_app) {
    const existing = getApps();
    _app = existing.length
      ? existing[0]
      : initializeApp({
          credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID!,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
            // Service account JSON escapes newlines as literal \n; env vars
            // don't survive that round-trip unless we unescape them back.
            privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
          }),
        });
  }
  return _app;
}

export function firestore() {
  return getFirestore(adminApp());
}

export function firebaseAuth() {
  return getAuth(adminApp());
}
