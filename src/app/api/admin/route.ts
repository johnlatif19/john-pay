import { NextRequest } from 'next/server';
import { db, COLLECTIONS } from '@/lib/firebase';
import { verifyAdminFromCookie, generateApiKeySecret, generateWebhookSecret, hashSha256 } from '@/lib/auth';
import { sendTestWebhook, retryDeliveryManually } from '@/lib/webhooks';
import { updatePaymentMethodSchema, createApiKeySchema, updateWebhookSchema } from '@/lib/types';
import { errorResponse, successResponse, now, generateId, getClientIp, getUserAgent } from '@/lib/utils';
import type { ApiKey, PaymentMethodConfig, WebhookConfig, SystemSettings } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest) {
  const cookieHeader = request.headers.get('cookie');
  const result = await verifyAdminFromCookie(cookieHeader);
  if (!result.ok) throw new Error(result.error || 'unauthorized');
  return result.context!;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await requireAdmin(request);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'unauthorized', 401);
  }

  const url = new URL(request.url);
  const resource = url.searchParams.get('resource');

  if (resource === 'stats') {
    const [invoicesSnap, txSnap] = await Promise.all([
      db.collection(COLLECTIONS.invoices).limit(500).get(),
      db.collection(COLLECTIONS.transactions).limit(500).get(),
    ]);

    const invoices = invoicesSnap.docs.map((d) => d.data() as { status: string; amount: number; paidAt?: number });
    const transactions = txSnap.docs.map((d) => d.data() as { status: string });

    const totalInvoices = invoices.length;
    const paid = invoices.filter((i) => i.status === 'paid');
    const pending = invoices.filter((i) => i.status === 'pending');
    const failed = invoices.filter((i) => i.status === 'failed' || i.status === 'expired');
    const manual = invoices.filter((i) => i.status === 'manual_review');

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayPaid = paid.filter((i) => (i.paidAt || 0) >= startOfToday.getTime());

    const totalRevenue = paid.reduce((sum, i) => sum + (i.amount || 0), 0);
    const todayRevenue = todayPaid.reduce((sum, i) => sum + (i.amount || 0), 0);

    return successResponse({
      totalInvoices,
      successful: paid.length,
      pending: pending.length,
      failed: failed.length,
      manualReview: manual.length,
      totalRevenue,
      todayRevenue,
      totalTransactions: transactions.length,
    });
  }

  if (resource === 'payment-methods') {
    const snapshot = await db.collection(COLLECTIONS.paymentMethods).get();
    const items = snapshot.docs.map((d) => d.data() as PaymentMethodConfig);
    return successResponse({ items });
  }

  if (resource === 'api-keys') {
    const snapshot = await db.collection(COLLECTIONS.apiKeys).orderBy('createdAt', 'desc').get();
    const items = snapshot.docs.map((d) => {
      const key = d.data() as ApiKey;
      return {
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        permissions: key.permissions,
        status: key.status,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
      };
    });
    return successResponse({ items });
  }

  if (resource === 'webhook') {
    const doc = await db.collection(COLLECTIONS.webhooks).doc('main').get();
    if (!doc.exists) return successResponse({ webhook: null });
    const webhook = doc.data() as WebhookConfig;
    return successResponse({
      webhook: {
        ...webhook,
        secret: `${webhook.secret.slice(0, 10)}***${webhook.secret.slice(-4)}`,
      },
    });
  }

  if (resource === 'webhook-deliveries') {
    const snapshot = await db
      .collection(COLLECTIONS.webhookDeliveries)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return successResponse({ items: snapshot.docs.map((d) => d.data()) });
  }

  if (resource === 'settings') {
    const doc = await db.collection(COLLECTIONS.systemSettings).doc('main').get();
    if (!doc.exists) return successResponse({ settings: null });
    return successResponse({ settings: doc.data() as SystemSettings });
  }

  if (resource === 'audit-logs') {
    const snapshot = await db
      .collection(COLLECTIONS.auditLogs)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    return successResponse({ items: snapshot.docs.map((d) => d.data()) });
  }

  return errorResponse('invalid_resource', 400);
}

export async function POST(request: NextRequest): Promise<Response> {
  let adminId = '';
  try {
    const ctx = await requireAdmin(request);
    adminId = ctx.actorId;
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'unauthorized', 401);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'save-payment-method') return handleSavePaymentMethod(request);
  if (action === 'create-api-key') return handleCreateApiKey(request, adminId);
  if (action === 'revoke-api-key') return handleRevokeApiKey(request);
  if (action === 'save-webhook') return handleSaveWebhook(request);
  if (action === 'test-webhook') return handleTestWebhook(request);
  if (action === 'retry-delivery') return handleRetryDelivery(request);
  if (action === 'save-settings') return handleSaveSettings(request);

  return errorResponse('invalid_action', 400);
}

