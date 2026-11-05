# Nepal Wallet Demo

An independently developed, Nepal-focused digital wallet demonstration. This is **not** eSewa's official code, does not use eSewa branding or private systems, and is not connected to any real bank or payment network.

## Features

- User registration and login with hashed passwords
- JWT-protected wallet and transaction APIs
- Demo wallet balance in NPR
- Demo transfer to another registered user
- Transaction ledger and history
- SQLite persistence
- Basic responsive dashboard

## Requirements

- Node.js 20+
- npm

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `JWT_SECRET` to a long, random secret.
3. Install dependencies: `npm install`
4. Start: `npm start`
5. Open http://localhost:3000

The SQLite database is created automatically under `data/`.

## Demo behavior and limitations

This app uses demo credits only. Registration starts with NPR 1,000 in demo balance. Transfers move demo credits between registered users; they do not move real money. There is no real QR settlement, cash-out, bank connection, mobile top-up, bill payment, KYC, or payment-provider integration.

## API

- `POST /api/auth/register` — `{ "name", "email", "password" }`
- `POST /api/auth/login` — `{ "email", "password" }`
- `GET /api/me` — current user and balance (Bearer token)
- `GET /api/transactions` — current user's ledger (Bearer token)
- `POST /api/transfers` — `{ "recipientEmail", "amount", "note" }` (Bearer token)

## Before production

Do not use this demo to hold customer funds or process payments. A production wallet requires legal and regulatory review in Nepal, licensing/partner arrangements, approved payment-provider APIs, KYC/AML controls, fraud monitoring, reconciliation, audit logs, secure key management, penetration testing, backups, and operational support. Never commit real secrets or customer data to GitHub.

## License

Choose a license only after confirming you have the rights to publish and maintain this project.
