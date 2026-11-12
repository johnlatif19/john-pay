import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

let app: App;
let db: Firestore;
let auth: Auth;
let initialized = false;

function getFirebaseApp(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  }

  let serviceAccount: Record<string, unknown>;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }

  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  return initializeApp({
    credential: cert(serviceAccount as Parameters<typeof cert>[0]),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

function initializeFirebase(): void {
  if (initialized) return;

  app = getFirebaseApp();
  db = getFirestore(app);
  auth = getAuth(app);

  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // already initialized in this process
  }

  initialized = true;
}

initializeFirebase();

export { app, db, auth };

export const COLLECTIONS = {
  invoices: 'invoices',
  transactions: 'transactions',
  paymentMethods: 'paymentMethods',
  devices: 'devices',
  apiKeys: 'apiKeys',
  webhooks: 'webhooks',
  webhookDeliveries: 'webhookDeliveries',
  paymentProofs: 'paymentProofs',
  admins: 'admins',
  auditLogs: 'auditLogs',
  systemSettings: 'systemSettings',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];