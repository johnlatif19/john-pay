import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) throw new Error('.env.local not found');
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

async function main() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson) throw new Error('FIREBASE_SERVICE_ACCOUNT missing');

  const sa = JSON.parse(saJson);
  if (typeof sa.private_key === 'string') {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }

  const app = initializeApp({
    credential: cert(sa),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
  const db = getFirestore(app);

  const settings = {
    id: 'main',
    maintenanceMode: false,
    invoiceTtlMinutes: 15,
    reviewDurationSeconds: 300,
    proofRequestAtSeconds: 150,
    timezone: 'Africa/Cairo',
    updatedAt: Date.now(),
  };

  await db.collection('systemSettings').doc('main').set(settings, { merge: true });
  console.log('✓ System settings created');
  console.log('');
  console.log(JSON.stringify(settings, null, 2));
  console.log('');

  process.exit(0);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});