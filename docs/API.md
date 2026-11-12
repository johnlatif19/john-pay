# JOHN PAY API Documentation

Base URL: `https://your-john-pay.vercel.app`
Version: `v1`

---

## Authentication

### API Keys (Server-to-Server)
Header: `Authorization: Bearer jp_live_xxxxx`

### Admin Session (Dashboard)
Cookie: `johnpay_session` (httpOnly, secure)

### Device Auth (Android Agent)
Headers:
- `x-device-id`
- `x-device-secret`

---

## Create Invoice

`POST /api/v1/invoices`

**Auth:** API Key (permission: `invoices:create`)

**Body:**
```json
{
  "orderId": "ORD-123",
  "description": "PUBG UC 660",
  "amount": 267,
  "paymentMethod": "vodafone_cash",
  "customerName": "أحمد",
  "customerPhone": "01012345678"
}