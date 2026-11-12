import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local not found');
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

async function main() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) throw new Error('FIREBASE_SERVICE_ACCOUNT missing');

  const serviceAccount = JSON.parse(serviceAccountJson);
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  const app = initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  const auth = getAuth(app);
  const db = getFirestore(app);

  const email = process.env.ADMIN_EMAIL || 'admin@johnpay.local';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  console.log('');
  console.log('=== JOHN PAY — Seed Admin ===');
  console.log('');
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log('');

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    console.log('✓ Admin user already exists in Firebase Auth');
    console.log(`  UID: ${userRecord.uid}`);

    await auth.updateUser(userRecord.uid, { password });
    console.log('✓ Password updated');
  } catch (err: any) {
    if (err.code === 'auth/user-not-found') {
      userRecord = await auth.createUser({ email, password, emailVerified: true });
      console.log('✓ Admin user created in Firebase Auth');
      console.log(`  UID: ${userRecord.uid}`);
    } else {
      throw err;
    }
  }

  await auth.setCustomUserClaims(userRecord.uid, { admin: true });
  console.log('✓ Custom claim "admin: true" set');

  const adminRef = db.collection('admins').doc(userRecord.uid);
  await adminRef.set(
    {
      id: userRecord.uid,
      email,
      createdAt: Date.now(),
    },
    { merge: true }
  );
  console.log('✓ Admin document created in Firestore /admins');

  console.log('');
  console.log('=== Done ===');
  console.log('');
  console.log('Now you can login at /login with the credentials above.');
  console.log('');

  process.exit(0);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});