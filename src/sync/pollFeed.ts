import { orderBy } from "lodash";
import type { mastodon } from "masto";
import { fetchAccountStatuses } from "../mastodon";
import {
	type AccountCursor,
	loadCursorCache,
	saveCursorCache,
} from "../storage/cursors";
import { loadPostCache, savePostCache } from "../storage/posts";
import { concurrent } from "./concurrent";

const PAGE_SIZE = 20;
const POLL_CONCURRENCY = 3;
const MAX_CACHED_POSTS = 200;

export interface PollFeedOptions {
	instanceUrl: string;
	accessToken: string;
	onProgress?: (done: number, total: number) => void;
}

export interface PollFeedResult {
	newPosts: mastodon.v1.Status[];
	totalPosts: number;
}

export async function pollFeed({
	instanceUrl,
	accessToken,
	onProgress,
}: PollFeedOptions): Promise<PollFeedResult> {
	const cached = await loadCursorCache(instanceUrl);
	if (!cached) {
		return { newPosts: [], totalPosts: 0 };
	}

	const cursors: AccountCursor[] = cached
		.map(([, c]) => c)
		.filter((c) => c.sinceId)
		.sort((a, b) => (a.lastPolledAt ?? 0) - (b.lastPolledAt ?? 0));

	if (cursors.length === 0) {
		const existing = (await loadPostCache(instanceUrl)) ?? [];
		return { newPosts: [], totalPosts: existing.length };
	}

	const cursorMap = new Map(cached);
	const newPosts: mastodon.v1.Status[] = [];
	let done = 0;
	onProgress?.(0, cursors.length);

	await concurrent(
		cursors.map((cursor) => async () => {
			try {
				const results = await fetchAccountStatuses(
					cursor.instanceUrl,
					cursor.accountId,
					{ sinceId: cursor.sinceId, limit: PAGE_SIZE },
					accessToken,
				);
				cursorMap.set(cursor.handle, {
					...cursor,
					...(results.length > 0 && { sinceId: results[0].id }),
					lastPolledAt: Date.now(),
				});
				if (results.length > 0) newPosts.push(...results);
			} catch {
				// silently ignore poll errors
			}
			done++;
			onProgress?.(done, cursors.length);
		}),
		POLL_CONCURRENCY,
	);

	await saveCursorCache(instanceUrl, [...cursorMap.entries()]);

	const existing = (await loadPostCache(instanceUrl)) ?? [];
	const merged = [...existing, ...newPosts];
	const deduped = [...new Map(merged.map((p) => [p.id, p])).values()];
	const sorted = orderBy(deduped, (p) => p.createdAt, "desc").slice(
		0,
		MAX_CACHED_POSTS,
	);
	await savePostCache(instanceUrl, sorted);

	return { newPosts, totalPosts: sorted.length };
}
