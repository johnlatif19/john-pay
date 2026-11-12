import { NextRequest } from 'next/server';
import { auth, db, COLLECTIONS } from '@/lib/firebase';
import { errorResponse, successResponse, now, writeAuditLog, getClientIp, getUserAgent } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

async function handleLogin(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return errorResponse('invalid_body', 400);
  }

  const email = typeof (body as Record<string, unknown>).email === 'string'
    ? ((body as Record<string, unknown>).email as string).trim().toLowerCase()
    : '';
  const password = typeof (body as Record<string, unknown>).password === 'string'
    ? ((body as Record<string, unknown>).password as string)
    : '';

  if (!email || !password) {
    return errorResponse('missing_credentials', 400);
  }

  const adminSnapshot = await db
    .collection(COLLECTIONS.admins)
    .where('email', '==', email)
    .limit(1)
    .get();

  if (adminSnapshot.empty) {
    return errorResponse('invalid_credentials', 401);
  }

  try {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      return errorResponse('firebase_not_configured', 500);
    }

    const signInResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );

    if (!signInResponse.ok) {
      return errorResponse('invalid_credentials', 401);
    }

    const signInData = (await signInResponse.json()) as { idToken: string };

    const decoded = await auth.verifyIdToken(signInData.idToken);
    const adminDoc = adminSnapshot.docs[0];

    if (adminDoc.id !== decoded.uid) {
      return errorResponse('invalid_credentials', 401);
    }

    const sessionCookie = await auth.createSessionCookie(signInData.idToken, {
      expiresIn: SESSION_DURATION_MS,
    });

    const response = successResponse({ ok: true, email });

    response.headers.set(
      'Set-Cookie',
      `johnpay_session=${sessionCookie}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`
    );

    await adminDoc.ref.update({ lastLoginAt: now() });

    await writeAuditLog({
      actorId: decoded.uid,
      actorType: 'admin',
      action: 'auth.login',
      resource: 'admin',
      resourceId: decoded.uid,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return response;
  } catch {
    return errorResponse('login_failed', 401);
  }
}

async function handleLogout(): Promise<Response> {
  const response = successResponse({ ok: true });
  response.headers.set(
    'Set-Cookie',
    'johnpay_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
  );
  return response;
}

async function handleSession(request: NextRequest): Promise<Response> {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return successResponse({ authenticated: false });
  }

  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [key, ...rest] = c.trim().split('=');
      return [key, rest.join('=')];
    })
  );

  const session = cookies['johnpay_session'];
  if (!session) {
    return successResponse({ authenticated: false });
  }

  try {
    const decoded = await auth.verifySessionCookie(session, true);
    return successResponse({
      authenticated: true,
      uid: decoded.uid,
      email: decoded.email,
    });
  } catch {
    return successResponse({ authenticated: false });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'logout') return handleLogout();
  if (action === 'session') return handleSession(request);

  return handleLogin(request);
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleSession(request);
}