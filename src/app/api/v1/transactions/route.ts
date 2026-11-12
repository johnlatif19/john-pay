import { NextRequest } from 'next/server';
import { db, COLLECTIONS } from '@/lib/firebase';
import { verifyDevice, verifyAdminFromCookie } from '@/lib/auth';
import { verifyTransaction } from '@/lib/verification';
import { verifyTransactionSchema } from '@/lib/types';
import { errorResponse, successResponse, parsePagination, getClientIp, getUserAgent } from '@/lib/utils';
import type { Transaction } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const cookieHeader = request.headers.get('cookie');
  const authResult = await verifyAdminFromCookie(cookieHeader);

  if (!authResult.ok) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  const url = new URL(request.url);
  const { limit, offset } = parsePagination(url.searchParams);
  const status = url.searchParams.get('status');
  const invoiceId = url.searchParams.get('invoiceId');

  let query = db.collection(COLLECTIONS.transactions).orderBy('createdAt', 'desc');

  if (status && status !== 'all') {
    query = query.where('status', '==', status) as typeof query;
  }

  if (invoiceId) {
    query = query.where('invoiceId', '==', invoiceId) as typeof query;
  }

  const snapshot = await query.limit(limit + offset + 1).get();
  const items = snapshot.docs.map((d) => d.data() as Transaction);
  const sliced = items.slice(offset, offset + limit);
  const hasMore = items.length > offset + limit;

  return successResponse({ items: sliced, hasMore, limit, offset });
}

export async function POST(request: NextRequest): Promise<Response> {
  const authResult = await verifyDevice(request);
  if (!authResult.ok || !authResult.context) {
    return errorResponse(authResult.error || 'unauthorized', authResult.status || 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('invalid_body', 400);

  const parsed = verifyTransactionSchema.safeParse(body);
  if (!parsed.success) {
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