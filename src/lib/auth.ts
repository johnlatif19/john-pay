import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { db, auth, COLLECTIONS } from './firebase';
import type { ApiKey, Device, AdminRecord } from './types';

export interface AuthContext {
  actorId: string;
  actorType: 'admin' | 'api_key' | 'device';
  permissions: string[];
}

export interface AuthResult {
  ok: boolean;
  context?: AuthContext;
  error?: string;
  status?: number;
}

export function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateApiKeySecret(): { raw: string; prefix: string; hash: string } {
  const random = randomBytes(32).toString('hex');
  const raw = `jp_live_${random}`;
  const prefix = raw.slice(0, 16);
  const hash = hashSha256(raw);
  return { raw, prefix, hash };
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function verifyAdminFromCookie(cookieHeader: string | null): Promise<AuthResult> {
  if (!cookieHeader) {
    return { ok: false, error: 'missing_session', status: 401 };
  }

  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [key, ...rest] = c.trim().split('=');
      return [key, rest.join('=')];
    })
  );

  const sessionCookie = cookies['johnpay_session'];
  if (!sessionCookie) {
    return { ok: false, error: 'missing_session', status: 401 };
  }

  try {
    const decoded = await auth.verifySessionCookie(sessionCookie, true);
    const adminDoc = await db.collection(COLLECTIONS.admins).doc(decoded.uid).get();

    if (!adminDoc.exists) {
      return { ok: false, error: 'not_admin', status: 403 };
    }

    const customClaims = decoded as unknown as { admin?: boolean };

    if (customClaims.admin !== true) {
      return { ok: false, error: 'not_admin', status: 403 };
    }

    return {
      ok: true,
      context: {
        actorId: decoded.uid,
        actorType: 'admin',
        permissions: ['*'],
      },
    };
  } catch {
    return { ok: false, error: 'invalid_session', status: 401 };
  }
}

export async function verifyApiKey(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, error: 'missing_api_key', status: 401 };
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey.startsWith('jp_live_')) {
    return { ok: false, error: 'invalid_api_key_format', status: 401 };
  }

  const hash = hashSha256(rawKey);
  const snapshot = await db
    .collection(COLLECTIONS.apiKeys)
    .where('keyHash', '==', hash)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (snapshot.empty) {
    return { ok: false, error: 'invalid_api_key', status: 401 };
  }

  const keyDoc = snapshot.docs[0];
  const apiKey = keyDoc.data() as ApiKey;

  await keyDoc.ref.update({ lastUsedAt: Date.now() });

  return {
    ok: true,
    context: {
      actorId: apiKey.id,
      actorType: 'api_key',
      permissions: apiKey.permissions,
    },
  };
}

export function hasPermission(context: AuthContext, permission: string): boolean {
  if (context.permissions.includes('*')) return true;
  return context.permissions.includes(permission);
}

export async function verifyDevice(request: Request): Promise<AuthResult> {
  const deviceId = request.headers.get('x-device-id');
  const deviceSecret = request.headers.get('x-device-secret');

  if (!deviceId || !deviceSecret) {
    return { ok: false, error: 'missing_device_credentials', status: 401 };
  }

  const deviceDoc = await db.collection(COLLECTIONS.devices).doc(deviceId).get();
  if (!deviceDoc.exists) {
    return { ok: false, error: 'device_not_found', status: 401 };
  }

  const device = deviceDoc.data() as Device;

  if (device.status !== 'active') {
    return { ok: false, error: 'device_revoked', status: 403 };
  }

  const secretDoc = await db
    .collection(COLLECTIONS.devices)
    .doc(deviceId)
    .collection('credentials')
    .doc('main')
    .get();

  if (!secretDoc.exists) {
    return { ok: false, error: 'device_credentials_missing', status: 401 };
  }

  const storedHash = secretDoc.data()?.secretHash as string | undefined;
  if (!storedHash) {
    return { ok: false, error: 'device_credentials_missing', status: 401 };
  }

  const providedHash = hashSha256(deviceSecret);
  if (!safeCompare(storedHash, providedHash)) {
    return { ok: false, error: 'invalid_device_secret', status: 401 };
  }

  return {
    ok: true,
    context: {
      actorId: deviceId,
      actorType: 'device',
      permissions: ['transactions:verify'],
    },
  };
}

export async function verifyCronSecret(request: Request): Promise<AuthResult> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return { ok: false, error: 'cron_secret_not_configured', status: 500 };
  }

  const authHeader = request.headers.get('authorization');
  const provided = authHeader?.replace('Bearer ', '').trim() || '';

  if (!safeCompare(expected, provided)) {
    return { ok: false, error: 'invalid_cron_secret', status: 401 };
  }

  return {
    ok: true,
    context: {
      actorId: 'cron',
      actorType: 'admin',
      permissions: ['*'],
    },
  };
}

export async function requireApiAuth(
  request: Request,
  permission?: string
): Promise<AuthResult> {
  const result = await verifyApiKey(request);

  if (!result.ok || !result.context) return result;

  if (permission && !hasPermission(result.context, permission)) {
    return { ok: false, error: 'insufficient_permissions', status: 403 };
  }

  return result;
}