
---

## 📄 8. `docs/INTEGRATION.md`

**المسار:** `D:\john-pay\docs\INTEGRATION.md`

```markdown
# JOHN STORE Integration Guide

Integrate JOHN PAY into your existing store at:
`https://john-pubg-store.vercel.app`

---

## Setup

### 1. Create API Key
- Login to JOHN PAY dashboard: `https://your-john-pay.vercel.app/login`
- Go to **Settings → API Keys**
- Click **New Key**, name it `JOHN STORE`
- **Copy the secret immediately** (it won't show again)

### 2. Configure Webhook
- Go to **Settings → Webhook**
- URL: `https://john-pubg-store.vercel.app/api/webhook`
- Events: `payment.paid`, `payment.failed`, `payment.expired`
- Enable webhook
- **Copy the webhook secret**

### 3. Store Environment Variables
Add to your store's Vercel project:
