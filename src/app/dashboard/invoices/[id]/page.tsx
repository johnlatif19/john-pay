'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, Spinner, Badge, CopyButton } from '@/components/ui';
import { InvoiceStatusBadge, formatDate, formatCurrency } from '@/components/admin';
import type { Invoice, Transaction, PaymentMethodConfig } from '@/lib/types';

export default function InvoiceDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [method, setMethod] = useState<PaymentMethodConfig | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [invRes, txRes] = await Promise.all([
          fetch(`/api/v1/invoices/${id}`),
          fetch(`/api/v1/transactions?invoiceId=${id}`),
        ]);
        const invData = await invRes.json();
        const txData = await txRes.json();

        if (invData.success) {
          setInvoice(invData.data.invoice);
          if (invData.data.receivingWallet) {
            setMethod({
              id: invData.data.invoice.paymentMethod,
              enabled: true,
              displayName: invData.data.displayName || '',
              receivingNumber: invData.data.receivingWallet,
              instructions: invData.data.instructions || '',
              updatedAt: 0,
            });
          }
        }
        if (txData.success) setTransactions(txData.data.items);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleManualPaid() {
    if (!confirm('هل أنت متأكد من تأكيد الدفع يدوياً؟ سيتم تحويل الفاتورة إلى "مدفوعة".')) return;
    
    setUpdating(true);
    try {
      const res = await fetch(`/api/v1/invoices/${id}?action=manual_paid`, { method: 'POST' });
      if (res.ok) {
        alert('تم تأكيد الدفع بنجاح!');
        window.location.reload();
      } else {
        alert('حدث خطأ أثناء التحديث');
      }
    } catch {
      alert('حدث خطأ في الاتصال');
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <Card>
        <p className="text-center text-muted">الفاتورة غير موجودة</p>
        <div className="text-center mt-4">
          <Link href="/dashboard" className="text-brand hover:underline text-sm">
            العودة للوحة التحكم
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.back()} className="text-muted hover:text-white transition-colors">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">تفاصيل الفاتورة</h1>
          <code className="text-xs text-muted font-mono" dir="ltr">{invoice.id}</code>
        </div>
        
        {invoice.status !== 'paid' && (
          <button
            onClick={handleManualPaid}
            disabled={updating}
            className="px-4 py-2 bg-success hover:bg-success/80 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {updating ? 'جاري التأكيد...' : 'تأكيد الدفع يدوياً'}
          </button>
        )}

        <InvoiceStatusBadge status={invoice.status} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <h2 className="text-sm font-semibold text-white mb-4">معلومات الفاتورة</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Order ID</dt>
              <dd className="text-white font-mono text-xs" dir="ltr">{invoice.orderId}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">الوصف</dt>
              <dd className="text-white">{invoice.description}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">المبلغ</dt>
              <dd className="text-white font-bold" dir="ltr">{formatCurrency(invoice.amount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">طريقة الدفع</dt>
              <dd className="text-white">{invoice.paymentMethod === 'vodafone_cash' ? 'فودافون كاش' : 'أورنج كاش'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">تاريخ الإنشاء</dt>
              <dd className="text-white text-xs">{formatDate(invoice.createdAt)}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-white mb-4">حالة الدفع</h2>
          <dl className="space-y-3 text-sm">
            {invoice.senderPhone && (
              <div className="flex justify-between">
                <dt className="text-muted">رقم المرسل</dt>
                <dd className="text-white font-mono text-xs" dir="ltr">{invoice.senderPhone}</dd>
              </div>
            )}
            {invoice.confirmedAt && (
              <div className="flex justify-between">
                <dt className="text-muted">تاريخ التأكيد</dt>
                <dd className="text-white text-xs">{formatDate(invoice.confirmedAt)}</dd>
              </div>
            )}
            {invoice.paidAt && (
              <div className="flex justify-between">
                <dt className="text-muted">تاريخ الدفع</dt>
                <dd className="text-success text-xs">{formatDate(invoice.paidAt)}</dd>
              </div>
            )}
            {invoice.transactionId && (
              <div className="flex justify-between">
                <dt className="text-muted">رقم المعاملة</dt>
                <dd className="text-brand font-mono text-xs" dir="ltr">{invoice.transactionId}</dd>
              </div>
            )}
            {method && (
              <div className="pt-3 border-t border-bg-border">
                <dt className="text-muted text-xs mb-1">المحفظة المستقبلة</dt>
                <dd className="text-white font-mono text-sm" dir="ltr">{method.receivingNumber}</dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      <Card padding={false}>
        <div className="p-4 border-b border-bg-border">
          <h2 className="text-sm font-semibold text-white">سجل المعاملات</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-hover text-xs text-muted">
              <tr>
                <th className="px-4 py-3 text-right font-medium">ID</th>
                <th className="px-4 py-3 text-right font-medium">المبلغ</th>
                <th className="px-4 py-3 text-right font-medium">المرجع</th>
                <th className="px-4 py-3 text-right font-medium">الحالة</th>
                <th className="px-4 py-3 text-right font-medium">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-muted">لا توجد معاملات</td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-bg-border">
                    <td className="px-4 py-3 font-mono text-xs text-white" dir="ltr">{tx.id}</td>
                    <td className="px-4 py-3 text-white" dir="ltr">{formatCurrency(tx.amount)}</td>
                    <td className="px-4 py-3 text-muted font-mono text-xs" dir="ltr">{tx.reference || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={tx.status === 'verified' ? 'success' : tx.status === 'rejected' ? 'danger' : 'warning'}>
                        {tx.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">{formatDate(tx.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
