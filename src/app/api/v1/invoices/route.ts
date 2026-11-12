import { NextRequest } from 'next/server';
import { db, COLLECTIONS } from '@/lib/firebase';
import { requireApiAuth, verifyAdminFromCookie } from '@/lib/auth';
import { createInvoice, getPaymentMethodConfig } from '@/lib/invoices';
import { createInvoiceSchema, PAYMENT_METHODS } from '@/lib/types';
import { errorResponse, successResponse, parsePagination } from '@/lib/utils';
import type { Invoice, PaymentMethod } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const authResult = await requireApiAuth(request, 'invoices:create');
  if (!authResult.ok || !authResult.context) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('invalid_body', 400);

  const parsed = createInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    console.error("ZOD VALIDATION ERROR:", parsed.error);
    return errorResponse('validation_failed', 400, parsed.error.issues[0]?.message);
  }

  const methodConfig = await getPaymentMethodConfig(parsed.data.paymentMethod);
  if (!methodConfig) {
    return errorResponse('payment_method_not_configured', 400);
  }

  try {
    const invoice = await createInvoice(parsed.data, authResult.context.actorId);
    return successResponse({
      invoice_id: invoice.id,
      checkout_url: invoice.checkoutUrl,
      amount: invoice.amount,
      currency: invoice.currency,
      payment_method: invoice.paymentMethod,
      expires_at: new Date(invoice.expiresAt).toISOString(),
    }, 201);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'create_failed';
    return errorResponse(msg, 400);
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const cookieHeader = request.headers.get('cookie');
  const authResult = await verifyAdminFromCookie(cookieHeader);

  if (!authResult.ok) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url.searchParams);
  const status = url.searchParams.get('status');
  const method = url.searchParams.get('method');
  const q = url.searchParams.get('q');

  let query = db.collection(COLLECTIONS.invoices).orderBy('createdAt', 'desc');

  if (status && status !== 'all') {
    query = query.where('status', '==', status) as typeof query;
  }

  if (method && PAYMENT_METHODS.includes(method as PaymentMethod)) {
    query = query.where('paymentMethod', '==', method) as typeof query;
  }

  const snapshot = await query.limit(limit + offset + 1).get();
  let items = snapshot.docs.map((d) => d.data() as Invoice);

  if (q) {
    const needle = q.toLowerCase();
    items = items.filter(
      (inv) => inv.id.toLowerCase().includes(needle) || inv.orderId.toLowerCase().includes(needle)
    );
  }

  const sliced = items.slice(offset, offset + limit);
  const hasMore = items.length > offset + limit;

  return successResponse({ items: sliced, hasMore, limit, offset });
}
