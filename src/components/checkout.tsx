'use client';

import { useState, useEffect } from 'react';
import { Button, Input, CopyButton } from './ui';

export function ReviewTimer({
  confirmedAt,
  reviewDeadlineAt,
  proofRequestedAt,
  serverNow,
  status,
}: {
  confirmedAt: number;
  reviewDeadlineAt: number;
  proofRequestedAt: number;
  serverNow: number;
  status: string;
}) {
  const [nowTs, setNowTs] = useState(serverNow);
  const offset = Date.now() - serverNow;

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTs(Date.now() - offset);
    }, 1000);
    return () => clearInterval(interval);
  }, [offset]);

  const remaining = Math.max(0, reviewDeadlineAt - nowTs);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const totalSeconds = Math.floor(remaining / 1000);
  const showProofButton = totalSeconds <= Math.floor((reviewDeadlineAt - proofRequestedAt) / 1000);

  if (status !== 'pending') return null;

  return (
    <div className="bg-bg-hover border border-bg-border rounded-xl p-6">
      <div className="text-center mb-4">
        <p className="text-sm text-muted mb-2">الوقت المتبقي للمراجعة</p>
        <div className="text-4xl font-bold text-brand tabular-nums" dir="ltr">
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>
      </div>

      {showProofButton && (
        <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning text-center">
          من فضلك ارفع صورة إثبات التحويل لإتمام مراجعة طلبك
        </div>
      )}

      <div className="mt-4 h-1.5 bg-bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-brand transition-all duration-1000"
          style={{ width: `${(remaining / (reviewDeadlineAt - confirmedAt)) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function ScreenshotUpload({
  invoiceId,
  onUploaded,
}: {
  invoiceId: string;
  onUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setUploading(true);

    try {
      const sigRes = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });

      const sigData = await sigRes.json();
      if (!sigRes.ok || !sigData.success) {
        setError('فشل تحضير الرفع');
        return;
      }

      const sig = sigData.data;

      if (!sig.allowedFormats.split(',').some((f: string) => file.type.includes(f))) {
        setError('صيغة غير مدعومة (JPG, PNG, WEBP فقط)');
        return;
      }

      if (file.size > sig.maxFileSize) {
        setError(`الحجم يجب أن يكون أقل من ${(sig.maxFileSize / 1024 / 1024).toFixed(0)} ميجا`);
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', sig.apiKey);
      formData.append('timestamp', String(sig.timestamp));
      formData.append('signature', sig.signature);
      formData.append('folder', sig.folder);
      formData.append('public_id', sig.publicId);
      formData.append('type', sig.type);
      formData.append('allowed_formats', sig.allowedFormats);

      const uploadRes = await fetch(sig.uploadUrl, {
        method: 'POST',
        body: formData,
      });

      const uploadData = await uploadRes.json();

      if (!uploadRes.ok) {
        setError('فشل رفع الصورة');
        return;
      }

      const confirmRes = await fetch(`/api/invoices/${invoiceId}?action=proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicId: `${sig.folder}/${uploadData.public_id}`,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });

      if (!confirmRes.ok) {
        setError('فشل تأكيد الصورة');
        return;
      }

      setSuccess(true);
      onUploaded();
    } catch {
      setError('حدث خطأ في الرفع');
    } finally {
      setUploading(false);
    }
  }

  if (success) {
    return (
      <div className="p-4 bg-success/10 border border-success/20 rounded-lg text-sm text-success text-center">
        ✓ تم رفع صورة التحويل بنجاح
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <div className="border-2 border-dashed border-bg-border hover:border-brand/50 rounded-xl p-6 text-center cursor-pointer transition-colors">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
          <svg className="h-8 w-8 mx-auto mb-2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <p className="text-sm text-white">{uploading ? 'جاري الرفع...' : 'اختر صورة إثبات التحويل'}</p>
          <p className="text-xs text-muted mt-1">JPG, PNG, WEBP (حتى 5 ميجا)</p>
        </div>
      </label>
      {error && <p className="text-xs text-danger text-center">{error}</p>}
    </div>
  );
}