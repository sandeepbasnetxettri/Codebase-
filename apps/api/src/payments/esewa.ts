import { createHmac, timingSafeEqual } from "crypto";

export type EsewaForm = Record<string, string>;
const SANDBOX_FORM_URL = "https://rc-epay.esewa.com.np/api/epay/main/v2/form";
const PRODUCTION_FORM_URL = "https://epay.esewa.com.np/api/epay/main/v2/form";
const SANDBOX_STATUS_URL = "https://rc.esewa.com.np/api/epay/transaction/status/";
const PRODUCTION_STATUS_URL = "https://esewa.com.np/api/epay/transaction/status/";

function config() {
  const productCode = process.env.ESEWA_PRODUCT_CODE;
  const secretKey = process.env.ESEWA_SECRET_KEY;
  const apiPublicUrl = process.env.API_PUBLIC_URL;
  if (!productCode || !secretKey || !apiPublicUrl) throw new Error("eSewa is not configured. Set ESEWA_PRODUCT_CODE, ESEWA_SECRET_KEY and API_PUBLIC_URL.");
  const production = process.env.ESEWA_ENV === "production";
  return {
    productCode,
    secretKey,
    apiPublicUrl: apiPublicUrl.replace(/\/$/, ""),
    formUrl: production ? PRODUCTION_FORM_URL : SANDBOX_FORM_URL,
    statusUrl: production ? PRODUCTION_STATUS_URL : SANDBOX_STATUS_URL
  };
}

export function createEsewaForm(input: { amount: string; transactionUuid: string }): { actionUrl: string; fields: EsewaForm } {
  const c = config();
  const fields: EsewaForm = {
    amount: input.amount,
    tax_amount: "0",
    total_amount: input.amount,
    transaction_uuid: input.transactionUuid,
    product_code: c.productCode,
    product_service_charge: "0",
    product_delivery_charge: "0",
    success_url: c.apiPublicUrl + "/api/services/esewa/success",
    failure_url: c.apiPublicUrl + "/api/services/esewa/failure",
    signed_field_names: "total_amount,transaction_uuid,product_code"
  };
  const message = `total_amount=${fields.total_amount},transaction_uuid=${fields.transaction_uuid},product_code=${fields.product_code}`;
  fields.signature = createHmac("sha256", c.secretKey).update(message).digest("base64");
  return { actionUrl: c.formUrl, fields };
}

function validSignature(fields: Record<string, unknown>): boolean {
  const c = config();
  const names = String(fields.signed_field_names || "").split(",");
  if (!names.length || names.some(name => !/^[a-z_]+$/i.test(name))) return false;
  const signature = String(fields.signature || "");
  if (!signature) return false;
  const message = names.map(name => `${name}=${String(fields[name] ?? "")}`).join(",");
  const expected = createHmac("sha256", c.secretKey).update(message).digest();
  let received: Buffer;
  try { received = Buffer.from(signature, "base64"); } catch { return false; }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function decodeAndVerifyEsewaResponse(encoded: string): {
  transaction_uuid: string; product_code: string; total_amount: string; status: string; transaction_code?: string;
} {
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const payload = JSON.parse(decoded) as Record<string, unknown>;
  if (!validSignature(payload)) throw new Error("Invalid eSewa response signature");
  const result = {
    transaction_uuid: String(payload.transaction_uuid || ""),
    product_code: String(payload.product_code || ""),
    total_amount: String(payload.total_amount || ""),
    status: String(payload.status || ""),
    transaction_code: payload.transaction_code ? String(payload.transaction_code) : undefined
  };
  if (!result.transaction_uuid || !result.product_code || !result.total_amount) throw new Error("Incomplete eSewa response");
  return result;
}

export async function checkEsewaStatus(input: { transactionUuid: string; totalAmount: string }): Promise<{ status: string; refId?: string }> {
  const c = config();
  const url = new URL(c.statusUrl);
  url.searchParams.set("product_code", c.productCode);
  url.searchParams.set("total_amount", input.totalAmount);
  url.searchParams.set("transaction_uuid", input.transactionUuid);
  const response = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`eSewa status check failed with HTTP ${response.status}`);
  const data = await response.json() as Record<string, unknown>;
  if (String(data.product_code) !== c.productCode || String(data.transaction_uuid) !== input.transactionUuid || Number(data.total_amount) !== Number(input.totalAmount)) {
    throw new Error("eSewa status response did not match the requested transaction");
  }
  return { status: String(data.status || ""), refId: data.ref_id ? String(data.ref_id) : undefined };
}

export function getEsewaProductCode() { return config().productCode; }
