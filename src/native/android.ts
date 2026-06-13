import { orderBy } from "lodash";
import type { mastodon } from "masto";
import { camelize } from "../mastodon";
import { loadCursorCache, saveCursorCache } from "../storage/cursors";
import { loadPostCache, savePostCache } from "../storage/posts";

const MAX_CACHED_POSTS = 200;

/**
 * JS interface injected by the Android wrapper app (android/).
 * All methods are synchronous @JavascriptInterface calls.
 */
interface SubeeAndroidBridge {
	updateSyncState(json: string): void;
	clearSyncState(): void;
	setBackgroundSync(enabled: boolean): void;
	getBackgroundSync(): boolean;
	consumeSyncResults(): string;
}

declare global {
	interface Window {
		SubeeAndroid?: SubeeAndroidBridge;
	}
}

function bridge(): SubeeAndroidBridge | null {
	return typeof window !== "undefined" ? (window.SubeeAndroid ?? null) : null;
}

export function isAndroidApp(): boolean {
	return bridge() !== null;
}

/**
 * Mirror auth + per-account cursors to the native side so the WorkManager
 * worker can poll the Mastodon API while the app is closed.
 */
// Last payload handed to the native side; lets us skip the cross-process
// write when nothing the poller cares about changed (e.g. on every
// infinite-scroll pagination, which advances maxId but not sinceId).
let lastPushedState: string | null = null;

export async function pushNativeSyncState(
	instanceUrl: string,
	accessToken: string,
): Promise<void> {
	const b = bridge();
	if (!b) return;
	try {
		const cursors = (await loadCursorCache(instanceUrl)) ?? [];
		const payload = {
			instanceUrl,
			accessToken,
			cursors: cursors.map(([, c]) => ({
				handle: c.handle,
				accountId: c.accountId,
				instanceUrl: c.instanceUrl,
				sinceId: c.sinceId ?? null,
				lastPolledAt: c.lastPolledAt ?? 0,
			})),
		};
		const json = JSON.stringify(payload);
		if (json === lastPushedState) return;
		b.updateSyncState(json);
		lastPushedState = json;
	} catch {
		// native side unavailable — ignore
	}
}

export function clearNativeSyncState(): void {
	try {
		lastPushedState = null;
		bridge()?.clearSyncState();
	} catch {
		// ignore
	}
}

export function getNativeBackgroundSync(): boolean {
	try {
		return bridge()?.getBackgroundSync() === true;
	} catch {
		return false;
	}
}

export function setNativeBackgroundSync(enabled: boolean): void {
	try {
		bridge()?.setBackgroundSync(enabled);
	} catch {
		// ignore
	}
}

interface NativeSyncResults {
	posts?: unknown[];
	cursors?: { handle: string; sinceId?: string; lastPolledAt?: number }[];
}

/**
 * Import posts and cursor advances accumulated by native background polling
 * into the web-side caches. Returns the number of posts not previously cached.
 */
export async function consumeNativeSyncResults(
	instanceUrl: string,
): Promise<number> {
	const b = bridge();
	if (!b) return 0;

	let parsed: NativeSyncResults;
	try {
		const raw = b.consumeSyncResults();
		if (!raw) return 0;
		parsed = JSON.parse(raw) as NativeSyncResults;
	} catch {
		return 0;
	}

	let added = 0;
	const rawPosts = parsed.posts ?? [];
	if (rawPosts.length > 0) {
		// Native stores raw snake_case API responses
		const posts = camelize(rawPosts) as mastodon.v1.Status[];
		const existing = (await loadPostCache(instanceUrl)) ?? [];
		const known = new Set(existing.map((p) => p.id));
		added = posts.filter((p) => !known.has(p.id)).length;
		const merged = [...existing, ...posts];
		const deduped = [...new Map(merged.map((p) => [p.id, p])).values()];
		const sorted = orderBy(deduped, (p) => p.createdAt, "desc").slice(
			0,
			MAX_CACHED_POSTS,
		);
		await savePostCache(instanceUrl, sorted);
	}

	const updates = parsed.cursors ?? [];
	if (updates.length > 0) {
		const cached = await loadCursorCache(instanceUrl);
		if (cached) {
			const map = new Map(cached);
			let changed = false;
			for (const u of updates) {
				const cur = map.get(u.handle);
				if (
					cur &&
					u.sinceId &&
					(u.lastPolledAt ?? 0) > (cur.lastPolledAt ?? 0)
				) {
					map.set(u.handle, {
						...cur,
						sinceId: u.sinceId,
						lastPolledAt: u.lastPolledAt,
					});
					changed = true;
				}
			}
			if (changed) await saveCursorCache(instanceUrl, [...map.entries()]);
		}
	}

	return added;
}
