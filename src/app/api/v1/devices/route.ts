import { NextRequest } from 'next/server';
import { db, COLLECTIONS } from '@/lib/firebase';
import { hashSha256, verifyDevice, verifyAdminFromCookie } from '@/lib/auth';
import { registerDeviceSchema, heartbeatSchema, verifyTransactionSchema } from '@/lib/types';
import { errorResponse, successResponse, now, generateDeviceId } from '@/lib/utils';
import { verifyTransaction } from '@/lib/verification';
import { randomBytes } from 'crypto';
import type { Device } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'register') return handleRegister(request);
  if (action === 'heartbeat') return handleHeartbeat(request);
  if (action === 'revoke') return handleRevoke(request);
  if (action === 'transaction') return handleTransaction(request);
  if (action === 'invoices') return handleInvoices(request);
  if (action === 'confirm_invoice') return handleConfirmInvoice(request);

  return errorResponse('invalid_action', 400);
}

export async function GET(request: NextRequest): Promise<Response> {
  const cookieHeader = request.headers.get('cookie');
  const authResult = await verifyAdminFromCookie(cookieHeader);

  if (!authResult.ok) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'config') return handleConfig(request);

  const snapshot = await db.collection(COLLECTIONS.devices).orderBy('createdAt', 'desc').limit(50).get();
  const items = snapshot.docs.map((d) => {
    const device = d.data() as Device;
    return {
      ...device,
      lastHeartbeatAt: device.lastHeartbeatAt || null,
      isOnline: device.lastHeartbeatAt ? now() - device.lastHeartbeatAt < 120000 : false,
    };
  });

  return successResponse({ items });
}

async function handleRegister(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('invalid_body', 400);

  const parsed = registerDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 400, parsed.error.issues[0]?.message);
  }

  const existingSnapshot = await db
    .collection(COLLECTIONS.devices)
    .where('deviceId', '==', parsed.data.deviceId)
    .limit(1)
    .get();

  if (!existingSnapshot.empty) {
    return errorResponse('device_already_registered', 409);
  }

  const id = generateDeviceId();
  const secret = `dvc_${randomBytes(32).toString('hex')}`;
  const ts = now();

  const device: Device = {
    id,
    deviceName: parsed.data.deviceName,
    deviceId: parsed.data.deviceId,
    paymentMethods: parsed.data.paymentMethods,
    status: 'active',
    registeredAt: ts,
    lastHeartbeatAt: ts,
    createdAt: ts,
    updatedAt: ts,
  };

  await db.runTransaction(async (tx) => {
    tx.set(db.collection(COLLECTIONS.devices).doc(id), device);
    tx.set(db.collection(COLLECTIONS.devices).doc(id).collection('credentials').doc('main'), {
      secretHash: hashSha256(secret),
      createdAt: ts,
    });
  });

  return successResponse({
    device_id: id,
    device_secret: secret,
    status: 'active',
  }, 201);
}

async function handleHeartbeat(request: NextRequest): Promise<Response> {
  const authResult = await verifyDevice(request);
  if (!authResult.ok || !authResult.context) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  await db.collection(COLLECTIONS.devices).doc(authResult.context.actorId).update({
    lastHeartbeatAt: now(),
    updatedAt: now(),
  });

  return successResponse({ ok: true, serverNow: now() });
}

async function handleRevoke(request: NextRequest): Promise<Response> {
  const cookieHeader = request.headers.get('cookie');
  const authResult = await verifyAdminFromCookie(cookieHeader);

  if (!authResult.ok) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  const body = await request.json().catch(() => null);
  const deviceId = body && typeof (body as Record<string, unknown>).deviceId === 'string'
    ? ((body as Record<string, unknown>).deviceId as string)
    : '';

  if (!deviceId) return errorResponse('missing_device_id', 400);

  const deviceRef = db.collection(COLLECTIONS.devices).doc(deviceId);
  const device = await deviceRef.get();
  if (!device.exists) return errorResponse('device_not_found', 404);

  await deviceRef.update({ status: 'revoked', revokedAt: now(), updatedAt: now() });

  return successResponse({ ok: true });
}

async function handleConfig(request: NextRequest): Promise<Response> {
  const authResult = await verifyDevice(request);
  if (!authResult.ok || !authResult.context) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  const deviceDoc = await db.collection(COLLECTIONS.devices).doc(authResult.context.actorId).get();
  if (!deviceDoc.exists) return errorResponse('device_not_found', 404);

  const device = deviceDoc.data() as Device;
  const methodsSnapshot = await db.collection(COLLECTIONS.paymentMethods).get();
  const methods = methodsSnapshot.docs.map((d) => d.data());

  return successResponse({ device, paymentMethods: methods });
}

async function handleTransaction(request: NextRequest): Promise<Response> {
  const authResult = await verifyDevice(request);
  if (!authResult.ok || !authResult.context) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('invalid_body', 400);

  const parsed = verifyTransactionSchema.safeParse(body);
  if (!parsed.success) {
    console.error("ZOD VALIDATION ERROR (Device Transaction):", parsed.error);
    return errorResponse('validation_failed', 400, parsed.error.issues[0]?.message);
  }

  try {
    const result = await verifyTransaction(parsed.data, authResult.context.actorId);
    return successResponse({
      transaction_id: result.transaction.id,
      status: result.result.status,
      reason: result.result.reason,
      invoice_status: result.invoice?.status,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'verify_failed';
    return errorResponse(msg, 400);
  }
}

async function handleInvoices(request: NextRequest): Promise<Response> {
  const authResult = await verifyDevice(request);
  if (!authResult.ok || !authResult.context) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  try {
    const snapshot = await db.collection(COLLECTIONS.invoices)
      .where('status', 'in', ['pending', 'manual_review'])
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const items = snapshot.docs.map((d) => d.data());
    return successResponse({ items });
  } catch (error) {
    console.error("Fetch invoices error:", error);
    return errorResponse('fetch_failed', 500);
  }
}

async function handleConfirmInvoice(request: NextRequest): Promise<Response> {
  const authResult = await verifyDevice(request);
  if (!authResult.ok || !authResult.context) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  const body = await request.json().catch(() => null);
  const invoiceId = body && typeof (body as Record<string, unknown>).invoiceId === 'string'
    ? ((body as Record<string, unknown>).invoiceId as string)
    : '';

  if (!invoiceId) return errorResponse('missing_invoice_id', 400);

  try {
    const ts = now();
    await db.collection(COLLECTIONS.invoices).doc(invoiceId).update({
      status: 'paid',
      paidAt: ts,
      updatedAt: ts,
    });

    return successResponse({ ok: true, status: 'paid' });
  } catch (error) {
    console.error("Confirm invoice error:", error);
    return errorResponse('confirm_failed', 500);
  }
}
