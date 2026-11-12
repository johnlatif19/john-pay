'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Spinner, Tabs } from '@/components/ui';
import { StatCard, InvoiceStatusBadge, TransactionStatusBadge, EmptyTableRow, formatDate, formatCurrency } from '@/components/admin';
import type { Invoice, Transaction } from '@/lib/types';

interface Stats {
  totalInvoices: number;
  successful: number;
  pending: number;
  failed: number;
  manualReview: number;
  totalRevenue: number;
  todayRevenue: number;
  totalTransactions: number;
}

export default function DashboardPage() {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [statsRes, invoicesRes, txRes] = await Promise.all([
          fetch('/api/admin?resource=stats'),
          fetch('/api/v1/invoices?limit=20'),
          fetch('/api/v1/transactions?limit=20'),
        ]);

        const statsData = await statsRes.json();
        const invoicesData = await invoicesRes.json();
        const txData = await txRes.json();

        if (statsData.success) setStats(statsData.data);
        if (invoicesData.success) setInvoices(invoicesData.data.items);
        if (txData.success) setTransactions(txData.data.items);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">لوحة التحكم</h1>
        <p className="text-sm text-muted mt-1">نظرة عامة على أداء بوابة الدفع</p>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'نظرة عامة' },
          { id: 'invoices', label: 'الفواتير' },
          { id: 'transactions', label: 'المعاملات' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="إجمالي الفواتير"
              value={stats.totalInvoices}
              icon={<svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>}
            />
            <StatCard
              label="مدفوعة"
              value={stats.successful}
              variant="success"
              icon={<svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>}
            />
            <StatCard
              label="قيد المراجعة"
              value={stats.pending + stats.manualReview}
              variant="warning"
              icon={<svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>}
            />
            <StatCard
              label="فاشلة"
              value={stats.failed}
              variant="danger"
              icon={<svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <p className="text-xs text-muted mb-1">إجمالي الإيرادات المؤكدة</p>
              <p className="text-3xl font-bold text-success" dir="ltr">
                {stats.totalRevenue.toLocaleString('ar-EG')} <span className="text-base text-muted">ج.م</span>
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted mb-1">إيرادات اليوم</p>
              <p className="text-3xl font-bold text-brand" dir="ltr">
                {stats.todayRevenue.toLocaleString('ar-EG')} <span className="text-base text-muted">ج.م</span>
              </p>
            </Card>
          </div>

          <Card padding={false}>
            <div className="p-4 border-b border-bg-border">
              <h2 className="text-sm font-semibold text-white">آخر الفواتير</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg-hover text-xs text-muted">
                  <tr>
                    <th className="px-4 py-3 text-right font-medium">الفاتورة</th>
                    <th className="px-4 py-3 text-right font-medium">المبلغ</th>
                    <th className="px-4 py-3 text-right font-medium">الحالة</th>
                    <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <EmptyTableRow colSpan={4} message="لا توجد فواتير بعد" />
                  ) : (
                    invoices.slice(0, 5).map((inv) => (
                      <tr key={inv.id} className="border-t border-bg-border hover:bg-bg-hover/50">
                        <td className="px-4 py-3">
                          <Link href={`/dashboard/invoices/${inv.id}`} className="text-brand hover:underline font-mono text-xs" dir="ltr">
                            {inv.id}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-white font-medium" dir="ltr">{formatCurrency(inv.amount)}</td>
                        <td className="px-4 py-3"><InvoiceStatusBadge status={inv.status} /></td>
                        <td className="px-4 py-3 text-muted text-xs">{formatDate(inv.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'invoices' && (
        <Card padding={false}>
          <div className="p-4 border-b border-bg-border">
            <h2 className="text-sm font-semibold text-white">كل الفواتير ({invoices.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-hover text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">الرقم</th>
                  <th className="px-4 py-3 text-right font-medium">Order ID</th>
                  <th className="px-4 py-3 text-right font-medium">المبلغ</th>
                  <th className="px-4 py-3 text-right font-medium">الطريقة</th>
                  <th className="px-4 py-3 text-right font-medium">الحالة</th>
                  <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <EmptyTableRow colSpan={6} message="لا توجد فواتير" />
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="border-t border-bg-border hover:bg-bg-hover/50">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/invoices/${inv.id}`} className="text-brand hover:underline font-mono text-xs" dir="ltr">
                          {inv.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted font-mono text-xs" dir="ltr">{inv.orderId}</td>
                      <td className="px-4 py-3 text-white font-medium" dir="ltr">{formatCurrency(inv.amount)}</td>
                      <td className="px-4 py-3 text-muted text-xs">{inv.paymentMethod === 'vodafone_cash' ? 'فودافون' : 'أورنج'}</td>
                      <td className="px-4 py-3"><InvoiceStatusBadge status={inv.status} /></td>
                      <td className="px-4 py-3 text-muted text-xs">{formatDate(inv.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'transactions' && (
        <Card padding={false}>
          <div className="p-4 border-b border-bg-border">
            <h2 className="text-sm font-semibold text-white">كل المعاملات ({transactions.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-hover text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">المعاملة</th>
                  <th className="px-4 py-3 text-right font-medium">الفاتورة</th>
                  <th className="px-4 py-3 text-right font-medium">المبلغ</th>
                  <th className="px-4 py-3 text-right font-medium">المرسل</th>
                  <th className="px-4 py-3 text-right font-medium">المرجع</th>
                  <th className="px-4 py-3 text-right font-medium">الحالة</th>
                  <th className="px-4 py-3 text-right font-medium">المصدر</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <EmptyTableRow colSpan={7} message="لا توجد معاملات" />
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="border-t border-bg-border hover:bg-bg-hover/50">
                      <td className="px-4 py-3 font-mono text-xs text-white" dir="ltr">{tx.id}</td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/invoices/${tx.invoiceId}`} className="text-brand hover:underline font-mono text-xs" dir="ltr">
                          {tx.invoiceId}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-white font-medium" dir="ltr">{formatCurrency(tx.amount)}</td>
                      <td className="px-4 py-3 text-muted font-mono text-xs" dir="ltr">{tx.senderPhone}</td>
                      <td className="px-4 py-3 text-muted font-mono text-xs" dir="ltr">{tx.reference || '—'}</td>
                      <td className="px-4 py-3"><TransactionStatusBadge status={tx.status} /></td>
                      <td className="px-4 py-3 text-muted text-xs">{tx.verificationSource}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}