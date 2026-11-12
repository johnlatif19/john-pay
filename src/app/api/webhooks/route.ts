import { NextRequest } from 'next/server';
import { verifyAdminFromCookie, verifyCronSecret } from '@/lib/auth';
import { retryPendingDeliveries, retryDeliveryManually, sendTestWebhook } from '@/lib/webhooks';
import { getWebhookConfig } from '@/lib/webhooks';
import { errorResponse, successResponse } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'retry-all') {
    const cronAuth = await verifyCronSecret(request);
    if (!cronAuth.ok) {
      const adminAuth = await verifyAdminFromCookie(request.headers.get('cookie'));
      if (!adminAuth.ok) {
        return errorResponse('unauthorized', 401);
      }
    }
    const count = await retryPendingDeliveries();
    return successResponse({ retried: count });
  }

  const authResult = await verifyAdminFromCookie(request.headers.get('cookie'));
  if (!authResult.ok) return errorResponse('unauthorized', 401);

  if (action === 'retry-delivery') {
    const body = await request.json().catch(() => null);
    const id = body && typeof (body as Record<string, unknown>).id === 'string'
      ? ((body as Record<string, unknown>).id as string)
      : '';
    if (!id) return errorResponse('missing_id', 400);
    const ok = await retryDeliveryManually(id);
    if (!ok) return errorResponse('delivery_not_found', 404);
    return successResponse({ ok: true });
  }

  if (action === 'test') {
    const config = await getWebhookConfig();
    if (!config) return errorResponse('webhook_not_configured', 400);
    const result = await sendTestWebhook(config.url, config.secret);
    return successResponse(result);
  }

  return errorResponse('invalid_action', 400);
}