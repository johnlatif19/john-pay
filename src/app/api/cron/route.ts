import { NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/auth';
import { expireStaleInvoices, processReviewDeadlines } from '@/lib/invoices';
import { retryPendingDeliveries } from '@/lib/webhooks';
import { errorResponse, successResponse, now } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await verifyCronSecret(request);
  if (!auth.ok) {
    return errorResponse('unauthorized', 401);
  }

  const url = new URL(request.url);
  const job = url.searchParams.get('job') || 'all';

  const start = now();
  const result: Record<string, number | string> = { job, startedAt: start };

  try {
    if (job === 'all' || job === 'expire') {
      result.expiredInvoices = await expireStaleInvoices();
      result.reviewedDeadlines = await processReviewDeadlines();
    }

    if (job === 'all' || job === 'retry') {
      result.retriedWebhooks = await retryPendingDeliveries();
    }

    result.durationMs = now() - start;
    result.ok = 1;

    return successResponse(result);
  } catch (error) {
    result.durationMs = now() - start;
    return errorResponse(error instanceof Error ? error.message : 'cron_failed', 500);
  }
}