'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Input, Tabs, Spinner, Badge } from '@/components/ui';

export default function SettingsPage() {
  const [tab, setTab] = useState('methods');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [methods, setMethods] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [webhook, setWebhook] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [newKeySecret, setNewKeySecret] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [m, k, w, s] = await Promise.all([
        fetch('/api/admin?resource=payment-methods').then(r => r.json()),
        fetch('/api/admin?resource=api-keys').then(r => r.json()),
        fetch('/api/admin?resource=webhook').then(r => r.json()),
        fetch('/api/admin?resource=settings').then(r => r.json()),
      ]);
      if (m.success) setMethods(m.data.items);
      if (k.success) setApiKeys(k.data.items);
      if (w.success) setWebhook(w.data.webhook);
      if (s.success) setSettings(s.data.settings);
    } finally {
      setLoading(false);
    }
  }

  function flash(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  }

  async function savePaymentMethod(method: any) {
    const res = await fetch('/api/admin?action=save-payment-method', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(method),
    });
    const data = await res.json();
    flash(data.success ? 'تم الحفظ' : 'فشل الحفظ');
  }

  async function createApiKey() {
    const name = prompt('اسم المفتاح:');
    if (!name) return;

    const res = await fetch('/api/admin?action=create-api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, permissions: ['invoices:create', 'invoices:read'] }),
    });
    const data = await res.json();
    if (data.success) {
      setNewKeySecret(data.data.secret);
      flash('تم إنشاء المفتاح — انسخه الآن!');
      loadAll();
    } else {
      flash('فشل');
    }
  }

  async function revokeApiKey(id: string) {
    if (!confirm('متأكد من إلغاء المفتاح؟')) return;
    await fetch('/api/admin?action=revoke-api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    flash('تم الإلغاء');
    loadAll();
  }

  async function saveWebhook(data: any) {
    const res = await fetch('/api/admin?action=save-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (result.success) {
      flash('تم الحفظ');
      if (result.data.secret_shown) setNewKeySecret(result.data.webhook.secret);
      loadAll();
    } else {
      flash('فشل');
    }
  }

  async function saveSettings(data: any) {
    const res = await fetch('/api/admin?action=save-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    flash(result.success ? 'تم الحفظ' : 'فشل');
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">الإعدادات</h1>
        <p className="text-sm text-muted mt-1">تكوين بوابة الدفع</p>
      </div>

      {message && (
        <div className="p-3 bg-brand/10 border border-brand/20 rounded-lg text-sm text-brand">
          {message}
        </div>
      )}

      {newKeySecret && (
        <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg">
          <p className="text-xs text-warning mb-2">⚠️ انسخ هذا الآن — لن يظهر مرة أخرى</p>
          <code className="block p-2 bg-bg border border-bg-border rounded text-xs text-white font-mono break-all" dir="ltr">
            {newKeySecret}
          </code>
          <button onClick={() => setNewKeySecret('')} className="text-xs text-muted hover:text-white mt-2">
            إغلاق
          </button>
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'methods', label: 'طرق الدفع' },
          { id: 'keys', label: 'API Keys' },
          { id: 'webhook', label: 'Webhook' },
          { id: 'system', label: 'النظام' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'methods' && (
        <div className="space-y-4">
          {methods.map((m, idx) => (
            <PaymentMethodForm
              key={m.id}
              method={m}
              onSave={(updated) => {
                const copy = [...methods];
                copy[idx] = updated;
                setMethods(copy);
                savePaymentMethod(updated);
              }}
            />
          ))}
        </div>
      )}

      {tab === 'keys' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">مفاتيح API</h2>
            <Button size="sm" onClick={createApiKey}>مفتاح جديد</Button>
          </div>
          <div className="space-y-2">
            {apiKeys.length === 0 ? (
              <p className="text-center text-xs text-muted py-6">لا توجد مفاتيح</p>
            ) : (
              apiKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between p-3 bg-bg-hover rounded-lg">
                  <div>
                    <p className="text-sm text-white">{k.name}</p>
                    <code className="text-xs text-muted font-mono" dir="ltr">{k.keyPrefix}...</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={k.status === 'active' ? 'success' : 'muted'}>
                      {k.status === 'active' ? 'نشط' : 'ملغي'}
                    </Badge>
                    {k.status === 'active' && (
                      <Button size="sm" variant="danger" onClick={() => revokeApiKey(k.id)}>إلغاء</Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {tab === 'webhook' && <WebhookForm webhook={webhook} onSave={saveWebhook} />}

      {tab === 'system' && settings && (
        <SystemForm settings={settings} onSave={saveSettings} />
      )}
    </div>
  );
}

function PaymentMethodForm({ method, onSave }: { method: any; onSave: (m: any) => void }) {
  const [form, setForm] = useState(method);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">
          {form.id === 'vodafone_cash' ? 'فودافون كاش' : 'أورنج كاش'}
        </h2>
        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="accent-brand"
          />
          مفعّل
        </label>
      </div>
      <div className="space-y-3">
        <Input
          label="اسم العرض"
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
        <Input
          label="رقم المحفظة المستقبلة"
          value={form.receivingNumber}
          onChange={(e) => setForm({ ...form, receivingNumber: e.target.value })}
          dir="ltr"
        />
        <div>
          <label className="block text-sm font-medium text-white mb-2">التعليمات</label>
          <textarea
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            rows={4}
            className="w-full px-4 py-2.5 bg-bg-hover border border-bg-border rounded-lg text-white text-sm focus:outline-none focus:border-brand resize-none"
          />
        </div>
        <Button onClick={() => onSave(form)} className="w-full">حفظ</Button>
      </div>
    </Card>
  );
}

function WebhookForm({ webhook, onSave }: { webhook: any; onSave: (w: any) => void }) {
  const [form, setForm] = useState(webhook || { url: '', enabled: false, events: [] });

  return (
    <Card>
      <div className="space-y-3">
        <Input
          label="Webhook URL"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          placeholder="https://john-pubg-store.vercel.app/api/webhook"
          dir="ltr"
        />
        <label className="flex items-center gap-2 text-sm text-white">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="accent-brand"
          />
          تفعيل الـ Webhook
        </label>
        {webhook?.secret && (
          <div>
            <p className="text-xs text-muted mb-1">Secret (مخفي)</p>
            <code className="block p-2 bg-bg-hover rounded text-xs font-mono text-muted" dir="ltr">
              {webhook.secret}
            </code>
          </div>
        )}
        <Button onClick={() => onSave({ ...form, events: ['payment.paid', 'payment.failed', 'payment.pending', 'payment.mismatch', 'payment.expired', 'payment.manual_review'] })} className="w-full">
          حفظ
        </Button>
      </div>
    </Card>
  );
}

function SystemForm({ settings, onSave }: { settings: any; onSave: (s: any) => void }) {
  const [form, setForm] = useState(settings);

  return (
    <Card>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-white">
          <input
            type="checkbox"
            checked={form.maintenanceMode}
            onChange={(e) => setForm({ ...form, maintenanceMode: e.target.checked })}
            className="accent-brand"
          />
          وضع الصيانة (يمنع إنشاء فواتير جديدة)
        </label>
        <Input
          label="مدة الفاتورة (دقائق)"
          type="number"
          value={form.invoiceTtlMinutes}
          onChange={(e) => setForm({ ...form, invoiceTtlMinutes: +e.target.value })}
        />
        <Input
          label="مدة المراجعة (ثواني)"
          type="number"
          value={form.reviewDurationSeconds}
          onChange={(e) => setForm({ ...form, reviewDurationSeconds: +e.target.value })}
        />
        <Input
          label="وقت طلب لقطة الشاشة (ثواني)"
          type="number"
          value={form.proofRequestAtSeconds}
          onChange={(e) => setForm({ ...form, proofRequestAtSeconds: +e.target.value })}
        />
        <Button onClick={() => onSave(form)} className="w-full">حفظ</Button>
      </div>
    </Card>
  );
}