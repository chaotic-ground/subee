import { RateLimitError } from "../mastodon";
import { kvGetOrMigrate, kvSet } from "./kv";

export interface AccountCursor {
	accountId: string;
	instanceUrl: string;
	handle: string;
	maxId?: string;
	sinceId?: string;
	done: boolean;
	lastPolledAt?: number;
	// Set on the tombstone (empty accountId) of a lookup that failed
	// transiently (network, 5xx, 429): from this time on, the next explicit
	// load looks the account up again. A tombstone without it (the account
	// wasn't found) waits for the cursor cache to expire.
	retryAt?: number;
}

// A failed lookup whose retry time has come.
export const isLookupRetryDue = (
	c: AccountCursor,
	now: number = Date.now(),
): boolean => !c.accountId && c.retryAt !== undefined && c.retryAt <= now;

// How long a transiently failed lookup waits before the next explicit load
// tries it again (a 429 waits for its own backoff instead).
export const LOOKUP_RETRY_MS = 5 * 60_000; // 5min

export const CURSOR_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// The cursor left for a handle whose lookup failed, so it isn't treated as
// pending forever. Only a 404/410 (no such account) is final; anything else
// is transient and gets a retryAt.
export function lookupFailureTombstone(
	handle: string,
	instanceUrl: string,
	error: unknown,
	now: number = Date.now(),
): AccountCursor {
	const tombstone: AccountCursor = {
		accountId: "",
		instanceUrl,
		handle,
		done: true,
	};
	if (error instanceof RateLimitError)
		return { ...tombstone, retryAt: now + error.retryAfterMs };
	if (error instanceof Error && /^HTTP 4(04|10)\b/.test(error.message))
		return tombstone;
	return { ...tombstone, retryAt: now + LOOKUP_RETRY_MS };
}

const cursorKey = (instanceUrl: string) => `subee:cursors:${instanceUrl}`;

export async function loadCursorCache(
	instanceUrl: string,
): Promise<[string, AccountCursor][] | null> {
	return kvGetOrMigrate<[string, AccountCursor][]>(
		cursorKey(instanceUrl),
		CURSOR_CACHE_TTL,
	);
}

export async function saveCursorCache(
	instanceUrl: string,
	entries: [string, AccountCursor][],
): Promise<void> {
	await kvSet(cursorKey(instanceUrl), entries);
}
