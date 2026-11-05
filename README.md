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
