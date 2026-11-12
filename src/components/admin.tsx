'use client';

import { ReactNode } from 'react';
import { Badge, Card } from './ui';

export function StatCard({ label, value, icon, variant = 'default' }: {
  label: string;
  value: string | number;
  icon: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const variants = {
    default: 'bg-brand/5 border-brand/10 text-brand',
    success: 'bg-success/5 border-success/10 text-success',
    warning: 'bg-warning/5 border-warning/10 text-warning',
    danger: 'bg-danger/5 border-danger/10 text-danger',
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs text-muted mb-2">{label}</p>
          <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
        </div>
        <div className={`p-2.5 rounded-lg border ${variants[variant]}`}>{icon}</div>
      </div>
    </Card>
  );
}

export function InvoiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' }> = {
    awaiting_payment: { label: 'في انتظار', variant: 'info' },
    pending: { label: 'قيد المراجعة', variant: 'warning' },
    paid: { label: 'مدفوعة', variant: 'success' },
    failed: { label: 'فاشلة', variant: 'danger' },
    mismatch: { label: 'عدم تطابق', variant: 'danger' },
    expired: { label: 'منتهية', variant: 'muted' },
    manual_review: { label: 'مراجعة يدوية', variant: 'warning' },
    cancelled: { label: 'ملغية', variant: 'muted' },
  };
  const info = map[status] || { label: status, variant: 'default' as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

export function TransactionStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' }> = {
    verified: { label: 'موثقة', variant: 'success' },
    manual_review: { label: 'مراجعة', variant: 'warning' },
    rejected: { label: 'مرفوضة', variant: 'danger' },
    received: { label: 'مستلمة', variant: 'info' },
    sent_to_server: { label: 'مرسلة', variant: 'info' },
    sync_error: { label: 'خطأ مزامنة', variant: 'danger' },
  };
  const info = map[status] || { label: status, variant: 'default' as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

export function EmptyTableRow({ colSpan, message = 'لا توجد بيانات' }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-muted">
        {message}
      </td>
    </tr>
  );
}

export function formatDate(ts: number | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('ar-EG')} ج.م`;
}