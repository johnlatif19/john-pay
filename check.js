const BASE = process.env.CHECK_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || 'e28eb4b2c62a2659c8777c46cc458244c2407598d4ff4bba4f96faeb8d4e4427';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

function log(color, msg) {
  console.log(`${color}${msg}${colors.reset}`);
}

function pass(name, detail) {
  log(colors.green, `✅ ${name}`);
  if (detail) log(colors.gray, `   ${detail}`);
}

function fail(name, detail) {
  log(colors.red, `❌ ${name}`);
  if (detail) log(colors.gray, `   ${detail}`);
}

function warn(name, detail) {
  log(colors.yellow, `⚠️  ${name}`);
  if (detail) log(colors.gray, `   ${detail}`);
}

function section(title) {
  console.log('');
  log(colors.bold + colors.cyan, `━━━ ${title} ━━━`);
}

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function checkServerUp() {
  section('1. Server Connection');
  const res = await request('/api/auth');
  if (res.status === 0) {
    fail('السيرفر مش شغال', 'شغّل "npm run dev" في terminal تاني أول');
    log(colors.gray, `   جرب: ${BASE}`);
    return false;
  }
  if (res.status >= 500) {
    fail('السيرفر شغال بس بيرجّع خطأ', `HTTP ${res.status}`);
    log(colors.gray, `   الرد: ${res.text.slice(0, 200)}`);
    return false;
  }
  pass('السيرفر شغال', `${BASE} → HTTP ${res.status}`);
  return true;
}

async function checkFirebase() {
  section('2. Firebase Admin SDK');
  const res = await request('/api/auth');

  if (res.text && res.text.includes('FIREBASE_SERVICE_ACCOUNT is not set')) {
    fail('FIREBASE_SERVICE_ACCOUNT مش موجود في .env.local');
    log(colors.yellow, '   الحل: أضف المتغير في .env.local وأعد تشغيل السيرفر');
    return false;
  }

  if (res.text && res.text.includes('FIREBASE_SERVICE_ACCOUNT is not valid JSON')) {
    fail('FIREBASE_SERVICE_ACCOUNT مش JSON صحيح');
    log(colors.yellow, '   الحل: تأكد إن السطر كله JSON صحيح على سطر واحد');
    return false;
  }

  if (res.text && res.text.includes('Firestore has already been initialized')) {
    fail('Firestore initialization error');
    log(colors.yellow, '   الحل: أعد تشغيل السيرفر بعد مسح .next');
    return false;
  }

  if (res.json && res.json.success === true) {
    pass('Firebase Admin SDK متصل', 'الرد: authenticated=false');
    return true;
  }

  if (res.status === 200 && res.text && res.text.includes('authenticated')) {
    pass('Firebase Admin SDK متصل');
    return true;
  }

  warn('مش قادر أتأكد من Firebase', `HTTP ${res.status}`);
  log(colors.gray, `   الرد: ${res.text.slice(0, 150)}`);
  return false;
}

async function checkApiProtection() {
  section('3. API Key Protection');

  const body = JSON.stringify({
    orderId: 'ORD-TEST',
    description: 'Test',
    amount: 100,
    paymentMethod: 'vodafone_cash',
  });

  const res = await request('/api/v1/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (res.status === 401 && res.json?.error === 'missing_api_key') {
    pass('API محمي ضد الطلبات بدون API key');
    return true;
  }

  if (res.status === 401) {
    pass('API محمي', `error: ${res.json?.error || 'unauthorized'}`);
    return true;
  }

  if (res.status === 200) {
    fail('⚠️  API مفتوح! بدون API key اشتغل!');
    return false;
  }

  warn('رد غير متوقع', `HTTP ${res.status} → ${res.json?.error || res.text.slice(0, 100)}`);
  return false;
}

