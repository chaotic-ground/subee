import type { mastodon } from "masto";
import { fetchAccountStatuses, PAGE_SIZE, RateLimitError } from "../mastodon";
import {
	type AccountCursor,
	loadCursorCache,
	saveCursorCache,
} from "../storage/cursors";
import {
	loadPostCache,
	MAX_CACHED_POSTS,
	mergePosts,
	savePostCache,
} from "../storage/posts";
import { concurrent, FEED_CONCURRENCY } from "./concurrent";

export interface PollFeedOptions {
	instanceUrl: string;
	accessToken: string;
	// Current subscriptions. Cursors for handles not in it (unsubscribed) are
	// neither polled nor kept, so an unsubscribe stops the requests for good.
	// Omitted, every cached cursor is polled.
	handles?: ReadonlySet<string>;
	onProgress?: (done: number, total: number) => void;
	onAccountStatus?: (
		handle: string,
		status: "loading" | "done" | "failed",
	) => void;
}

export interface PollFeedResult {
	newPosts: mastodon.v1.Status[];
	totalPosts: number;
	// Set when the instance returned HTTP 429 this round; callers should not
	// poll again until this timestamp (ms epoch).
	rateLimitedUntil?: number;
}

// Upper bound on pages fetched per account per poll, so one prolific account
// can't monopolise a round. Anything beyond it is not lost: the cursor sits at
// the newest post fetched, and the next poll continues from there.
export const MAX_POLL_PAGES = 10;

/**
 * Fetch every status newer than the cursor, oldest page first.
 *
 * `min_id` (unlike `since_id`) returns the page immediately after the cursor,
 * so paging forward with the newest id of each page walks the whole gap. With
 * `since_id` and a 20-post limit, an account that posted more than 20 times
 * between polls lost everything but its newest 20.
 *
 * A cursor without a sinceId (never had posts, or its first fetch failed) has
 * nothing to page from; its newest page sets the cursor.
 *
 * Returns the number of statuses fetched; each page is handed to `onPage`
 * (newest-first, non-empty) as it arrives.
 */
async function fetchNewStatuses(
	cursor: AccountCursor,
	accessToken: string,
	onPage: (page: mastodon.v1.Status[]) => void,
): Promise<number> {
	if (!cursor.sinceId) {
		const page = await fetchAccountStatuses(
			cursor.instanceUrl,
			cursor.accountId,
			{ limit: PAGE_SIZE },
			accessToken,
		);
		if (page.length > 0) onPage(page);
		return page.length;
	}
	let minId = cursor.sinceId;
	let total = 0;
	for (let i = 0; i < MAX_POLL_PAGES; i++) {
		const page = await fetchAccountStatuses(
			cursor.instanceUrl,
			cursor.accountId,
			{ minId, limit: PAGE_SIZE },
			accessToken,
		);
		if (page.length === 0) break;
		onPage(page);
		total += page.length;
		// A short page means we've reached the newest post.
		if (page.length < PAGE_SIZE) break;
		minId = page[0].id;
	}
	return total;
}

export async function pollFeed({
	instanceUrl,
	accessToken,
	handles,
	onProgress,
	onAccountStatus,
}: PollFeedOptions): Promise<PollFeedResult> {
	const cached = await loadCursorCache(instanceUrl);
	if (!cached) {
		return { newPosts: [], totalPosts: 0 };
	}

	const subscribed = handles
		? cached.filter(([handle]) => handles.has(handle))
		: cached;
	const pruned = subscribed.length !== cached.length;

	// Poll every resolved account (a failed lookup leaves an empty accountId).
	// One without a sinceId yet — it had no posts when first loaded, or that
	// first fetch failed — is polled without since_id; its newest page sets the
	// cursor. Skipping it would leave it silently unpolled forever.
	const cursors: AccountCursor[] = subscribed
		.map(([, c]) => c)
		.filter((c) => c.accountId)
		.sort((a, b) => (a.lastPolledAt ?? 0) - (b.lastPolledAt ?? 0));

	if (cursors.length === 0) {
		if (pruned) await saveCursorCache(instanceUrl, subscribed);
		const existing = (await loadPostCache(instanceUrl)) ?? [];
		return { newPosts: [], totalPosts: existing.length };
	}

	const cursorMap = new Map(subscribed);
	const newPosts: mastodon.v1.Status[] = [];
	let done = 0;
	// Once the instance rate-limits us, stop launching new requests this round
	// instead of piling more onto an instance that already said "slow down".
	let stopped = false;
	let retryAfterMs = 0;
	onProgress?.(0, cursors.length);

	await concurrent(
		cursors.map((cursor) => async () => {
			if (stopped) {
				done++;
				onProgress?.(done, cursors.length);
				return;
			}
			onAccountStatus?.(cursor.handle, "loading");
			try {
				const results = await fetchNewStatuses(
					cursor,
					accessToken,
					// Record progress page by page so a 429 or network error midway
					// still keeps what was already fetched; the next poll resumes
					// from the newest of it instead of refetching or skipping.
					(page) => {
						newPosts.push(...page);
						cursorMap.set(cursor.handle, {
							...cursor,
							sinceId: page[0].id,
							lastPolledAt: Date.now(),
						});
					},
				);
				if (results === 0) {
					cursorMap.set(cursor.handle, {
						...cursor,
						lastPolledAt: Date.now(),
					});
				}
				onAccountStatus?.(cursor.handle, "done");
			} catch (e) {
				if (e instanceof RateLimitError) {
					stopped = true;
					retryAfterMs = Math.max(retryAfterMs, e.retryAfterMs);
					// Not a real failure — just deferred; don't flag the account.
				} else {
					// silently ignore poll errors
					onAccountStatus?.(cursor.handle, "failed");
				}
			}
			done++;
			onProgress?.(done, cursors.length);
		}),
		FEED_CONCURRENCY,
	);

	await saveCursorCache(instanceUrl, [...cursorMap.entries()]);

	const existing = (await loadPostCache(instanceUrl)) ?? [];
	const sorted = mergePosts(existing, newPosts, MAX_CACHED_POSTS);
	await savePostCache(instanceUrl, sorted);

	return {
		newPosts,
		totalPosts: sorted.length,
		...(retryAfterMs > 0 && { rateLimitedUntil: Date.now() + retryAfterMs }),
	};
}
