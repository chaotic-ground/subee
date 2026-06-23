import type { mastodon } from "masto";
import { camelize } from "../mastodon";
import { loadCursorCache, saveCursorCache } from "../storage/cursors";
import {
	loadPostCache,
	MAX_CACHED_POSTS,
	mergePosts,
	savePostCache,
} from "../storage/posts";

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

export interface NativeSyncImport {
	/** Posts not previously cached. */
	added: number;
	/**
	 * Id of the newest post that was already cached before this merge — the read
	 * boundary. Newly delivered posts sort above it, so a divider seeded here
	 * separates the new posts from already-seen ones. Null when there was no
	 * prior content (nothing to separate) or nothing new arrived.
	 */
	boundaryId: string | null;
}

/**
 * Import posts and cursor advances accumulated by native background polling
 * into the web-side caches. Returns how many posts were new and the read
 * boundary (previously-newest cached post id) so callers can mark where the
 * new posts begin.
 */
export async function consumeNativeSyncResults(
	instanceUrl: string,
): Promise<NativeSyncImport> {
	const b = bridge();
	if (!b) return { added: 0, boundaryId: null };

	let parsed: NativeSyncResults;
	try {
		const raw = b.consumeSyncResults();
		if (!raw) return { added: 0, boundaryId: null };
		parsed = JSON.parse(raw) as NativeSyncResults;
	} catch {
		return { added: 0, boundaryId: null };
	}

	let added = 0;
	let boundaryId: string | null = null;
	const rawPosts = parsed.posts ?? [];
	if (rawPosts.length > 0) {
		// Native stores raw snake_case API responses
		const posts = camelize(rawPosts) as mastodon.v1.Status[];
		const existing = (await loadPostCache(instanceUrl)) ?? [];
		const known = new Set(existing.map((p) => p.id));
		added = posts.filter((p) => !known.has(p.id)).length;
		// Cache is newest-first; its head is the previously-newest seen post.
		if (added > 0) boundaryId = existing[0]?.id ?? null;
		const toSave = mergePosts(existing, posts, MAX_CACHED_POSTS);
		// When ≥MAX_CACHED_POSTS new posts arrive the boundary post is truncated out
		// of the merged list, so PostList never renders [data-divider] and the
		// centering scroll silently no-ops. Append it as the 201st entry so the
		// divider always has a DOM target to center on.
		if (added > 0 && boundaryId && !toSave.some((p) => p.id === boundaryId)) {
			const boundaryPost = existing.find((p) => p.id === boundaryId);
			if (boundaryPost) toSave.push(boundaryPost);
		}
		await savePostCache(instanceUrl, toSave);
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

	return { added, boundaryId };
}