async function handleSavePaymentMethod(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return errorResponse('invalid_body', 400);

  const methodId = (body as Record<string, unknown>).id;
  if (methodId !== 'vodafone_cash' && methodId !== 'orange_cash') {
    return errorResponse('invalid_method', 400);
  }

  const parsed = updatePaymentMethodSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 400, parsed.error.issues[0]?.message);
  }

  const config: PaymentMethodConfig = {
    id: methodId,
    ...parsed.data,
    updatedAt: now(),
  };

  await db.collection(COLLECTIONS.paymentMethods).doc(methodId).set(config, { merge: true });

  return successResponse({ method: config });
}

async function handleCreateApiKey(request: NextRequest, adminId: string): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('invalid_body', 400);

  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 400, parsed.error.issues[0]?.message);
  }

  const { raw, prefix, hash } = generateApiKeySecret();
  const ts = now();
  const id = generateId('key');

  const apiKey: ApiKey = {
    id,
    name: parsed.data.name,
    keyPrefix: prefix,
    keyHash: hash,
    permissions: parsed.data.permissions,
    status: 'active',
    createdAt: ts,
  };

  await db.collection(COLLECTIONS.apiKeys).doc(id).set(apiKey);

  return successResponse({
    id,
    name: apiKey.name,
    keyPrefix: prefix,
    secret: raw,
    warning: 'store_this_secret_now_it_will_not_be_shown_again',
  }, 201);
}

async function handleRevokeApiKey(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  const id = body && typeof (body as Record<string, unknown>).id === 'string'
    ? ((body as Record<string, unknown>).id as string)
    : '';
  if (!id) return errorResponse('missing_id', 400);

  await db.collection(COLLECTIONS.apiKeys).doc(id).update({
    status: 'revoked',
    revokedAt: now(),
  });

  return successResponse({ ok: true });
}

async function handleSaveWebhook(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('invalid_body', 400);

  const parsed = updateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 400, parsed.error.issues[0]?.message);
  }

  const docRef = db.collection(COLLECTIONS.webhooks).doc('main');
  const existing = await docRef.get();
  const existingSecret = existing.exists ? (existing.data() as WebhookConfig).secret : null;

  const secret = existingSecret || generateWebhookSecret();

  const config: WebhookConfig = {
    id: 'main',
    url: parsed.data.url,
    secret,
    enabled: parsed.data.enabled,
    events: parsed.data.events,
    updatedAt: now(),
  };

  await docRef.set(config, { merge: true });

  return successResponse({
    webhook: {
      ...config,
      secret: existingSecret ? `${secret.slice(0, 10)}***` : secret,
    },
    secret_shown: !existingSecret,
  });
}

async function handleTestWebhook(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('invalid_body', 400);

  const url = (body as Record<string, unknown>).url;
  const secret = (body as Record<string, unknown>).secret;

  if (typeof url !== 'string' || typeof secret !== 'string') {
    return errorResponse('missing_url_or_secret', 400);
  }

  const result = await sendTestWebhook(url, secret);
  return successResponse(result);
}

async function handleRetryDelivery(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  const id = body && typeof (body as Record<string, unknown>).id === 'string'
    ? ((body as Record<string, unknown>).id as string)
    : '';
  if (!id) return errorResponse('missing_id', 400);

  const ok = await retryDeliveryManually(id);
  if (!ok) return errorResponse('delivery_not_found', 404);

  return successResponse({ ok: true });
}

async function handleSaveSettings(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return errorResponse('invalid_body', 400);

  const maintenanceMode = (body as Record<string, unknown>).maintenanceMode;
  const invoiceTtlMinutes = (body as Record<string, unknown>).invoiceTtlMinutes;
  const reviewDurationSeconds = (body as Record<string, unknown>).reviewDurationSeconds;
  const proofRequestAtSeconds = (body as Record<string, unknown>).proofRequestAtSeconds;

  const settings: SystemSettings = {
    id: 'main',
    maintenanceMode: maintenanceMode === true,
    invoiceTtlMinutes: typeof invoiceTtlMinutes === 'number' ? invoiceTtlMinutes : 15,
    reviewDurationSeconds: typeof reviewDurationSeconds === 'number' ? reviewDurationSeconds : 300,
    proofRequestAtSeconds: typeof proofRequestAtSeconds === 'number' ? proofRequestAtSeconds : 150,
    timezone: 'Africa/Cairo',
    updatedAt: now(),
  };

  await db.collection(COLLECTIONS.systemSettings).doc('main').set(settings, { merge: true });

  return successResponse({ settings });
}