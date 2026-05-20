import { kvDel, kvGet, kvSet } from "./kv";

export interface AccountCursor {
	accountId: string;
	instanceUrl: string;
	handle: string;
	maxId?: string;
	sinceId?: string;
	done: boolean;
	lastPolledAt?: number;
}

export const CURSOR_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

const cursorKey = (instanceUrl: string) => `subee:cursors:${instanceUrl}`;

type Wrapped<T> = { v: T; t: number };

function migrateFromLocalStorage(
	instanceUrl: string,
): [string, AccountCursor][] | null {
	const key = cursorKey(instanceUrl);
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Wrapped<[string, AccountCursor][]>;
		localStorage.removeItem(key);
		if (!parsed || typeof parsed !== "object" || !("v" in parsed)) return null;
		if (Date.now() - parsed.t > CURSOR_CACHE_TTL) return null;
		return parsed.v;
	} catch {
		return null;
	}
}

export async function loadCursorCache(
	instanceUrl: string,
): Promise<[string, AccountCursor][] | null> {
	const fromIdb = await kvGet<[string, AccountCursor][]>(
		cursorKey(instanceUrl),
		CURSOR_CACHE_TTL,
	);
	if (fromIdb) return fromIdb;

	const migrated = migrateFromLocalStorage(instanceUrl);
	if (migrated) {
		await kvSet(cursorKey(instanceUrl), migrated);
		return migrated;
	}
	return null;
}

export async function saveCursorCache(
	instanceUrl: string,
	entries: [string, AccountCursor][],
): Promise<void> {
	await kvSet(cursorKey(instanceUrl), entries);
}

export async function clearCursorCache(instanceUrl: string): Promise<void> {
	await kvDel(cursorKey(instanceUrl));
}
