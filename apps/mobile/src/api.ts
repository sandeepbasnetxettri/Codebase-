const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000";
export type Session = { accessToken: string; user: { id: string; name: string; email: string; wallet?: { currency: string; balancePaisa: string } | null } };
let accessToken = "";
export function setAccessToken(value: string) { accessToken = value; }
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}
export function formatNpr(paisa: string | number) {
  return new Intl.NumberFormat("en-NP", { style: "currency", currency: "NPR" }).format(Number(paisa) / 100);
}
