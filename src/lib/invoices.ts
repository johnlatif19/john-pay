import { db, COLLECTIONS } from './firebase';
import { generateInvoiceId, now, inMinutes, buildCheckoutUrl, writeAuditLog } from './utils';
import type { Invoice, CreateInvoiceInput, PaymentMethod, InvoiceStatus } from './types';

const DEFAULT_TTL_MINUTES = parseInt(process.env.INVOICE_TTL_MINUTES || '15', 10);
const DEFAULT_REVIEW_SECONDS = parseInt(process.env.REVIEW_DURATION_SECONDS || '300', 10);
const DEFAULT_PROOF_AT_SECONDS = parseInt(process.env.PROOF_REQUEST_AT_SECONDS || '150', 10);

export async function getPaymentMethodConfig(method: PaymentMethod) {
  const doc = await db.collection(COLLECTIONS.paymentMethods).doc(method).get();
  if (!doc.exists) return null;
  return doc.data() as {
    id: PaymentMethod;
    enabled: boolean;
    displayName: string;
    receivingNumber: string;
    instructions: string;
    updatedAt: number;
  };
}

export async function createInvoice(
  input: CreateInvoiceInput,
  createdBy: string
): Promise<Invoice> {
  const methodConfig = await getPaymentMethodConfig(input.paymentMethod);

  if (!methodConfig) {
    throw new Error('payment_method_not_configured');
  }

  if (!methodConfig.enabled) {
    throw new Error('payment_method_disabled');
  }

  const settingsDoc = await db.collection(COLLECTIONS.systemSettings).doc('main').get();
  const settings = settingsDoc.exists ? settingsDoc.data() : null;

  const ttlMinutes = settings?.invoiceTtlMinutes ?? DEFAULT_TTL_MINUTES;
  const reviewSeconds = settings?.reviewDurationSeconds ?? DEFAULT_REVIEW_SECONDS;
  const proofAtSeconds = settings?.proofRequestAtSeconds ?? DEFAULT_PROOF_AT_SECONDS;

  if (settings?.maintenanceMode === true) {
    throw new Error('maintenance_mode');
  }

  const id = generateInvoiceId();
  const ts = now();

  const invoice: Invoice = {
    id,
    orderId: input.orderId,
    description: input.description,
    amount: input.amount,
    currency: 'EGP',
    paymentMethod: input.paymentMethod,
    status: 'awaiting_payment',
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    metadata: input.metadata,
    checkoutUrl: buildCheckoutUrl(id),
    createdAt: ts,
    updatedAt: ts,
    expiresAt: inMinutes(ttlMinutes),
    reviewDeadlineAt: undefined,
    proofRequestedAt: undefined,
  };

  await db.collection(COLLECTIONS.invoices).doc(id).set(invoice);

  await writeAuditLog({
    actorId: createdBy,
    actorType: 'api_key',
    action: 'invoice.create',
    resource: 'invoice',
    resourceId: id,
    metadata: {
      orderId: input.orderId,
      amount: input.amount,
      method: input.paymentMethod,
    },
  });

  return invoice;
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const doc = await db.collection(COLLECTIONS.invoices).doc(id).get();
  if (!doc.exists) return null;
  return doc.data() as Invoice;
}

export async function confirmInvoice(
  id: string,
  senderPhone: string
): Promise<Invoice> {
  const invoice = await getInvoice(id);

  if (!invoice) {
    throw new Error('invoice_not_found');
  }

  if (invoice.status !== 'awaiting_payment') {
    throw new Error('invoice_not_awaiting_payment');
  }

  if (invoice.expiresAt < now()) {
    throw new Error('invoice_expired');
  }

  const settingsDoc = await db.collection(COLLECTIONS.systemSettings).doc('main').get();
  const settings = settingsDoc.exists ? settingsDoc.data() : null;
  const reviewSeconds = settings?.reviewDurationSeconds ?? DEFAULT_REVIEW_SECONDS;
  const proofAtSeconds = settings?.proofRequestAtSeconds ?? DEFAULT_PROOF_AT_SECONDS;

  const ts = now();
  const updates: Partial<Invoice> = {
    status: 'pending',
    senderPhone,
    confirmedAt: ts,
    reviewDeadlineAt: ts + reviewSeconds * 1000,
    proofRequestedAt: ts + proofAtSeconds * 1000,
    updatedAt: ts,
  };

  await db.collection(COLLECTIONS.invoices).doc(id).update(updates);

  await writeAuditLog({
    actorId: 'customer',
    actorType: 'system',
    action: 'invoice.confirm',
    resource: 'invoice',
    resourceId: id,
    metadata: { senderPhone: senderPhone.slice(0, 5) + '***' },
  });

  return { ...invoice, ...updates } as Invoice;
}

