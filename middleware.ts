import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRate(key: string, max: number, windowMs: number): boolean {
  const nowTs = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < nowTs) {
    rateLimitStore.set(key, { count: 1, resetAt: nowTs + windowMs });
    return true;
  }

  if (entry.count >= max) return false;

  entry.count += 1;
  return true;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';

  if (pathname.startsWith('/api/')) {
    const max = pathname.startsWith('/api/v1/') ? 60 : 120;
    const allowed = checkRate(`api:${ip}`, max, 60_000);

    if (!allowed) {
      return new NextResponse(
        JSON.stringify({ success: false, error: 'rate_limit_exceeded' }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  if (pathname.startsWith('/checkout/')) {
    const allowed = checkRate(`checkout:${ip}`, 30, 60_000);

    if (!allowed) {
      return new NextResponse(
        JSON.stringify({ success: false, error: 'rate_limit_exceeded' }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  if (pathname.startsWith('/dashboard')) {
    const session = request.cookies.get('johnpay_session');
    if (!session?.value) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  const response = NextResponse.next();

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }

  return response;
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*', '/checkout/:path*'],
};