import { nanoid } from 'nanoid';
import { formatInTimeZone } from 'date-fns-tz';
import { db, COLLECTIONS } from './firebase';
import type { ApiResponse, AuditLog } from './types';

export const now = (): number => Date.now();

export const nowIso = (): string => new Date().toISOString();

export const inSeconds = (seconds: number): number => Date.now() + seconds * 1000;

export const inMinutes = (minutes: number): number => Date.now() + minutes * 60 * 1000;

export const formatCairo = (timestamp: number, pattern = 'yyyy-MM-dd HH:mm:ss'): string =>
  formatInTimeZone(timestamp, 'Africa/Cairo', pattern);

export const cairoDate = (timestamp: number): string =>
  formatInTimeZone(timestamp, 'Africa/Cairo', 'yyyy-MM-dd');

export const generateId = (prefix?: string): string => {
  const id = nanoid(21);
  return prefix ? `${prefix}_${id}` : id;
};

export const generateInvoiceId = (): string => generateId('inv');
export const generateTransactionId = (): string => generateId('txn');
export const generateEventId = (): string => generateId('evt');
export const generateDeviceId = (): string => generateId('dev');
export const generateProofId = (): string => generateId('prf');
export const generateAuditId = (): string => generateId('log');

export const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

export const fail = (error: string, code?: string): ApiResponse => ({
  success: false,
  error,
  code,
});

export const jsonResponse = <T>(body: ApiResponse<T>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const errorResponse = (error: string, status = 400, code?: string): Response =>
  jsonResponse(fail(error, code), status);

export const successResponse = <T>(data: T, status = 200): Response =>
  jsonResponse(ok(data), status);

export function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return `${phone.slice(0, 3)}***${phone.slice(-3)}`;
}

export function maskSecret(secret: string): string {
  if (secret.length < 8) return '***';
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

export function sanitizeString(input: string, maxLength = 500): string {
  return input.trim().slice(0, maxLength).replace(/[<>]/g, '');
}

export function isValidEgyptPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '');
  return /^(20|0)?1[0125]\d{8}$/.test(cleaned);
}

export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('20')) return `0${cleaned.slice(2)}`;
  if (cleaned.startsWith('1') && cleaned.length === 10) return `0${cleaned}`;
  return cleaned;
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const nowTs = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || entry.resetAt < nowTs) {
    rateLimitMap.set(key, { count: 1, resetAt: nowTs + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: nowTs + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

export async function writeAuditLog(params: {
  actorId: string;
  actorType: AuditLog['actorType'];
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    const log: AuditLog = {
      id: generateAuditId(),
      actorId: params.actorId,
      actorType: params.actorType,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      metadata: params.metadata,
      ip: params.ip,
      userAgent: params.userAgent,
      createdAt: now(),
    };
    await db.collection(COLLECTIONS.auditLogs).doc(log.id).set(log);
  } catch (error) {
    console.error('audit_log_failed', error);
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export function getUserAgent(request: Request): string {
  return request.headers.get('user-agent') || 'unknown';
}

export function buildCheckoutUrl(invoiceId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/checkout/${invoiceId}`;
}

export function parsePagination(searchParams: URLSearchParams): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
  return { limit, offset };
}