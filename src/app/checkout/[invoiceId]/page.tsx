'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { Button, Input, CopyButton, Spinner, Badge } from '@/components/ui';
import { ReviewTimer, ScreenshotUpload } from '@/components/checkout';

interface InvoiceData {
  id: string;
  orderId: string;
  description: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  status: string;
  expiresAt: number;
  reviewDeadlineAt?: number;
  proofRequestedAt?: number;
  confirmedAt?: number;
  receivingWallet: string;
  displayName: string;
  instructions: string;
  serverNow: number;
}

const statusLabels: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' }> = {
  awaiting_payment: { label: 'في انتظار الدفع', variant: 'info' },
  pending: { label: 'قيد المراجعة', variant: 'warning' },
  paid: { label: 'تم الدفع ✓', variant: 'success' },
  failed: { label: 'فشل', variant: 'danger' },
  mismatch: { label: 'عدم تطابق', variant: 'danger' },
  expired: { label: 'منتهي', variant: 'muted' },
  manual_review: { label: 'مراجعة يدوية', variant: 'warning' },
  cancelled: { label: 'ملغي', variant: 'muted' },
  created: { label: 'جديد', variant: 'default' },
};

export default function CheckoutPage() {
  const params = useParams();
  const invoiceId = params.invoiceId as string;

  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function loadInvoice() {
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error === 'invoice_not_found' ? 'الفاتورة غير موجودة' : 'فشل تحميل الفاتورة');
        return;
      }

      const invoiceData = data.data.invoice || data.data;
      setInvoice(invoiceData);
      
      if (invoiceData.status === 'pending' || invoiceData.status === 'manual_review') {
        setConfirmed(true);
      }
    } catch {
      setError('حدث خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvoice();
    const interval = setInterval(loadInvoice, 5000);
    return () => clearInterval(interval);
  }, [invoiceId]);

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    setError('');
    setConfirming(true);

    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}?action=confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderPhone }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(
          data.error === 'invoice_expired'
            ? 'انتهت صلاحية الفاتورة'
            : data.error === 'invoice_not_awaiting_payment'
            ? 'الفاتورة في حالة لا تسمح بالتأكيد'
            : 'فشل تأكيد الدفع'
        );
        return;
      }

      setConfirmed(true);
      loadInvoice();
    } catch {
      setError('حدث خطأ');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-danger mb-4">
            <svg className="h-16 w-16 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">{error}</h1>
          <p className="text-muted text-sm">تواصل مع المتجر إذا كنت تعتقد أن هذا خطأ</p>
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  const statusInfo = statusLabels[invoice.status] || statusLabels.created;
  const isAwaiting = invoice.status === 'awaiting_payment';
  const isPending = invoice.status === 'pending';
  const isPaid = invoice.status === 'paid';

  return (
    <div className="min-h-screen bg-bg py-8 px-4">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-white">JOHN PAY</h1>
          <p className="text-xs text-muted mt-1">بوابة الدفع الآمنة</p>
        </div>

        <div className="bg-bg-card border border-bg-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-bg-border">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted">رقم الفاتورة</span>
              <div className="flex items-center gap-2">
                <code className="text-xs text-white font-mono" dir="ltr">
                  {invoice.id}
                </code>
                <CopyButton value={invoice.id} />
              </div>
            </div>

            <div className="text-center py-4">
              <p className="text-sm text-muted mb-1">{invoice.description || 'طلب دفع'}</p>
              <p className="text-4xl font-bold text-white" dir="ltr">
                {(invoice.amount || 0).toLocaleString('ar-EG')} <span className="text-xl text-muted">ج.م</span>
              </p>
            </div>

            <div className="flex justify-center mt-4">
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            </div>
          </div>

          {isAwaiting && (
            <div className="p-6 space-y-5">
              <div className="bg-bg-hover rounded-lg p-4">
                <p className="text-xs text-muted mb-2">حوّل المبلغ إلى</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white font-medium">{invoice.displayName}</p>
                    <code className="text-lg font-bold text-brand font-mono" dir="ltr">
                      {invoice.receivingWallet}
                    </code>
                  </div>
                  <CopyButton value={invoice.receivingWallet} />
                </div>
              </div>

              {invoice.instructions && (
                <div className="text-xs text-muted leading-relaxed whitespace-pre-line">
                  {invoice.instructions}
                </div>
              )}

              <div className="space-y-3 pt-2 border-t border-bg-border">
                <h3 className="text-sm font-medium text-white">تأكيد التحويل</h3>
                <form onSubmit={handleConfirm} className="space-y-3">
                  <Input
                    id="senderPhone"
                    type="tel"
                    label="رقم المحفظة اللي حوّلت منها"
                    placeholder="01xxxxxxxxx"
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    required
                    dir="ltr"
                  />

                  {error && (
                    <div className="p-3 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">
                      {error}
                    </div>
                  )}

                  <Button type="submit" loading={confirming} className="w-full" size="lg">
                    تأكيد التحويل
                  </Button>
                </form>
              </div>
            </div>
          )}

          {isPending && confirmed && invoice.reviewDeadlineAt && invoice.proofRequestedAt && (
            <div className="p-6 space-y-4">
              <ReviewTimer
                confirmedAt={invoice.confirmedAt || Date.now()}
                reviewDeadlineAt={invoice.reviewDeadlineAt}
                proofRequestedAt={invoice.proofRequestedAt}
                serverNow={invoice.serverNow}
                status={invoice.status}
              />

              <ScreenshotUpload invoiceId={invoice.id} onUploaded={loadInvoice} />
            </div>
          )}

          {isPaid && (
            <div className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/10 border border-success/20 flex items-center justify-center">
                <svg className="h-8 w-8 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-1">تم تأكيد الدفع</h3>
              <p className="text-sm text-muted">شكراً لك، سيتم معالجة طلبك قريباً</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted">
          محمي بواسطة JOHN PAY • جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  );
}
