import type { mastodon } from "masto";
import { kvGetOrMigrate, kvSet } from "./storage/kv";

export const DEFAULT_INSTANCE = "https://mastodon.social";

// Default page size for timeline/account fetches.
export const PAGE_SIZE = 20;

function instanceBase(url: string): string {
	return url.replace(/\/$/, "");
}

export function camelize(obj: unknown): unknown {
	if (Array.isArray(obj)) return obj.map(camelize);
	if (obj !== null && typeof obj === "object") {
		return Object.fromEntries(
			Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
				k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
				camelize(v),
			]),
		);
	}
	return obj;
}

// Thrown on HTTP 429 so callers can back off instead of hammering a
// rate-limited instance. retryAfterMs follows the same policy as the native
// Android worker: Retry-After, else X-RateLimit-Reset, else 5min, capped 1h.
export class RateLimitError extends Error {
	retryAfterMs: number;
	constructor(retryAfterMs: number) {
		super("HTTP 429: rate limited");
		this.name = "RateLimitError";
		this.retryAfterMs = retryAfterMs;
	}
}

const MAX_RETRY_AFTER_MS = 60 * 60_000; // 1h
const DEFAULT_RETRY_AFTER_MS = 5 * 60_000; // 5min
// An explicit 429 signal must always yield a real (non-zero) backoff, even if
// the reset time is already past (clock skew) — never hammer a limited instance.
const MIN_EXPLICIT_BACKOFF_MS = 1000;

function parseRetryAfterMs(headers: Headers): number {
	const clamp = (ms: number, min: number) =>
		Math.min(MAX_RETRY_AFTER_MS, Math.max(min, Math.round(ms)));
	const retryAfter = headers.get("Retry-After")?.trim();
	if (retryAfter) {
		if (/^\d+$/.test(retryAfter)) {
			// Whole seconds. Treat 0 as "no explicit value" and fall through.
			const secs = Number(retryAfter);
			if (secs > 0) return clamp(secs * 1000, MIN_EXPLICIT_BACKOFF_MS);
		} else {
			const at = Date.parse(retryAfter); // HTTP-date form
			if (!Number.isNaN(at))
				return clamp(at - Date.now(), MIN_EXPLICIT_BACKOFF_MS);
		}
	}
	// Mastodon sends X-RateLimit-Reset as an ISO8601 timestamp.
	const reset = headers.get("X-RateLimit-Reset");
	if (reset) {
		const at = Date.parse(reset);
		if (!Number.isNaN(at))
			return clamp(at - Date.now(), MIN_EXPLICIT_BACKOFF_MS);
	}
	return DEFAULT_RETRY_AFTER_MS;
}

async function request<T>(
	url: string,
	opts: { method?: "GET" | "POST"; accessToken?: string } = {},
): Promise<T> {
	const res = await fetch(url, {
		method: opts.method ?? "GET",
		headers: opts.accessToken
			? { Authorization: `Bearer ${opts.accessToken}` }
			: {},
	});
	if (res.status === 429)
		throw new RateLimitError(parseRetryAfterMs(res.headers));
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	return camelize(await res.json()) as T;
}

const apiFetch = <T>(url: string, accessToken?: string): Promise<T> =>
	request<T>(url, { accessToken });

const apiPost = <T>(url: string, accessToken: string): Promise<T> =>
	request<T>(url, { method: "POST", accessToken });

export function formatHandle(account: { acct: string; url: string }): string {
	const domain = account.url.match(/https?:\/\/([^/]+)/)?.[1] ?? "";
	return `@${account.acct.includes("@") ? account.acct : `${account.acct}@${domain}`}`;
}

// Parse "@user@instance.social" or "user@instance.social" into parts
export function parseHandle(handle: string): {
	username: string;
	instanceUrl: string;
} {
	const clean = handle.replace(/^@/, "");
	const parts = clean.split("@");
	if (parts.length === 2) {
		return { username: parts[0], instanceUrl: `https://${parts[1]}` };
	}
	return { username: parts[0], instanceUrl: DEFAULT_INSTANCE };
}

// --- OAuth ---

export function getRedirectUri(): string {
	return `${window.location.origin}${window.location.pathname}`;
}

interface AppRegistration {
	clientId: string;
	clientSecret: string;
}

export const OAUTH_SCOPES = [
	"read",
	"write:bookmarks",
	"write:favourites",
	"write:follows",
	"write:media",
	"write:mutes",
	"write:statuses",
].join(" ");

// Bump this string whenever OAUTH_SCOPES changes to force re-registration.
export const OAUTH_SCOPE_VERSION = "v2";

