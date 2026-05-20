import { orderBy } from "lodash";
import type { mastodon } from "masto";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	fetchAccountStatuses,
	lookupAccount,
	lsGet,
	lsSet,
	parseHandle,
} from "../mastodon";
import {
	type AccountCursor,
	loadCursorCache,
	saveCursorCache,
} from "../storage/cursors";

const PAGE_SIZE = 20;
const CONCURRENCY = 10;
const FLUSH_EVERY = 20; // update UI after every N accounts complete
const POLL_CONCURRENCY = 3;
const MAX_CACHED_POSTS = 200;
const POST_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days (matches cursor cache)

export type { AccountCursor };

export interface FeedProgress {
	done: number;
	total: number;
	phase: "resolving" | "loading";
}

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

// Run tasks with a fixed concurrency limit.
// Safe in single-threaded JS: the index increment is synchronous.
async function concurrent(
	tasks: (() => Promise<void>)[],
	limit: number,
): Promise<void> {
	let i = 0;
	const worker = async () => {
		while (i < tasks.length) {
			await tasks[i++]();
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, tasks.length) }, worker),
	);
}

export function useSubscribedFeed(
	handles: Set<string>,
	instanceUrl: string,
	accessToken: string,
) {
	const [posts, setPosts] = useState<mastodon.v1.Status[]>(
		// Restore cached posts immediately on first render
		() =>
			lsGet<mastodon.v1.Status[]>(
				`subee:posts:${instanceUrl}`,
				POST_CACHE_TTL,
			) ?? [],
	);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState<FeedProgress | null>(null);
	const [accountStatuses, setAccountStatuses] = useState<
		Map<string, AccountLoadStatus>
	>(new Map());
	const [stagedCount, setStagedCount] = useState(0);
	const [dividerPostId, setDividerPostId] = useState<string | null>(null);
	const [pollProgress, setPollProgress] = useState<PollProgress | null>(null);
	const [lastPollTime, setLastPollTime] = useState<number | null>(null);

	// Always-current mirror of posts state for use inside callbacks
	const postsRef = useRef(posts);
	postsRef.current = posts;

	const cursorsRef = useRef<Map<string, AccountCursor>>(new Map());
	const initializedRef = useRef(false);
	const loadingRef = useRef(false);
	// Buffer for progressive rendering — flushed in batches to avoid
	// running an expensive sort on every single account response.
	const pendingRef = useRef<mastodon.v1.Status[]>([]);
	// Staging buffer — posts fetched by polling, not yet visible in the feed.
	const bufferRef = useRef<mastodon.v1.Status[]>([]);
	const pollingRef = useRef(false);

	const flush = useCallback(() => {
		if (pendingRef.current.length === 0) return;
		const toAdd = pendingRef.current.splice(0);
		setPosts((prev) => {
			const all = [...prev, ...toAdd];
			const deduped = [...new Map(all.map((p) => [p.id, p])).values()];
			const sorted = orderBy(deduped, (p) => p.createdAt, "desc");
			lsSet(`subee:posts:${instanceUrl}`, sorted.slice(0, MAX_CACHED_POSTS));
			return sorted;
		});
	}, [instanceUrl]);

	const initCursors = useCallback(async () => {
		const handlesList = [...handles];
		const newCursors = new Map<string, AccountCursor>();
		let done = 0;

		setProgress({ done: 0, total: handlesList.length, phase: "resolving" });
		setAccountStatuses(
			new Map(handlesList.map((h) => [h, "resolving" as AccountLoadStatus])),
		);

		await concurrent(
			handlesList.map((handle) => async () => {
				const { username, instanceUrl: remoteInstanceUrl } =
					parseHandle(handle);
				const acct =
					remoteInstanceUrl === instanceUrl
						? username
						: `${username}@${new URL(remoteInstanceUrl).hostname}`;
				try {
					const account = await lookupAccount(instanceUrl, acct, accessToken);
					newCursors.set(handle, {
						accountId: account.id,
						instanceUrl,
						handle,
						done: false,
					});
					setAccountStatuses((prev) => new Map(prev).set(handle, "loading"));
				} catch {
					setAccountStatuses((prev) => new Map(prev).set(handle, "failed"));
				}
				setProgress({
					done: ++done,
					total: handlesList.length,
					phase: "resolving",
				});
			}),
			CONCURRENCY,
		);

		// Save tombstones for failed lookups so cache restore can pass allCovered check
		for (const handle of handlesList) {
			if (!newCursors.has(handle)) {
				newCursors.set(handle, {
					accountId: "",
					instanceUrl,
					handle,
					done: true,
				});
			}
		}

		cursorsRef.current = newCursors;
		initializedRef.current = true;
	}, [handles, instanceUrl, accessToken]);

	const poll = useCallback(async () => {
		if (pollingRef.current || loadingRef.current || !initializedRef.current)
			return;
		pollingRef.current = true;
		try {
			const cursors = [...cursorsRef.current.values()]
				.filter((c) => c.sinceId)
				.sort((a, b) => (a.lastPolledAt ?? 0) - (b.lastPolledAt ?? 0));
			if (cursors.length === 0) return;
			let done = 0;
			setPollProgress({ done: 0, total: cursors.length });
			const cycleBuffer: mastodon.v1.Status[] = [];
			await concurrent(
				cursors.map((cursor) => async () => {
					try {
						const results = await fetchAccountStatuses(
							cursor.instanceUrl,
							cursor.accountId,
							{ sinceId: cursor.sinceId, limit: PAGE_SIZE },
							accessToken,
						);
						cursorsRef.current.set(cursor.handle, {
							...cursor,
							...(results.length > 0 && { sinceId: results[0].id }),
							lastPolledAt: Date.now(),
						});
						if (results.length > 0) {
							cycleBuffer.push(...results);
						}
					} catch {
						// silently ignore poll errors
					}
					setPollProgress({ done: ++done, total: cursors.length });
				}),
				POLL_CONCURRENCY,
			);
			if (cycleBuffer.length > 0) {
				bufferRef.current.push(...cycleBuffer);
				setStagedCount(bufferRef.current.length);
			}
		} finally {
			pollingRef.current = false;
			setPollProgress(null);
			setLastPollTime(Date.now());
		}
	}, [accessToken]);

	const triggerPoll = useCallback(() => {
		poll();
	}, [poll]);

	const fetchMore = useCallback(async () => {
		if (loadingRef.current) return;
		loadingRef.current = true;
		setLoading(true);
		setError(null);

		if (!initializedRef.current) {
			// Try to restore cursors from cache (IDB; migrates legacy localStorage)
			const cachedCursors = await loadCursorCache(instanceUrl);
			if (!cachedCursors) {
				console.warn(
					"[subee] cursor cache not found or expired for",
					instanceUrl,
				);
			}
			if (cachedCursors) {
				const cursorMap = new Map(cachedCursors);
				const missingHandles = [...handles].filter((h) => !cursorMap.has(h));
				const allCovered = missingHandles.length === 0;
				if (!allCovered) {
					console.warn(
						"[subee] cursor cache miss — missing handles:",
						missingHandles,
					);
				}
				if (allCovered) {
					// Mark all cursors done so page refresh is instant with no API
					// calls. sinceId is preserved so polling can still fetch new posts.
					cursorsRef.current = new Map(
						[...cursorMap.entries()].map(([h, c]) => [h, { ...c, done: true }]),
					);
					initializedRef.current = true;
					const maxLastPolledAt = Math.max(
						...[...cursorMap.values()].map((c) => c.lastPolledAt ?? 0),
					);
					if (maxLastPolledAt > 0) setLastPollTime(maxLastPolledAt);
					loadingRef.current = false;
					setLoading(false);
					return;
				}
			}
			await initCursors();
		}

		try {
			const pending = [...cursorsRef.current.values()].filter((c) => !c.done);
			if (pending.length === 0) return;
			let completed = 0;

			setProgress({ done: 0, total: pending.length, phase: "loading" });

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
							pendingRef.current.push(...results);
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
					setProgress({
						done: completed,
						total: pending.length,
						phase: "loading",
					});
					if (completed % FLUSH_EVERY === 0) flush();
				}),
				CONCURRENCY,
			);

			flush(); // final flush for any remainder
		} catch (e) {
			setError(String(e));
		} finally {
			await saveCursorCache(instanceUrl, [...cursorsRef.current.entries()]);
			loadingRef.current = false;
			setLoading(false);
			setProgress(null);
		}
	}, [handles, instanceUrl, accessToken, initCursors, flush, poll]);

	const flushBuffer = useCallback(() => {
		if (bufferRef.current.length === 0) return;

		const prevTopId = postsRef.current[0]?.id ?? null;
		setDividerPostId(null);
		pendingRef.current.push(...bufferRef.current.splice(0));
		setStagedCount(0);
		flush();
		if (prevTopId) setDividerPostId(prevTopId);
	}, [flush]);

	return {
		posts,
		loading,
		error,
		progress,
		fetchMore,
		flushBuffer,
		triggerPoll,
		accountStatuses,
		stagedCount,
		dividerPostId,
		pollProgress,
		lastPollTime,
	};
}
