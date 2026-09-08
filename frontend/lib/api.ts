import { API_BASE } from "./config";

export type CheckStatus = "ok" | "warn" | "fail" | "unresolved";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ImpersonationMatch {
  ticker: string;
  name: string;
  contract: string;
  edit_distance: number;
  matched_field: string;
}

export interface ScanResult {
  address: string;
  scanned_at: string;
  token_name: string | null;
  token_symbol: string | null;
  contract: { source_verified: boolean | null; checks: CheckResult[] };
  impersonation: { checks: CheckResult[]; nearest_matches: ImpersonationMatch[] };
  verdict: "PASS" | "CAUTION" | "FAIL";
  facts_checked: number;
  unresolved: number;
  blockscout_url: string;
  cached: boolean;
}

export interface PublicConfig {
  explorer_base: string;
  chain_id: number;
  rpc_url: string;
  reference_token_count: number;
  max_edit_distance_flag: number;
  poll_interval_seconds: number;
  scan_cache_ttl_seconds: number;
  token_ticker: string;
  token_contract_address: string;
  token_dex_url: string;
}

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail || `request failed: HTTP ${resp.status}`);
  }
  return resp.json();
}

export function scanAddress(address: string): Promise<ScanResult> {
  return getJson<ScanResult>(`/api/scan/${address}`);
}

export function fetchFeed(limit = 30): Promise<{ items: ScanResult[] }> {
  return getJson(`/api/feed?limit=${limit}`);
}

export function fetchPublicConfig(): Promise<PublicConfig> {
  return getJson(`/api/config`);
}

export function isAddressLike(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}
