/**
 * Payment provider boundary.
 * Implement this only against an authorized provider's official API and contract.
 * Never mark a payment successful based only on a client callback.
 */
export type PaymentIntentInput = {
  amountPaisa: bigint;
  currency: "NPR";
  reference: string;
  returnUrl: string;
};
export type PaymentIntent = {
  provider: string;
  providerReference: string;
  redirectUrl: string;
  status: "PENDING";
};
export interface PaymentProvider {
  createIntent(input: PaymentIntentInput): Promise<PaymentIntent>;
  verifyWebhook(rawBody: Buffer, signature: string): Promise<{ reference: string; status: "SUCCESS" | "FAILED" }>;
}
export class ProviderNotConfiguredError extends Error {
  constructor() {
    super("No approved payment provider is configured. Demo transfers only.");
    this.name = "ProviderNotConfiguredError";
  }
}
