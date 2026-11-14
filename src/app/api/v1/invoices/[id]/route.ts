import { NextRequest } from 'next/server';
import { db, COLLECTIONS } from '@/lib/firebase';
import { getInvoice, confirmInvoice, getPaymentMethodConfig } from '@/lib/invoices';
import { verifyAdminFromCookie } from '@/lib/auth';
import { confirmInvoiceSchema } from '@/lib/types';
import { errorResponse, successResponse, now } from '@/lib/utils';
import type { PaymentProof } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const invoice = await getInvoice(params.id);

    if (!invoice) {
      return errorResponse('invoice_not_found', 404);
    }

    const cookieHeader = request.headers.get('cookie');
    const authResult = await verifyAdminFromCookie(cookieHeader);
    
    let receivingWallet = '';
    let displayName = '';
    let instructions = '';

    const methodDoc = await db.collection(COLLECTIONS.paymentMethods).doc(invoice.paymentMethod).get();
    if (methodDoc.exists) {
      const methodData = methodDoc.data();
      receivingWallet = methodData?.receivingNumber || '';
      displayName = methodData?.displayName || '';
      instructions = methodData?.instructions || '';
    }

    const publicData = {
      id: invoice.id,
      orderId: invoice.orderId,
      description: invoice.description,
      amount: invoice.amount,
      currency: invoice.currency,
      paymentMethod: invoice.paymentMethod,
      status: invoice.status,
      expiresAt: invoice.expiresAt,
      reviewDeadlineAt: invoice.reviewDeadlineAt,
      proofRequestedAt: invoice.proofRequestedAt,
      confirmedAt: invoice.confirmedAt,
      receivingWallet,
      displayName,
      instructions,
      serverNow: Date.now(),
    };

    if (authResult.ok) {
      return successResponse({
        ...publicData,
        invoice,
      });
    }

    return successResponse(publicData);
  } catch (error) {
    console.error('Get invoice error:', error);
    return errorResponse('internal_error', 500);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'confirm') {
    return handleConfirm(request, params.id);
  }

  if (action === 'proof') {
    return handleProof(request, params.id);
  }

  return errorResponse('invalid_action', 400);
}

async function handleConfirm(request: NextRequest, invoiceId: string): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('invalid_body', 400);

  const parsed = confirmInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('validation_failed', 400, parsed.error.issues[0]?.message);
  }

  try {
    const invoice = await confirmInvoice(invoiceId, parsed.data.senderPhone);
    return successResponse({
      status: invoice.status,
      reviewDeadlineAt: invoice.reviewDeadlineAt,
      proofRequestedAt: invoice.proofRequestedAt,
      serverNow: now(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'confirm_failed';
    return errorResponse(msg, 400);
  }
}

async function handleProof(request: NextRequest, invoiceId: string): Promise<Response> {
  try {
    const invoice = await getInvoice(invoiceId);
    if (!invoice) return errorResponse('invoice_not_found', 404);

    if (invoice.status !== 'pending' && invoice.status !== 'manual_review') {
      return errorResponse('invoice_not_accepting_proof', 400);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return errorResponse('invalid_body', 400);

    const publicId = typeof (body as Record<string, unknown>).publicId === 'string'
      ? ((body as Record<string, unknown>).publicId as string)
      : '';
    const mimeType = typeof (body as Record<string, unknown>).mimeType === 'string'
      ? ((body as Record<string, unknown>).mimeType as string)
      : '';
    const sizeBytes = typeof (body as Record<string, unknown>).sizeBytes === 'number'
      ? ((body as Record<string, unknown>).sizeBytes as number)
      : 0;

    if (!publicId.startsWith(`johnpay/proofs/${invoiceId}/`)) {
      return errorResponse('invalid_public_id', 400);
    }

    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mimeType)) {
      return errorResponse('invalid_mime_type', 400);
    }

    const maxSize = parseInt(process.env.MAX_PROOF_SIZE_MB || '5', 10) * 1024 * 1024;
    if (sizeBytes > maxSize) {
      return errorResponse('file_too_large', 400);
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const proof: PaymentProof = {
      id: `prf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      invoiceId,
      cloudinaryPublicId: publicId,
      cloudinaryUrl: `https://res.cloudinary.com/${cloudName}/image/authenticated/${publicId}`,
      mimeType,
      sizeBytes,
      uploadedAt: now(),
    };

    await db.collection(COLLECTIONS.paymentProofs).doc(proof.id).set(proof);

    return successResponse({ proofId: proof.id, uploadedAt: proof.uploadedAt });
  } catch (error) {
    console.error('PROOF UPLOAD ERROR:', error);
    return errorResponse('proof_failed', 500, error instanceof Error ? error.message : 'unknown');
  }
}