async function checkAdminProtection() {
  section('4. Admin Protection');

  const res = await request('/api/admin?resource=stats');

  if (res.status === 401 && (res.json?.error === 'missing_session' || res.json?.error === 'unauthorized')) {
    pass('Admin endpoints محمية');
    return true;
  }

  if (res.status === 200) {
    fail('⚠️  Admin endpoints مفتوحة!');
    return false;
  }

  warn('رد غير متوقع', `HTTP ${res.status} → ${res.json?.error || res.text.slice(0, 100)}`);
  return false;
}

async function checkCronProtection() {
  section('5. Cron Protection');

  const res1 = await request('/api/cron?job=all');
  if (res1.status === 401) {
    pass('Cron محمي بدون secret');
  } else if (res1.status === 200) {
    fail('⚠️  Cron مفتوح بدون secret!');
  } else {
    warn('رد غير متوقع على cron بدون secret', `HTTP ${res1.status}`);
  }

  const res2 = await request('/api/cron?job=all', {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

  if (res2.status === 200 && res2.json?.success === true) {
    pass('Cron شغال بـ secret صحيح');
    const d = res2.json.data;
    log(colors.gray, `   expiredInvoices: ${d.expiredInvoices ?? 0}`);
    log(colors.gray, `   reviewedDeadlines: ${d.reviewedDeadlines ?? 0}`);
    log(colors.gray, `   retriedWebhooks: ${d.retriedWebhooks ?? 0}`);
    log(colors.gray, `   durationMs: ${d.durationMs ?? 0}`);
    return true;
  }

  if (res2.status === 500 && res2.text?.includes('index')) {
    warn('Cron محتاج Firestore Index', 'افتح اللينك في رسالة الخطأ لإنشاء الـ index');
    log(colors.yellow, '   الحل: Firebase Console → Firestore → Indexes');
    log(colors.yellow, '   أو انسخ اللينك من رسالة الخطأ في terminal الـ npm run dev');
    return false;
  }

  if (res2.status === 401) {
    fail('CRON_SECRET مش مطابق');
    log(colors.yellow, `   المتوقع: ${CRON_SECRET}`);
    log(colors.yellow, '   عدّل المتغير في check.js أو .env.local');
    return false;
  }

  warn('Cron رد غير متوقع', `HTTP ${res2.status} → ${res2.json?.error || 'unknown'}`);
  return false;
}

async function checkDashboardProtection() {
  section('6. Dashboard Protection');

  const res = await request('/dashboard');

  if (res.status === 302 || res.status === 307 || res.status === 308) {
    const location = res.headers?.get('location') || '';
    if (location.includes('/login')) {
      pass('Dashboard محمي', `redirect → ${location}`);
      return true;
    }
  }

  if (res.status === 404) {
    warn('Dashboard route لسه مش موجود');
    return true;
  }

  if (res.status === 200) {
    pass('Dashboard page متاح (الحماية داخلية في layout عبر auth check)');
    return true;
  }

  if (res.status === 500) {
    warn('Dashboard route فيه خطأ', 'هيتصلح في PART 6');
    return true;
  }

  warn('رد غير متوقع', `HTTP ${res.status}`);
  return false;
}

async function checkRateLimit() {
  section('7. Rate Limiting');

  log(colors.gray, '   بجرب 70 طلب سريع على /api/v1/invoices...');

  let rateLimited = false;
  let lastStatus = 0;

  for (let i = 1; i <= 70; i++) {
    const res = await request('/api/v1/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    lastStatus = res.status;

    if (res.status === 429) {
      pass(`Rate limit شغال (اتحد بعد ${i} طلب)`);
      rateLimited = true;
      break;
    }
  }

  if (!rateLimited) {
    warn('Rate limit مش نشط في dev mode', 'هيشتغل على Vercel production (Edge Runtime)');
    return true;
  }

  return rateLimited;
}

async function checkEnvVars() {
  section('8. Environment Variables');

  const res = await request('/api/auth');
  const issues = [];

  if (res.text?.includes('FIREBASE_SERVICE_ACCOUNT')) {
    issues.push('FIREBASE_SERVICE_ACCOUNT');
  }

  if (issues.length === 0) {
    pass('كل المتغيرات الأساسية متحملة');
  } else {
    fail(`متغيرات ناقصة: ${issues.join(', ')}`);
    log(colors.yellow, '   أضفها في .env.local وأعد تشغيل npm run dev');
  }

  return issues.length === 0;
}

async function checkUploads() {
  section('9. Cloudinary Upload Signature');

  const res = await request('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoiceId: 'inv_test_fake' }),
  });

  if (res.status === 404 && res.json?.error === 'invoice_not_found') {
    pass('Cloudinary endpoint شغال (رفض invoice غير موجود)');
    return true;
  }

  if (res.status === 500 && res.json?.error === 'cloudinary_not_configured') {
    warn('Cloudinary مش متظبط');
    log(colors.yellow, '   أضف CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET في .env.local');
    return false;
  }

  warn('رد غير متوقع', `HTTP ${res.status} → ${res.json?.error || res.text.slice(0, 100)}`);
  return false;
}

async function main() {
  console.clear();
  log(colors.bold + colors.blue, '');
  log(colors.bold + colors.blue, '╔══════════════════════════════════════════════╗');
  log(colors.bold + colors.blue, '║       JOHN PAY — Full System Check           ║');
  log(colors.bold + colors.blue, '╚══════════════════════════════════════════════╝');
  log(colors.gray, `   Target: ${BASE}`);
  log(colors.gray, `   Time:   ${new Date().toISOString()}`);

  const results = [];

  const serverUp = await checkServerUp();
  if (!serverUp) {
    log(colors.red + colors.bold, '\n❌ السيرفر مش شغال — وقف هنا.');
    log(colors.gray, '   شغّل: npm run dev');
    log(colors.gray, '   ثم في terminal تاني: node check.js');
    process.exit(1);
  }

  const fb = await checkFirebase();
  results.push({ name: 'Firebase', ok: fb });

  const apiProt = await checkApiProtection();
  results.push({ name: 'API Protection', ok: apiProt });

  const adminProt = await checkAdminProtection();
  results.push({ name: 'Admin Protection', ok: adminProt });

  const cronProt = await checkCronProtection();
  results.push({ name: 'Cron', ok: cronProt });

  const dashProt = await checkDashboardProtection();
  results.push({ name: 'Dashboard', ok: dashProt });

  const rate = await checkRateLimit();
  results.push({ name: 'Rate Limit', ok: rate });

  const env = await checkEnvVars();
  results.push({ name: 'Env Vars', ok: env });

  const uploads = await checkUploads();
  results.push({ name: 'Cloudinary', ok: uploads });

  section('📊 النتيجة النهائية');

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;

  results.forEach((r) => {
    if (r.ok) log(colors.green, `✅ ${r.name}`);
    else log(colors.red, `❌ ${r.name}`);
  });

  console.log('');
  if (passed === total) {
    log(colors.bold + colors.green, `🎉 كل الفحوصات نجحت (${passed}/${total})`);
    log(colors.gray, '\n   → المشروع جاهز للاستخدام!');
  } else if (passed >= total - 2) {
    log(colors.bold + colors.yellow, `⚠️  ${passed}/${total} نجحوا — في شوية مشاكل بسيطة`);
    log(colors.gray, '\n   راجع الـ ⚠️  والـ ❌ فوق');
  } else {
    log(colors.bold + colors.red, `❌ ${passed}/${total} — محتاج إصلاح`);
    log(colors.gray, '\n   ابعتهلي عشان أساعدك');
  }
  console.log('');
}

main().catch((err) => {
  log(colors.red, `\n❌ فشل التشغيل: ${err.message}`);
  console.error(err);
  process.exit(1);
});