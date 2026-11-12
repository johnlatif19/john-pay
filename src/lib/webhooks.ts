import { createHmac, randomBytes } from 'crypto';
import { db, COLLECTIONS } from './firebase';
import { now, generateEventId, writeAuditLog } from './utils';
import type {
  Invoice,
  WebhookConfig,
  WebhookDelivery,
  WebhookEvent,
} from './types';

const MAX_ATTEMPTS = 5;

export function signWebhookPayload(
  secret: string,
  timestamp: number,
  eventId: string,
  body: string
): string {
  const signatureBase = `${timestamp}.${eventId}.${body}`;
  return createHmac('sha256', secret).update(signatureBase).digest('hex');
}

export async function getWebhookConfig(): Promise<WebhookConfig | null> {
  const doc = await db.collection(COLLECTIONS.webhooks).doc('main').get();
  if (!doc.exists) return null;
  return doc.data() as WebhookConfig;
}

export async function dispatchWebhook(
  event: WebhookEvent,
  invoice: Invoice,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const config = await getWebhookConfig();

  if (!config || !config.enabled || !config.url) {
    return;
  }

  if (!config.events.includes(event)) {
    return;
  }

  const eventId = generateEventId();
  const ts = now();

  const payload = {
    event,
    event_id: eventId,
    invoice_id: invoice.id,
    order_id: invoice.orderId,
    amount: invoice.amount,
    currency: invoice.currency,
    payment_method: invoice.paymentMethod,
    status: event.replace('payment.', ''),
    paid_at: invoice.paidAt ? new Date(invoice.paidAt).toISOString() : null,
    created_at: new Date(ts).toISOString(),
    ...extra,
  };

  const delivery: WebhookDelivery = {
    id: eventId,
    eventId,
    event,
    invoiceId: invoice.id,
    payload,
    url: config.url,
    status: 'pending',
    attempts: 0,
    createdAt: ts,
    updatedAt: ts,
  };

  await db.collection(COLLECTIONS.webhookDeliveries).doc(delivery.id).set(delivery);

  await attemptDelivery(delivery.id);
}

async function attemptDelivery(deliveryId: string): Promise<void> {
  const docRef = db.collection(COLLECTIONS.webhookDeliveries).doc(deliveryId);
  const doc = await docRef.get();

  if (!doc.exists) return;

  const delivery = doc.data() as WebhookDelivery;
  const config = await getWebhookConfig();

  if (!config || !config.enabled) {
    await docRef.update({ status: 'failed', error: 'webhook_disabled', updatedAt: now() });
    return;
  }

  const body = JSON.stringify(delivery.payload);
  const ts = now();
  const signature = signWebhookPayload(config.secret, ts, delivery.eventId, body);

  const attempts = delivery.attempts + 1;

  try {
    const response = await fetch(delivery.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-JohnPay-Signature': signature,
        'X-JohnPay-Timestamp': String(ts),
        'X-JohnPay-Event-ID': delivery.eventId,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });

    const responseText = await response.text().catch(() => '');

    if (response.ok) {
      await docRef.update({
        status: 'success',
        attempts,
        responseStatus: response.status,
        responseBody: responseText.slice(0, 500),
        updatedAt: now(),
      });
      return;
    }

    const shouldRetry = attempts < MAX_ATTEMPTS;
    const nextRetryAt = shouldRetry ? now() + computeBackoff(attempts) : undefined;

    await docRef.update({
      status: shouldRetry ? 'pending' : 'failed',
      attempts,
      responseStatus: response.status,
      responseBody: responseText.slice(0, 500),
      error: `http_${response.status}`,
      nextRetryAt,
      updatedAt: now(),
    });
  } catch (error) {
    const shouldRetry = attempts < MAX_ATTEMPTS;
    const nextRetryAt = shouldRetry ? now() + computeBackoff(attempts) : undefined;

    await docRef.update({
      status: shouldRetry ? 'pending' : 'failed',
      attempts,
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown_error',
      nextRetryAt,
      updatedAt: now(),
    });
  }
}

function computeBackoff(attempt: number): number {
  const seconds = Math.min(60 * Math.pow(2, attempt - 1), 3600);
  return seconds * 1000;
}

export async function retryPendingDeliveries(): Promise<number> {
  const ts = now();
  const snapshot = await db
    .collection(COLLECTIONS.webhookDeliveries)
    .where('status', '==', 'pending')
    .where('nextRetryAt', '<=', ts)
    .limit(20)
    .get();

  let count = 0;
  for (const doc of snapshot.docs) {
    await attemptDelivery(doc.id);
    count += 1;
  }

  return count;
}

export async function retryDeliveryManually(deliveryId: string): Promise<boolean> {
  const docRef = db.collection(COLLECTIONS.webhookDeliveries).doc(deliveryId);
  const doc = await docRef.get();
  if (!doc.exists) return false;

  await docRef.update({ attempts: 0, status: 'pending', nextRetryAt: undefined, updatedAt: now() });
  await attemptDelivery(deliveryId);
  return true;
}

export async function sendTestWebhook(url: string, secret: string): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  const eventId = generateEventId();
  const ts = now();
  const payload = {
    event: 'payment.paid',
    event_id: eventId,
    invoice_id: 'inv_test_' + randomBytes(4).toString('hex'),
    order_id: 'order_test',
    amount: 1,
    currency: 'EGP',
    payment_method: 'vodafone_cash',
    status: 'paid',
    paid_at: new Date(ts).toISOString(),
    test: true,
  };

  const body = JSON.stringify(payload);
  const signature = signWebhookPayload(secret, ts, eventId, body);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-JohnPay-Signature': signature,
        'X-JohnPay-Timestamp': String(ts),
        'X-JohnPay-Event-ID': eventId,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });

    await writeAuditLog({
      actorId: 'admin',
      actorType: 'admin',
      action: 'webhook.test',
      resource: 'webhook',
      metadata: { url, status: response.status },
    });

    return { ok: response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}