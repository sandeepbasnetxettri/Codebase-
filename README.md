# Nepal Wallet Platform (Independent Demo)

A React Native + Node.js monorepo for an independent Nepal-focused wallet prototype. It is **not eSewa's source code**, is not affiliated with eSewa, and does not connect to eSewa or any bank/payment network.

## Project structure

```
apps/
  api/                 Express + TypeScript + Prisma API
    prisma/schema.prisma
    src/
      index.ts
      middleware/auth.ts
      routes/auth.ts
      routes/wallet.ts
  mobile/              Expo React Native app (Android, iOS and web)
    App.tsx
    app.json
    src/api.ts
docker-compose.yml
.env.example
package.json
```

## Requirements

- Node.js 20+
- npm 10+
- Docker Desktop (recommended for PostgreSQL), or PostgreSQL 15+

## 1. Configure environment

Copy the root environment template:

```bash
cp .env.example apps/api/.env
# Create apps/mobile/.env containing:
# EXPO_PUBLIC_API_URL=http://localhost:4000
```

Set a long random `JWT_SECRET` and the PostgreSQL connection string in `apps/api/.env`. For Expo, create `apps/mobile/.env` and set `EXPO_PUBLIC_API_URL`. Never commit either environment file.

## 2. Start PostgreSQL

```bash
docker compose up -d db
```

## 3. Install and prepare the API

```bash
npm install
npm run db:generate
npm run db:migrate
npm run dev:api
```

API runs at `http://localhost:4000`; health check: `GET /health`.

## 4. Start the app

In another terminal:

```bash
npm run dev:mobile
```

- Android: press `a` in Expo CLI (Android Studio/emulator required).
- iOS: press `i` on macOS with Xcode, or scan the Expo QR code with Expo Go.
- Website: run `npm run dev:web`.

For a physical phone, set `EXPO_PUBLIC_API_URL` in the mobile app environment to your computer's LAN IP, for example `http://192.168.1.10:4000`. Do not use `localhost` on a physical device.

## API endpoints

All JSON. Protected routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/auth/register` | Create account + demo wallet |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/wallet` | Wallet balance |
| GET | `/api/wallet/transactions` | Ledger history |
| POST | `/api/wallet/transfers` | Transfer demo credits to another user |

Registration body: `{ "name": "A User", "email": "a@example.com", "password": "a-long-password" }`

Transfer body: `{ "recipientEmail": "b@example.com", "amount": 100, "note": "Lunch" }`. Amount is NPR and supports up to two decimal places. The API converts amounts to integer paisa and performs both balance updates and ledger writes in one database transaction.

## Database

PostgreSQL via Prisma. Main tables: `User`, `Wallet`, `LedgerEntry`. Wallet balances and ledger amounts are integer paisa (`BigInt`) to avoid floating-point money errors. The ledger records each side of a transfer.

## Current limitations

- New accounts receive NPR 1,000 of clearly labelled demo credits.
- Transfers move only demo credits between accounts.
- QR, cash-in/cash-out, mobile top-up, bill payment and card/bank rails are not connected.
- There is no KYC, AML screening, sanctions screening, reconciliation, dispute handling, production monitoring, or regulator-approved custody.
- The demo API currently uses bearer access tokens; production needs refresh-token rotation, device/session management, MFA, audit and fraud controls.

## Real payment integration

A production wallet in Nepal requires legal/regulatory assessment, applicable Nepal Rastra Bank authorization or a licensed partner, KYC/AML processes, safeguarding/reconciliation, and contracts with approved payment providers. Integrate only through official partner documentation and credentials. Never scrape, clone, or impersonate eSewa endpoints or use its branding without permission.

## Security checklist before deployment

- Replace demo credit creation with approved funding rails.
- Add refresh-token rotation, MFA, device/session revocation and account recovery.
- Add idempotency keys, transfer limits, velocity checks, fraud alerts and immutable audit trails.
- Add webhook signature verification and reconciliation for provider callbacks.
- Use TLS, managed secrets, database encryption/backups, monitoring and penetration testing.
- Complete legal, privacy, KYC/AML and operational reviews.

This repository is a development starter, not a licensed financial service or production-ready store of value.


## Added demo modules
- QR payment request creation and QR-code-string payment between demo wallets.
- NTC/Ncell/SmartCell recharge request endpoint (currently debits demo credits only; does not deliver airtime).
- NEA electricity, drinking-water and internet bill request endpoint (currently demo debit only; does not settle a real bill).
- KYC application form and status workflow (test data only; no document image upload or identity verification).
- Admin overview, user list and KYC review API. Admin role must be assigned manually by a trusted operator directly in the database; never expose public admin self-registration.

