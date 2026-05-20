import type { mastodon } from "masto";
import { kvGet, kvSet } from "./storage/kv";

export const DEFAULT_INSTANCE = "https://mastodon.social";

function instanceBase(url: string): string {
	return url.replace(/\/$/, "");
}

function camelize(obj: unknown): unknown {
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

async function apiFetch<T>(url: string, accessToken?: string): Promise<T> {
	const headers: HeadersInit = accessToken
		? { Authorization: `Bearer ${accessToken}` }
		: {};
	const res = await fetch(url, { headers });
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	return camelize(await res.json()) as T;
}

async function apiPost<T>(url: string, accessToken: string): Promise<T> {
	const res = await fetch(url, {
		method: "POST",
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	return camelize(await res.json()) as T;
}

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
	return data.access_token;
}

// --- Caches ---

const ACCOUNT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/** @deprecated Use `kvGet` from `./storage/kv` (IndexedDB-backed, SW-accessible). */
export function lsGet<T>(key: string, ttl: number): T | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const { v, t } = JSON.parse(raw) as { v: T; t: number };
		if (Date.now() - t > ttl) {
			localStorage.removeItem(key);
			return null;
		}
		return v;
	} catch {
		return null;
	}
}

/** @deprecated Use `kvSet` from `./storage/kv` (IndexedDB-backed, SW-accessible). */
export function lsSet(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify({ v: value, t: Date.now() }));
	} catch {
		// Storage full or unavailable — silently skip
	}
}

// --- Timeline / Account API ---

export async function fetchHomeTimeline(
	instanceUrl: string,
	params?: { maxId?: string; limit?: number },
	accessToken?: string,
): Promise<mastodon.v1.Status[]> {
	const url = new URL(`${instanceBase(instanceUrl)}/api/v1/timelines/home`);
	if (params?.maxId) url.searchParams.set("max_id", params.maxId);
	url.searchParams.set("limit", String(params?.limit ?? 20));
	return apiFetch<mastodon.v1.Status[]>(url.toString(), accessToken);
}

export async function lookupAccount(
	instanceUrl: string,
	username: string,
	accessToken?: string,
): Promise<mastodon.v1.Account> {
	const cacheKey = `subee:account:${instanceUrl}:${username}`;
	const cached = await kvGet<mastodon.v1.Account>(cacheKey, ACCOUNT_CACHE_TTL);
	if (cached) return cached;
	// Migrate legacy localStorage entry if present
	const legacy = lsGet<mastodon.v1.Account>(cacheKey, ACCOUNT_CACHE_TTL);
	if (legacy) {
		localStorage.removeItem(cacheKey);
		await kvSet(cacheKey, legacy);
		return legacy;
	}
	const url = `${instanceBase(instanceUrl)}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`;
	const account = await apiFetch<mastodon.v1.Account>(url, accessToken);
	await kvSet(cacheKey, account);
	return account;
}

export async function fetchAccountStatuses(
	instanceUrl: string,
	accountId: string,
	params?: { maxId?: string; sinceId?: string; limit?: number },
	accessToken?: string,
): Promise<mastodon.v1.Status[]> {
	const url = new URL(
		`${instanceBase(instanceUrl)}/api/v1/accounts/${accountId}/statuses`,
	);
	if (params?.maxId) url.searchParams.set("max_id", params.maxId);
	if (params?.sinceId) url.searchParams.set("since_id", params.sinceId);
	url.searchParams.set("limit", String(params?.limit ?? 20));
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
