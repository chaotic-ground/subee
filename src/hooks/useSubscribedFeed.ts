import type { mastodon } from "masto";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	fetchAccountStatuses,
	lookupAccount,
	PAGE_SIZE,
	parseHandle,
} from "../mastodon";
import {
	consumeNativeSyncResults,
	pushNativeSyncState,
} from "../native/android";
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
import { concurrent, FEED_CONCURRENCY } from "../sync/concurrent";
import { pollFeed } from "../sync/pollFeed";

const FLUSH_EVERY = 20; // update UI after every N accounts complete

export interface PollProgress {
	done: number;
	total: number;
}

export type AccountLoadStatus =
	| "idle"
	| "resolving"
	| "loading"
	| "done"
	| "failed";

export function useSubscribedFeed(
	handles: Set<string>,
	instanceUrl: string,
	accessToken: string,
) {
	const [posts, setPosts] = useState<mastodon.v1.Status[]>([]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			// Pull in posts fetched by native background polling before reading
			// the cache, so they appear immediately on app launch.
			const { added, boundaryId } =
				await consumeNativeSyncResults(instanceUrl);
			const cached = await loadPostCache(instanceUrl);
			if (cancelled) return;
			// Only adopt cache if no posts have arrived yet (network may have
			// raced ahead of disk read on slow IDB).
			if (cached && cached.length > 0)
				setPosts((prev) => (prev.length === 0 ? cached : prev));
			// Background sync delivered new posts before this cold start — the
			// common "tapped the notification after hours away" case. Mark the read
			// boundary at the previously-newest post so the user sees where the new
			// posts end and already-seen ones begin: the same seam a manual flush
			// draws, but seeded at mount with no network load. SubscribedPage shows
			// it in place (no auto-scroll) and offers a "Jump to new" button.
			if (added > 0 && boundaryId) {
				setDividerPostId((prev) => prev ?? boundaryId);
				setBoundaryNonce((n) => n + 1);
			}
			// Reflect how fresh the feed is in the "checked Xm ago" label. Read the
			// cursor cache after consuming native results so a background sync that
			// just delivered counts. Max-merge keeps this correct regardless of
			// whether fetchMore's own write lands before or after this one.
			const cursors = await loadCursorCache(instanceUrl);
			if (cancelled) return;
			if (cursors) {
				// Restore cursors from cache so an explicit refresh/poll works without
				// re-resolving accounts. Marked `done` so nothing fetches on its own —
				// only an explicit load (pull-to-refresh / Refresh) fetches.
				if (cursorsRef.current.size === 0) {
					cursorsRef.current = new Map(
						cursors.map(([h, c]) => [h, { ...c, done: true }]),
					);
					if (cursors.length > 0) initializedRef.current = true;
				}
			}
			// Cursors are as-restored-as-they'll-get (the cache is empty on a first
			// login). Only now is the unloaded-account count trustworthy — compute
			// it and let the [handles] effect maintain it from here. Gating on this
			// flag avoids flashing "Load N accounts" on a normal reopen before the
			// cursor cache has finished loading.
			cursorsRestoredRef.current = true;
			setUnloadedCount(
				[...handlesRef.current].filter((h) => !cursorsRef.current.has(h))
					.length,
			);
		})();
		return () => {
			cancelled = true;
		};
	}, [instanceUrl]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [accountStatuses, setAccountStatuses] = useState<
		Map<string, AccountLoadStatus>
	>(new Map());
	const [stagedCount, setStagedCount] = useState(0);
	const [dividerPostId, setDividerPostId] = useState<string | null>(null);
	const [pollProgress, setPollProgress] = useState<PollProgress | null>(null);
	// Bumped only by a user-initiated flush ("N new" tap) so SubscribedPage can
	// scroll to the newest post — distinct from the mount-seeded boundary divider,
	// which scrolls to center the seam (see boundaryNonce).
	const [flushNonce, setFlushNonce] = useState(0);
	// Bumped when the mount effect seeds the boundary divider (cold start after a
	// background sync) so SubscribedPage can scroll to center that seam — the
	// unseen posts above it, the already-seen ones below.
	const [boundaryNonce, setBoundaryNonce] = useState(0);
	// Subscribed accounts that have no cursor yet (first login, or a freshly
	// subscribed/imported account) — i.e. would be loaded by the next refresh().
	const [unloadedCount, setUnloadedCount] = useState(0);

	// Always-current mirror of posts state for use inside callbacks
	const postsRef = useRef(posts);
	postsRef.current = posts;
	// Mirror of the subscribed handles so the mount effect and fetchMore can
	// recompute unloadedCount without widening their dependency lists.
	const handlesRef = useRef(handles);
	handlesRef.current = handles;
	// True once the mount effect has restored (or found no) cursors, so the
	// unloaded-account count reflects real cursor state rather than the pre-load
	// emptiness.
	const cursorsRestoredRef = useRef(false);

	const cursorsRef = useRef<Map<string, AccountCursor>>(new Map());
	const initializedRef = useRef(false);
	const loadingRef = useRef(false);
	// Buffer for progressive rendering — flushed in batches to avoid
	// running an expensive sort on every single account response.
	const pendingRef = useRef<mastodon.v1.Status[]>([]);
	// Staging buffer — posts fetched by polling, not yet visible in the feed.
	const bufferRef = useRef<mastodon.v1.Status[]>([]);
	const pollingRef = useRef(false);
	// After a 429, don't poll again until this timestamp (ms epoch).
	const rateLimitedUntilRef = useRef(0);

	const flush = useCallback(() => {
		if (pendingRef.current.length === 0) return;
		const toAdd = pendingRef.current.splice(0);
		setPosts((prev) => {
			const sorted = mergePosts(prev, toAdd);
			void savePostCache(instanceUrl, sorted.slice(0, MAX_CACHED_POSTS));
			return sorted;
		});
	}, [instanceUrl]);

	// Resolve account IDs for subscribed handles that don't have a cursor yet —
	// the first load after login, or accounts added by subscribe/import. Merges
	// into cursorsRef (never wipes existing cursors) and returns how many new
	// accounts were resolved. Only ever called from an explicit user load.
	const resolveMissingCursors = useCallback(async (): Promise<number> => {
		const missing = [...handles].filter((h) => !cursorsRef.current.has(h));
		if (missing.length === 0) return 0;

		setAccountStatuses((prev) => {
			const next = new Map(prev);
			for (const h of missing) next.set(h, "resolving");
			return next;
		});

		let resolved = 0;
		await concurrent(
			missing.map((handle) => async () => {
				const { username, instanceUrl: remoteInstanceUrl } =
					parseHandle(handle);
				const acct =
					remoteInstanceUrl === instanceUrl
						? username
						: `${username}@${new URL(remoteInstanceUrl).hostname}`;
				try {
					const account = await lookupAccount(instanceUrl, acct, accessToken);
					cursorsRef.current.set(handle, {
						accountId: account.id,
						instanceUrl,
						handle,
						done: false,
					});
					resolved++;
					setAccountStatuses((prev) => new Map(prev).set(handle, "loading"));
				} catch {
					setAccountStatuses((prev) => new Map(prev).set(handle, "failed"));
				}
			}),
			FEED_CONCURRENCY,
		);

		// Tombstone handles whose lookup failed so they aren't treated as pending
		// forever (and a later cache restore still covers them).
		for (const handle of missing) {
			if (!cursorsRef.current.has(handle)) {
				cursorsRef.current.set(handle, {
					accountId: "",
					instanceUrl,
					handle,
					done: true,
				});
			}
		}

		initializedRef.current = true;
		return resolved;
	}, [handles, instanceUrl, accessToken]);

	const poll = useCallback(async () => {
		if (pollingRef.current || loadingRef.current || !initializedRef.current)
			return;
		// Honor a 429 backoff so we stay gentle on the home instance.
		if (Date.now() < rateLimitedUntilRef.current) return;
		pollingRef.current = true;
		try {
			const { newPosts, rateLimitedUntil } = await pollFeed({
				instanceUrl,
				accessToken,
				onProgress: (done, total) => setPollProgress({ done, total }),
				// A background poll must NOT light up the initial-load dots. It
				// shares accountStatuses with the initial load, so ignore the
				// transient "loading"/"failed" a poll produces and only let a
				// success heal a failure left over from the initial load.
				onAccountStatus: (handle, status) => {
					if (status !== "done") return;
					setAccountStatuses((prev) =>
						prev.get(handle) === "failed"
							? new Map(prev).set(handle, "done")
							: prev,
					);
				},
			});
			if (rateLimitedUntil) rateLimitedUntilRef.current = rateLimitedUntil;
			// Merge only the fields pollFeed advances (sinceId/lastPolledAt) into
			// the in-memory cursors. A wholesale replace would clobber a maxId that
			// a concurrent pagination fetchMore advanced, re-fetching a loaded page.
			const refreshed = await loadCursorCache(instanceUrl);
			if (refreshed) {
				const map = cursorsRef.current;
				for (const [handle, c] of refreshed) {
					const cur = map.get(handle);
					map.set(
						handle,
						cur
							? { ...cur, sinceId: c.sinceId, lastPolledAt: c.lastPolledAt }
							: c,
					);
				}
			}
			void pushNativeSyncState(instanceUrl, accessToken);
			if (newPosts.length > 0) {
				bufferRef.current.push(...newPosts);
				setStagedCount(bufferRef.current.length);
			}
		} finally {
			pollingRef.current = false;
			setPollProgress(null);
		}
	}, [instanceUrl, accessToken]);

	const fetchMore = useCallback(async () => {
		// Don't paginate while a poll is in flight — poll refreshes cursors from
		// disk and the two would race on cursorsRef.
		if (loadingRef.current || pollingRef.current) return;
		loadingRef.current = true;
		setLoading(true);
		setError(null);

		// Resolve cursors for any subscribed handle without one yet (first load
		// after login, or accounts added by subscribe/import). This is the only
		// place resolution happens, and fetchMore only ever runs from an explicit
		// user load (pull-to-refresh / Refresh) or infinite scroll — never on its
		// own at app open.
		const resolved = await resolveMissingCursors();
		const didInit = resolved > 0;

		// On the initial build into a feed that already shows posts, stage the
		// fetched posts in the buffer ("N new") instead of inserting them while
		// the user may be reading. An empty feed has nothing to disrupt, so it
		// fills directly; pagination (older posts) also appends directly.
		const stageToBuffer = didInit && postsRef.current.length > 0;
		const collected: mastodon.v1.Status[] = [];

		try {
			const pending = [...cursorsRef.current.values()].filter(
				(c) => !c.done && c.accountId,
			);
			if (pending.length === 0) return;
			let completed = 0;

			await concurrent(
				pending.map((cursor) => async () => {
					try {
						const results = await fetchAccountStatuses(
							cursor.instanceUrl,
							cursor.accountId,
							{ limit: PAGE_SIZE, maxId: cursor.maxId },
							accessToken,
						);
						if (results.length > 0) {
							cursorsRef.current.set(cursor.handle, {
								...cursor,
								done: results.length < PAGE_SIZE,
								maxId: results[results.length - 1].id,
								sinceId: cursor.sinceId ?? results[0].id,
							});
							if (stageToBuffer) collected.push(...results);
							else pendingRef.current.push(...results);
						} else {
							cursorsRef.current.set(cursor.handle, { ...cursor, done: true });
						}
						setAccountStatuses((prev) =>
							new Map(prev).set(cursor.handle, "done"),
						);
					} catch {
						setAccountStatuses((prev) =>
							new Map(prev).set(cursor.handle, "failed"),
						);
					}
					completed++;
					if (!stageToBuffer && completed % FLUSH_EVERY === 0) flush();
				}),
				FEED_CONCURRENCY,
			);

			if (stageToBuffer) {
				const known = new Set([
					...postsRef.current.map((p) => p.id),
					...bufferRef.current.map((p) => p.id),
				]);
				const fresh = collected.filter((p) => !known.has(p.id));
				if (fresh.length > 0) {
					bufferRef.current.push(...fresh);
					setStagedCount(bufferRef.current.length);
				}
			} else {
				flush(); // final flush for any remainder
			}
		} catch (e) {
			setError(String(e));
		} finally {
			await saveCursorCache(instanceUrl, [...cursorsRef.current.entries()]);
			void pushNativeSyncState(instanceUrl, accessToken);
			// Resolution ran for the missing accounts — refresh the count so the
			// "Load N accounts" cue clears once they're loaded.
			setUnloadedCount(
				[...handlesRef.current].filter((h) => !cursorsRef.current.has(h))
					.length,
			);
			loadingRef.current = false;
			setLoading(false);
		}
	}, [instanceUrl, accessToken, resolveMissingCursors, flush]);

	// Pull in posts the native background worker fetched while we were closed and
	// surface them as "N new". On a cold start the mount effect already adopts
	// them into the feed; this covers a warm resume where nothing remounts.
	const drainNativeResults = useCallback(async () => {
		const { added } = await consumeNativeSyncResults(instanceUrl);
		if (added <= 0) return;
		const cached = await loadPostCache(instanceUrl);
		if (!cached) return;
		const known = new Set([
			...postsRef.current.map((p) => p.id),
			...bufferRef.current.map((p) => p.id),
		]);
		const fresh = cached.filter((p) => !known.has(p.id));
		if (fresh.length > 0) {
			bufferRef.current.push(...fresh);
			setStagedCount(bufferRef.current.length);
		}
	}, [instanceUrl]);

	// Returning to the foreground drains posts the background worker fetched
	// while we were away and surfaces them as "N new". It never polls on its own
	// — opening stays instant; fresh posts come from background sync,
	// pull-to-refresh, or the Refresh button.
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState !== "visible") return;
			if (!initializedRef.current) return;
			void drainNativeResults();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [drainNativeResults]);

	// Keep the unloaded-account count fresh when subscriptions change (a
	// subscribe/import adds handles with no cursor yet). Cursor-side changes
	// (mount restore, fetchMore) update it imperatively. Skip until the mount
	// effect has settled cursor state so a reopen doesn't flash "Load N".
	useEffect(() => {
		if (!cursorsRestoredRef.current) return;
		setUnloadedCount(
			[...handles].filter((h) => !cursorsRef.current.has(h)).length,
		);
	}, [handles]);

	// The single explicit-load entry point, wired to pull-to-refresh and the
	// Refresh button. Nothing loads automatically at app open. If any subscribed
	// account hasn't been loaded yet (first load after login, or a freshly
	// subscribed/imported account) it resolves and fetches them; otherwise it
	// polls known accounts for new posts.
	const refresh = useCallback(async () => {
		if (loadingRef.current || pollingRef.current) return;
		const needLoad =
			!initializedRef.current ||
			[...handles].some((h) => !cursorsRef.current.has(h));
		if (needLoad) await fetchMore();
		else await poll();
	}, [handles, fetchMore, poll]);

	const flushBuffer = useCallback(() => {
		if (bufferRef.current.length === 0) return;

		const prevTopId = postsRef.current[0]?.id ?? null;
		setDividerPostId(null);
		pendingRef.current.push(...bufferRef.current.splice(0));
		setStagedCount(0);
		flush();
		if (prevTopId) setDividerPostId(prevTopId);
		// Tell SubscribedPage to scroll to the newest post — the user asked to see
		// the new posts. (The mount-seeded boundary divider leaves this untouched,
		// so a cold-start open never auto-scrolls.)
		setFlushNonce((n) => n + 1);
	}, [flush]);

	return {
		posts,
		loading,
		error,
		fetchMore,
		flushBuffer,
		refresh,
		accountStatuses,
		stagedCount,
		dividerPostId,
		pollProgress,
		flushNonce,
		boundaryNonce,
		unloadedCount,
	};
}