### New API routes
- `POST /api/services/qr/create`, `POST /api/services/qr/pay`
- `POST /api/services/recharge`, `POST /api/services/bills`
- `POST /api/services/kyc`, `GET /api/services/kyc`
- `GET /api/admin/overview`, `GET /api/admin/kyc`, `PATCH /api/admin/kyc/:id`, `GET /api/admin/users`

Run `npm run db:generate && npm run db:migrate` after pulling these schema changes. For local admin testing, assign `role = 'ADMIN'` to a trusted test user in PostgreSQL manually. The app exposes a small admin overview panel only to ADMIN accounts; detailed admin APIs are available for a future dedicated dashboard UI.

**Critical:** these are sandbox workflows. QR payment codes are not rendered as scannable QR images yet; the current UI shares a code string. Recharge and bill routes debit demo credits but do not contact telecom or utility providers. KYC stores entered test fields and is not compliant identity verification. Do not enter real identity data or real funds. Before production, add provider integrations, signed callbacks/webhooks, idempotency, audit logs, role-based admin controls, KYC document storage with encryption/access controls, privacy/retention policies, independent security testing, and Nepal regulatory/legal review.


## Cash operations, AML review and admin controls (sandbox)
Cash-in and cash-out requests are created as pending records. Admin approval changes the demo wallet ledger; it does not cause a bank transfer or physical cash disbursement. Basic high-value flags create manual-review AML cases. Admins can review cash requests and AML cases, suspend/freeze accounts, and inspect audit events.

Added routes:
- POST /api/services/cash-in
- POST /api/services/cash-out
- GET /api/services/cash-requests
- GET /api/admin/cash-requests and PATCH /api/admin/cash-requests/:id
- GET /api/admin/aml-cases and PATCH /api/admin/aml-cases/:id
- PATCH /api/admin/users/:id/status
- GET /api/admin/audit

This is only workflow scaffolding. Rule-based high-value flags are not a compliant AML program and do not perform sanctions/PEP screening, suspicious activity reporting, or regulatory monitoring. Do not use real customer data or funds.

## Approved payment provider integration
The provider adapter is intentionally a boundary only. A real implementation cannot be safely completed without the exact provider, approved merchant agreement, official API documentation, sandbox credentials, signing/webhook specification and settlement/reconciliation rules. Do not send credentials in chat or commit them to Git. Never treat a browser redirect or client-side callback as proof of payment.


## eSewa ePay v2 integration (merchant checkout)

The repository now includes eSewa ePay v2 sandbox/production configuration, HMAC-SHA256 request signing, a hosted checkout handoff page, signed success-response validation, and server-to-server transaction status verification.

### Configure

Copy `.env.example` to `apps/api/.env` and set:

```env
ESEWA_ENV=sandbox
ESEWA_PRODUCT_CODE=EPAYTEST
ESEWA_SECRET_KEY=your-eSewa-issued-secret
API_PUBLIC_URL=https://your-public-api-domain.example
ESEWA_WALLET_TOPUP_ENABLED=false
```

Use the sandbox product code and secret supplied in eSewa's official UAT documentation for testing. For production, use only the product code and secret issued for your approved merchant account and set `ESEWA_ENV=production`. Keep the secret only in the API runtime environment/secret manager; never put it in Expo variables, source code, or Git.

`API_PUBLIC_URL` must be a publicly reachable HTTPS API origin for eSewa's success/failure redirects. Do not leave it as localhost outside local development.

### Checkout flow

- `POST /api/services/esewa/initiate` (authenticated; JSON body `{"amount": 100}`) creates a pending payment and returns a transaction UUID.
- The mobile app opens `/api/services/esewa/checkout/:transactionUuid`, a hosted form that POSTs to eSewa's official checkout URL.
- eSewa redirects to `GET /api/services/esewa/success`; the API validates the signed Base64 response and independently checks the transaction with eSewa's status API.
- `GET /api/services/esewa/status/:transactionUuid` (authenticated) lets the app refresh the server-verified status.

Run the database migration after pulling this change:

```bash
npm run db:generate
npm run db:migrate
```

### Important scope and limits

When `ESEWA_WALLET_TOPUP_ENABLED=true`, a verified `COMPLETE` payment credits the user's wallet and creates a credit ledger entry in the same database transaction. A conditional payment-state transition makes settlement idempotent: callback/status-check races or repeated requests cannot credit the same transaction twice. The flag defaults to `false`; initiation is blocked until an operator deliberately enables it. **Do not enable wallet top-ups for real funds unless eSewa has approved this exact merchant use case and the required Nepal regulatory authorization/licensed-partner arrangement is in place.** eSewa ePay is a merchant collection flow, not a general-purpose P2P wallet API. This code still requires dependency installation, TypeScript build, Prisma migration, sandbox end-to-end testing, reconciliation, security review, and legal/regulatory approval before any production use.
