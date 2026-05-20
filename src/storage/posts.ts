import type { mastodon } from "masto";
import { kvGet, kvSet } from "./kv";

export const POST_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

type Wrapped<T> = { v: T; t: number };

const postsKey = (instanceUrl: string) => `subee:posts:${instanceUrl}`;

function migrateFromLocalStorage(
	instanceUrl: string,
): mastodon.v1.Status[] | null {
	const key = postsKey(instanceUrl);
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Wrapped<mastodon.v1.Status[]>;
		localStorage.removeItem(key);
		if (!parsed || typeof parsed !== "object" || !("v" in parsed)) return null;
		if (Date.now() - parsed.t > POST_CACHE_TTL) return null;
		return parsed.v;
	} catch {
		return null;
	}
}

export async function loadPostCache(
	instanceUrl: string,
): Promise<mastodon.v1.Status[] | null> {
	const fromIdb = await kvGet<mastodon.v1.Status[]>(
		postsKey(instanceUrl),
		POST_CACHE_TTL,
	);
	if (fromIdb) return fromIdb;

	const migrated = migrateFromLocalStorage(instanceUrl);
	if (migrated) {
		await kvSet(postsKey(instanceUrl), migrated);
		return migrated;
	}
	return null;
}

export async function savePostCache(
	instanceUrl: string,
	posts: mastodon.v1.Status[],
): Promise<void> {
	await kvSet(postsKey(instanceUrl), posts);
}