export async function markInvoicePaid(
  id: string,
  transactionId: string
): Promise<{ updated: boolean; invoice: Invoice | null }> {
  return db.runTransaction(async (tx) => {
    const ref = db.collection(COLLECTIONS.invoices).doc(id);
    const doc = await tx.get(ref);

    if (!doc.exists) {
      return { updated: false, invoice: null };
    }

    const invoice = doc.data() as Invoice;

    if (invoice.status === 'paid') {
      return { updated: false, invoice };
    }

    const ts = now();
    const updates = {
      status: 'paid' as InvoiceStatus,
      paidAt: ts,
      updatedAt: ts,
      transactionId,
    };

    tx.update(ref, updates);

    return { updated: true, invoice: { ...invoice, ...updates } };
  });
}

export async function markInvoiceManualReview(
  id: string,
  reason: string
): Promise<Invoice | null> {
  const invoice = await getInvoice(id);
  if (!invoice) return null;
  if (invoice.status === 'paid' || invoice.status === 'manual_review') return invoice;

  const ts = now();
  await db.collection(COLLECTIONS.invoices).doc(id).update({
    status: 'manual_review',
    manualReviewAt: ts,
    updatedAt: ts,
    metadata: { ...invoice.metadata, reviewReason: reason },
  });

  return { ...invoice, status: 'manual_review', manualReviewAt: ts, updatedAt: ts };
}

export async function markInvoiceFailed(
  id: string,
  reason: string
): Promise<Invoice | null> {
  const invoice = await getInvoice(id);
  if (!invoice) return null;
  if (invoice.status === 'paid') return invoice;

  const ts = now();
  await db.collection(COLLECTIONS.invoices).doc(id).update({
    status: 'failed',
    failedAt: ts,
    updatedAt: ts,
    metadata: { ...invoice.metadata, failReason: reason },
  });

  return { ...invoice, status: 'failed', failedAt: ts, updatedAt: ts };
}

export async function markInvoiceExpired(id: string): Promise<Invoice | null> {
  const invoice = await getInvoice(id);
  if (!invoice) return null;
  if (invoice.status === 'paid' || invoice.status === 'expired') return invoice;

  const ts = now();
  await db.collection(COLLECTIONS.invoices).doc(id).update({
    status: 'expired',
    updatedAt: ts,
  });

  return { ...invoice, status: 'expired', updatedAt: ts };
}

export async function expireStaleInvoices(): Promise<number> {
  const ts = now();
  const snapshot = await db
    .collection(COLLECTIONS.invoices)
    .where('status', 'in', ['awaiting_payment', 'pending'])
    .where('expiresAt', '<', ts)
    .limit(50)
    .get();

  let count = 0;
  for (const doc of snapshot.docs) {
    const invoice = doc.data() as Invoice;
    if (invoice.status === 'pending' && invoice.reviewDeadlineAt && invoice.reviewDeadlineAt > ts) {
      continue;
    }
    await doc.ref.update({ status: 'expired', updatedAt: ts });
    count += 1;
  }

  return count;
}

export async function processReviewDeadlines(): Promise<number> {
  const ts = now();
  const snapshot = await db
    .collection(COLLECTIONS.invoices)
    .where('status', '==', 'pending')
    .where('reviewDeadlineAt', '<', ts)
    .limit(50)
    .get();

  let count = 0;
  for (const doc of snapshot.docs) {
    const invoice = doc.data() as Invoice;
    const hasTransaction = await checkInvoiceHasVerifiedTransaction(invoice.id);

    if (hasTransaction) {
      continue;
    }

    await doc.ref.update({
      status: 'manual_review',
      manualReviewAt: ts,
      updatedAt: ts,
    });
    count += 1;
  }

  return count;
}

async function checkInvoiceHasVerifiedTransaction(invoiceId: string): Promise<boolean> {
  const snapshot = await db
    .collection(COLLECTIONS.transactions)
    .where('invoiceId', '==', invoiceId)
    .where('status', '==', 'verified')
    .limit(1)
    .get();
  return !snapshot.empty;
}