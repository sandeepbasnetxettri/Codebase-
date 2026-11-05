# eSewa Integration — Codebase-

Repository: https://github.com/sandeepbasnetxettri/Codebase-

## Overview

This project contains an eSewa ePay v2 merchant-checkout integration for the Nepal Wallet Platform prototype.

The integration includes:

- HMAC-SHA256 signing for checkout requests.
- Hosted checkout handoff from the mobile app to eSewa.
- Signed Base64 response validation.
- Server-to-server transaction status verification.
- Database records for eSewa payment attempts.
- Optional wallet crediting after a verified successful payment.
- A wallet settlement flag to prevent duplicate credits.
- Mobile wallet and transaction refresh after a successful top-up.

This is an independent project. It is not eSewa software and is not affiliated with eSewa.

## Configuration

Copy the root `.env.example` values into `apps/api/.env` and configure:

```env
ESEWA_ENV=sandbox
ESEWA_PRODUCT_CODE=EPAYTEST
ESEWA_SECRET_KEY=your-eSewa-UAT-secret
API_PUBLIC_URL=https://your-public-api-domain
ESEWA_WALLET_TOPUP_ENABLED=false
```

Use the sandbox credentials and product code from eSewa's official UAT documentation. Production credentials must be issued for your approved merchant account.

Keep the secret only in the API environment or a secret manager. Never commit secrets or put them in mobile/Expo environment variables.

`API_PUBLIC_URL` must be a publicly reachable HTTPS origin for eSewa's return URLs. A public eSewa server cannot reach localhost.

## Payment flow

1. The authenticated mobile user calls `POST /api/services/esewa/initiate` with an amount in NPR.
2. The API creates a pending eSewa payment record and a transaction UUID.
3. The app opens the hosted checkout route: `GET /api/services/esewa/checkout/:transactionUuid`.
4. The hosted page submits the signed form to eSewa's checkout.
5. eSewa redirects to the API success or failure URL.
6. On success, the API validates the signed response, matches the stored transaction details, and independently checks transaction status with eSewa.
7. The authenticated app can call `GET /api/services/esewa/status/:transactionUuid` to refresh the server-verified status.
8. If the provider reports `COMPLETE` and wallet top-ups are enabled, the API credits the wallet and writes a ledger entry in a database transaction.
9. The mobile app refreshes the wallet balance and transaction history when the API confirms `walletCredited: true`.

## Wallet settlement safety

Wallet crediting is controlled by:

```env
ESEWA_WALLET_TOPUP_ENABLED=false
```

- Keep this set to `false` by default.
- For controlled sandbox testing only, it may be set to `true` after configuring valid UAT credentials.
- The settlement operation conditionally claims a payment whose `walletCredited` flag is false, then updates the payment, wallet balance, and ledger in one database transaction.
- Repeated callbacks or status refreshes should not credit the same transaction twice.
- If wallet or ledger writes fail, the database transaction rolls back.

Do not enable real-money top-ups until eSewa has approved this exact merchant use case and the applicable Nepal regulatory authorization or licensed-partner arrangement is confirmed.

## Database setup

After pulling the changes, run from the repository root:

```bash
npm install
npm run db:generate
npm run db:migrate
```

The Prisma schema includes an `EsewaPayment` model with transaction reference, amount in paisa, provider status, provider reference, and `walletCredited` settlement state.

## Build and run

Use the repository's configured scripts:

```bash
npm run build:api
npm run dev:api
npm run dev:mobile
```

If a script is unavailable in the current package configuration, inspect the root and app-level `package.json` files and use the defined scripts instead.

## Important limitations and release checklist

The code has been committed, but the following have **not been confirmed as completed**:

- Dependency installation and TypeScript compilation.
- Prisma client generation and database migration.
- Successful end-to-end UAT checkout.
- Verification of success and failure redirects.
- Repeated callback, duplicate settlement, timeout, and reconciliation tests.
- Security review and production deployment review.

Before production:

- Obtain eSewa's written approval for the intended merchant and wallet-funding use case.
- Confirm applicable Nepal Rastra Bank requirements or use an appropriately licensed partner.
- Complete KYC/AML, privacy, safeguarding, dispute, refund, reconciliation, and operational controls.
- Add monitoring and support procedures for payments that are paid by the customer but not yet credited.
- Keep production secrets in a managed secret store.
- Do not treat a browser redirect alone as proof of payment.

eSewa ePay is a merchant collection checkout, not a general-purpose P2P wallet API. This repository is a prototype and must not be represented as a licensed or production-ready financial service.