export async function registerApp(
	instanceUrl: string,
): Promise<AppRegistration> {
	const res = await fetch(`${instanceBase(instanceUrl)}/api/v1/apps`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_name: "subee",
			redirect_uris: getRedirectUri(),
			scopes: OAUTH_SCOPES,
			website: getRedirectUri(),
		}),
	});
	if (!res.ok) throw new Error(`Failed to register app: ${await res.text()}`);
	const data = await res.json();
	if (!data.client_id || !data.client_secret) {
		throw new Error("App registration response missing client credentials");
	}
	return { clientId: data.client_id, clientSecret: data.client_secret };
}

export function buildAuthorizationUrl(
	instanceUrl: string,
	clientId: string,
): string {
	const url = new URL(`${instanceBase(instanceUrl)}/oauth/authorize`);
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", getRedirectUri());
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", OAUTH_SCOPES);
	return url.toString();
}

export async function exchangeCodeForToken(
	instanceUrl: string,
	code: string,
	clientId: string,
	clientSecret: string,
): Promise<string> {
	const res = await fetch(`${instanceBase(instanceUrl)}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: getRedirectUri(),
			grant_type: "authorization_code",
			code,
			scope: OAUTH_SCOPES,
		}),
	});
	if (!res.ok) throw new Error(`Failed to exchange token: ${await res.text()}`);
	const data = await res.json();
	if (!data.access_token) {
		throw new Error(
			data.error_description ||
				data.error ||
				"No access_token in token response",
		);
	}
	return data.access_token;
}

// --- Caches ---

const ACCOUNT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// --- Timeline / Account API ---

export async function fetchHomeTimeline(
	instanceUrl: string,
	params?: { maxId?: string; limit?: number },
	accessToken?: string,
): Promise<mastodon.v1.Status[]> {
	const url = new URL(`${instanceBase(instanceUrl)}/api/v1/timelines/home`);
	if (params?.maxId) url.searchParams.set("max_id", params.maxId);
	url.searchParams.set("limit", String(params?.limit ?? PAGE_SIZE));
	return apiFetch<mastodon.v1.Status[]>(url.toString(), accessToken);
}

export async function lookupAccount(
	instanceUrl: string,
	username: string,
	accessToken?: string,
): Promise<mastodon.v1.Account> {
	const cacheKey = `subee:account:${instanceUrl}:${username}`;
	const cached = await kvGetOrMigrate<mastodon.v1.Account>(
		cacheKey,
		ACCOUNT_CACHE_TTL,
	);
	if (cached) return cached;
	const url = `${instanceBase(instanceUrl)}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`;
	const account = await apiFetch<mastodon.v1.Account>(url, accessToken);
	await kvSet(cacheKey, account);
	return account;
}

export async function fetchAccountStatuses(
	instanceUrl: string,
	accountId: string,
	params?: {
		maxId?: string;
		sinceId?: string;
		minId?: string;
		limit?: number;
	},
	accessToken?: string,
): Promise<mastodon.v1.Status[]> {
	const url = new URL(
		`${instanceBase(instanceUrl)}/api/v1/accounts/${accountId}/statuses`,
	);
	if (params?.maxId) url.searchParams.set("max_id", params.maxId);
	if (params?.sinceId) url.searchParams.set("since_id", params.sinceId);
	if (params?.minId) url.searchParams.set("min_id", params.minId);
	url.searchParams.set("limit", String(params?.limit ?? PAGE_SIZE));
	return apiFetch<mastodon.v1.Status[]>(url.toString(), accessToken);
}

// --- Interactions ---

export async function reblogStatus(
	instanceUrl: string,
	statusId: string,
	accessToken: string,
): Promise<void> {
	await apiPost(
		`${instanceBase(instanceUrl)}/api/v1/statuses/${statusId}/reblog`,
		accessToken,
	);
}

export async function unreblogStatus(
	instanceUrl: string,
	statusId: string,
	accessToken: string,
): Promise<void> {
	await apiPost(
		`${instanceBase(instanceUrl)}/api/v1/statuses/${statusId}/unreblog`,
		accessToken,
	);
}

export async function favouriteStatus(
	instanceUrl: string,
	statusId: string,
	accessToken: string,
): Promise<void> {
	await apiPost(
		`${instanceBase(instanceUrl)}/api/v1/statuses/${statusId}/favourite`,
		accessToken,
	);
}

export async function unfavouriteStatus(
	instanceUrl: string,
	statusId: string,
	accessToken: string,
): Promise<void> {
	await apiPost(
		`${instanceBase(instanceUrl)}/api/v1/statuses/${statusId}/unfavourite`,
		accessToken,
	);
}
