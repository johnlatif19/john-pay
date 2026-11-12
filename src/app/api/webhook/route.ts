import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('X-JohnPay-Signature');
  const timestamp = request.headers.get('X-JohnPay-Timestamp');
  const eventId = request.headers.get('X-JohnPay-Event-ID');

  if (!signature || !timestamp || !eventId) {
    return NextResponse.json({ error: 'missing_headers' }, { status: 400 });
  }

  const expected = createHmac('sha256', process.env.JOHN_PAY_WEBHOOK_SECRET!)
    .update(`${timestamp}.${eventId}.${body}`)
    .digest('hex');

  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);

  if (payload.event === 'payment.paid') {
    await markOrderPaid(payload.order_id, {
      invoiceId: payload.invoice_id,
      transactionReference: payload.transaction_reference,
      paidAt: payload.paid_at,
    });

    await fulfillOrder(payload.order_id);
  }

  if (payload.event === 'payment.failed' || payload.event === 'payment.expired') {
    await markOrderFailed(payload.order_id);
  }

  return NextResponse.json({ ok: true });
}