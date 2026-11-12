import { db, COLLECTIONS } from './firebase';
import { generateTransactionId, now, cairoDate, writeAuditLog } from './utils';
import {
  markInvoicePaid,
  markInvoiceManualReview,
  markInvoiceFailed,
  getInvoice,
  getPaymentMethodConfig,
} from './invoices';
import { dispatchWebhook } from './webhooks';
import type {
  VerifyTransactionInput,
  VerificationResult,
  Transaction,
  Invoice,
  PaymentMethod,
} from './types';

interface AdapterContext {
  invoice: Invoice;
  input: VerifyTransactionInput;
  receivingWallet: string;
  expectedAmount: number;
}

interface PaymentSourceAdapter {
  name: string;
  method: PaymentMethod;
  verify(ctx: AdapterContext): Promise<VerificationResult>;
}

const manualReviewAdapter: PaymentSourceAdapter = {
  name: 'manual_review',
  method: 'vodafone_cash',
  async verify(): Promise<VerificationResult> {
    return {
      status: 'manual_review',
      reason: 'no_authoritative_source_connected',
      source: 'system',
    };
  },
};

const orangeManualReviewAdapter: PaymentSourceAdapter = {
  name: 'manual_review_orange',
  method: 'orange_cash',
  async verify(): Promise<VerificationResult> {
    return {
      status: 'manual_review',
      reason: 'no_authoritative_source_connected',
      source: 'system',
    };
  },
};

function getAdapter(method: PaymentMethod): PaymentSourceAdapter {
  if (method === 'vodafone_cash') return manualReviewAdapter;
  if (method === 'orange_cash') return orangeManualReviewAdapter;
  return manualReviewAdapter;
}

async function reserveTransactionReference(reference: string, transactionId: string): Promise<boolean> {
  const normalized = reference.trim().toLowerCase();
  if (!normalized) return false;

  const refId = `ref_${normalized.replace(/[^a-z0-9]/g, '_').slice(0, 100)}`;
  const refDoc = db.collection(COLLECTIONS.transactions).doc(refId);

  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(refDoc);
      if (doc.exists) {
        throw new Error('duplicate_reference');
      }
      tx.set(refDoc, {
        reserved: true,
        transactionId,
        createdAt: now(),
      });
    });
    return true;
  } catch {
    return false;
  }
}

async function checkExistingTransactionForInvoice(invoiceId: string): Promise<Transaction | null> {
  const snapshot = await db
    .collection(COLLECTIONS.transactions)
    .where('invoiceId', '==', invoiceId)
    .where('status', 'in', ['verified', 'manual_review'])
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as Transaction;
}

export async function verifyTransaction(
  input: VerifyTransactionInput,
  actorId: string
): Promise<{
  result: VerificationResult;
  transaction: Transaction;
  invoice: Invoice | null;
}> {
  const invoice = await getInvoice(input.invoiceId);

  if (!invoice) {
    throw new Error('invoice_not_found');
  }

  if (invoice.status === 'paid') {
    const existing = await checkExistingTransactionForInvoice(invoice.id);
    if (existing) {
      return {
        result: {
          status: 'verified',
          reason: 'already_paid',
          source: existing.verificationSource,
          reference: existing.reference,
        },
        transaction: existing,
        invoice,
      };
    }
    throw new Error('invoice_already_paid');
  }

  if (invoice.status === 'expired' || invoice.status === 'failed' || invoice.status === 'cancelled') {
    throw new Error('invoice_not_payable');
  }

  const methodConfig = await getPaymentMethodConfig(invoice.paymentMethod);
  if (!methodConfig) {
    throw new Error('payment_method_not_configured');
  }

  const amountMatches = Math.abs(input.amount - invoice.amount) < 0.01;
  const walletMatches = normalizeWallet(input.receivingWallet) === normalizeWallet(methodConfig.receivingNumber);
  const methodMatches = input.paymentMethod === invoice.paymentMethod;

  const transactionId = generateTransactionId();
  const ts = now();

  let verificationResult: VerificationResult;

  if (!methodMatches || !walletMatches) {
    verificationResult = {
      status: 'rejected',
      reason: !methodMatches ? 'method_mismatch' : 'wallet_mismatch',
      source: 'android_agent',
    };
  } else if (!amountMatches) {
    verificationResult = {
      status: 'rejected',
      reason: 'amount_mismatch',
      source: 'android_agent',
    };
  } else if (input.reference) {
    const reserved = await reserveTransactionReference(input.reference, transactionId);
    if (!reserved) {
      verificationResult = {
        status: 'rejected',
        reason: 'duplicate_reference',
        source: 'android_agent',
      };
    } else {
      const adapter = getAdapter(invoice.paymentMethod);
      verificationResult = await adapter.verify({
        invoice,
        input,
        receivingWallet: methodConfig.receivingNumber,
        expectedAmount: invoice.amount,
      });
    }
  } else {
    const adapter = getAdapter(invoice.paymentMethod);
    verificationResult = await adapter.verify({
      invoice,
      input,
      receivingWallet: methodConfig.receivingNumber,
      expectedAmount: invoice.amount,
    });
  }

  const transaction: Transaction = {
    id: transactionId,
    invoiceId: invoice.id,
    orderId: invoice.orderId,
    amount: input.amount,
    currency: 'EGP',
    paymentMethod: input.paymentMethod,
    receivingWallet: methodConfig.receivingNumber,
    senderPhone: input.senderPhone,
    reference: input.reference,
    transactionDate: input.transactionDate,
    status:
      verificationResult.status === 'verified'
        ? 'verified'
        : verificationResult.status === 'rejected'
        ? 'rejected'
        : 'manual_review',
    verificationSource: verificationResult.source,
    deviceId: input.deviceId,
    notes: verificationResult.reason,
    createdAt: ts,
    updatedAt: ts,
    verifiedAt: verificationResult.status === 'verified' ? ts : undefined,
  };

  await db.collection(COLLECTIONS.transactions).doc(transactionId).set(transaction);

  let updatedInvoice: Invoice | null = invoice;

  if (verificationResult.status === 'verified') {
    const paid = await markInvoicePaid(invoice.id, transactionId);
    updatedInvoice = paid.invoice;

    if (paid.updated && updatedInvoice) {
      await dispatchWebhook('payment.paid', updatedInvoice, {
        transaction_reference: input.reference || '',
        verification_source: verificationResult.source,
        cairo_date: input.transactionDate ? cairoDate(input.transactionDate) : cairoDate(ts),
      });
    }
  } else if (verificationResult.status === 'manual_review') {
    updatedInvoice = await markInvoiceManualReview(invoice.id, verificationResult.reason);
    if (updatedInvoice) {
      await dispatchWebhook('payment.manual_review', updatedInvoice, {
        reason: verificationResult.reason,
      });
    }
  } else {
    await markInvoiceFailed(invoice.id, verificationResult.reason);
    await dispatchWebhook('payment.mismatch', invoice, {
      reason: verificationResult.reason,
    });
  }

  await writeAuditLog({
    actorId,
    actorType: 'device',
    action: 'transaction.verify',
    resource: 'transaction',
    resourceId: transactionId,
    metadata: {
      invoiceId: invoice.id,
      status: verificationResult.status,
      reason: verificationResult.reason,
    },
  });

  return {
    result: verificationResult,
    transaction,
    invoice: updatedInvoice,
  };
}

function normalizeWallet(wallet: string): string {
  return wallet.replace(/\D/g, '');
}