import { z } from 'zod';

export const PAYMENT_METHODS = ['vodafone_cash', 'orange_cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INVOICE_STATUSES = [
  'created',
  'awaiting_payment',
  'pending',
  'paid',
  'failed',
  'mismatch',
  'expired',
  'manual_review',
  'cancelled',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const TRANSACTION_STATUSES = [
  'received',
  'sent_to_server',
  'verified',
  'manual_review',
  'rejected',
  'sync_error',
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const VERIFICATION_SOURCES = [
  'android_agent',
  'api',
  'manual',
  'system',
] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export const WEBHOOK_EVENTS = [
  'payment.paid',
  'payment.failed',
  'payment.pending',
  'payment.mismatch',
  'payment.expired',
  'payment.manual_review',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Invoice {
  id: string;
  orderId: string;
  description: string;
  amount: number;
  currency: 'EGP';
  paymentMethod: PaymentMethod;
  status: InvoiceStatus;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  metadata?: Record<string, string>;
  checkoutUrl: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  confirmedAt?: number;
  reviewDeadlineAt?: number;
  proofRequestedAt?: number;
  paidAt?: number;
  failedAt?: number;
  manualReviewAt?: number;
  transactionId?: string;
  senderPhone?: string;
}

export interface Transaction {
  id: string;
  invoiceId: string;
  orderId: string;
  amount: number;
  currency: 'EGP';
  paymentMethod: PaymentMethod;
  receivingWallet: string;
  senderPhone: string;
  reference?: string;
  transactionDate?: number;
  status: TransactionStatus;
  verificationSource: VerificationSource;
  deviceId?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  verifiedAt?: number;
  rejectionReason?: string;
}

export interface PaymentMethodConfig {
  id: PaymentMethod;
  enabled: boolean;
  displayName: string;
  receivingNumber: string;
  instructions: string;
  updatedAt: number;
}

export interface Device {
  id: string;
  deviceName: string;
  deviceId: string;
  paymentMethods: PaymentMethod[];
  status: 'active' | 'revoked' | 'pending';
  registeredAt: number;
  lastHeartbeatAt?: number;
  createdAt: number;
  updatedAt: number;
  revokedAt?: number;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  permissions: string[];
  status: 'active' | 'revoked';
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  enabled: boolean;
  events: WebhookEvent[];
  updatedAt: number;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  event: WebhookEvent;
  invoiceId?: string;
  payload: Record<string, unknown>;
  url: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  nextRetryAt?: number;
}

export interface PaymentProof {
  id: string;
  invoiceId: string;
  cloudinaryPublicId: string;
  cloudinaryUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
}

export interface AdminRecord {
  id: string;
  email: string;
  createdAt: number;
  lastLoginAt?: number;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorType: 'admin' | 'api_key' | 'device' | 'system';
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: number;
}

export interface SystemSettings {
  id: string;
  maintenanceMode: boolean;
  invoiceTtlMinutes: number;
  reviewDurationSeconds: number;
  proofRequestAtSeconds: number;
  timezone: string;
  updatedAt: number;
}

export const createInvoiceSchema = z.object({
  orderId: z.string().min(1).max(128),
  description: z.string().min(1).max(500),
  amount: z.number().positive().max(1000000),
  paymentMethod: z.enum(PAYMENT_METHODS),
  customerName: z.string().max(120).optional(),
  customerEmail: z.string().email().max(200).optional(),
  customerPhone: z.string().max(20).optional(),
  metadata: z.record(z.string()).optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const confirmInvoiceSchema = z.object({
  senderPhone: z.string().min(8).max(20),
});

export type ConfirmInvoiceInput = z.infer<typeof confirmInvoiceSchema>;

export const verifyTransactionSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  receivingWallet: z.string().min(1),
  senderPhone: z.string().min(8).max(20),
  reference: z.string().max(120).optional(),
  transactionDate: z.number().optional(),
  deviceId: z.string().min(1),
});

export type VerifyTransactionInput = z.infer<typeof verifyTransactionSchema>;

export const registerDeviceSchema = z.object({
  deviceName: z.string().min(1).max(100),
  deviceId: z.string().min(1).max(200),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const heartbeatSchema = z.object({
  deviceId: z.string().min(1),
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).default(['invoices:create', 'invoices:read']),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const updatePaymentMethodSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string().min(1).max(100),
  receivingNumber: z.string().min(1).max(20),
  instructions: z.string().max(1000),
});

export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;

export const updateWebhookSchema = z.object({
  url: z.string().url().max(500),
  enabled: z.boolean(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface VerificationResult {
  status: 'verified' | 'manual_review' | 'rejected';
  reason: string;
  source: VerificationSource;
  reference?: string;
}