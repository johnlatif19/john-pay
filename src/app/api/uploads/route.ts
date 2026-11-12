import { NextRequest } from 'next/server';
import { getInvoice } from '@/lib/invoices';
import { generateUploadSignature } from '@/lib/cloudinary';
import { errorResponse, successResponse } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('invalid_body', 400);

  const invoiceId = (body as Record<string, unknown>).invoiceId;
  if (typeof invoiceId !== 'string' || !invoiceId) {
    return errorResponse('missing_invoice_id', 400);
  }

  const invoice = await getInvoice(invoiceId);
  if (!invoice) return errorResponse('invoice_not_found', 404);

  if (invoice.status !== 'pending' && invoice.status !== 'manual_review') {
    return errorResponse('invoice_not_accepting_proof', 400);
  }

  try {
    const signature = generateUploadSignature(invoiceId);
    return successResponse(signature);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'signature_failed', 500);
  }
}