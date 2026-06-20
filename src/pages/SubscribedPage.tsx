import { faArrowsRotate } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { AccountStatusGrid } from "../components/AccountStatusGrid";
import { FloatingRefreshButton } from "../components/FloatingRefreshButton";
import { PostList } from "../components/PostList";
import { PULL_THRESHOLD, usePullToRefresh } from "../hooks/usePullToRefresh";
import { useRestoreScrollAnchor } from "../hooks/useRestoreScrollAnchor";
import { useSubscribedFeed } from "../hooks/useSubscribedFeed";
import { centerScrollOnDivider } from "./restoreScrollAnchor";
import type { ScrollAnchor } from "../types";

interface SubscribedPageProps {
	handles: Set<string>;
	instanceUrl: string;
	accessToken: string;
	onSubscribe: (handle: string) => void;
	isSubscribed: (handle: string) => boolean;
	initialAnchor: ScrollAnchor;
	scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function SubscribedPage({
	handles,
	instanceUrl,
	accessToken,
	onSubscribe,
	isSubscribed,
	initialAnchor,
	scrollContainerRef,
}: SubscribedPageProps) {
	const {
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
	} = useSubscribedFeed(handles, instanceUrl, accessToken);

	// Pull down at the top of the feed to load/refresh. Nothing loads on its own
	// — this gesture (and the Refresh button) are the only way the feed loads:
	// the first load after login, newly added accounts, and new-post polling.
	const { pullDistance, armed } = usePullToRefresh(scrollContainerRef, refresh);

	// A user-initiated flush ("N new" tap) scrolls to the newest post so the new
	// posts are what the user lands on; the divider stays as the seam below them.
	const lastFlushNonce = useRef(flushNonce);
	useEffect(() => {
		if (flushNonce === lastFlushNonce.current) return;
		lastFlushNonce.current = flushNonce;
		requestAnimationFrame(() =>
			scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" }),
		);
	}, [flushNonce, scrollContainerRef]);

	// The mount-seeded boundary divider (cold start after a background sync — the
	// "tapped the notification after hours away" case) lands the user at the seam,
	// centered: the unseen posts above the fold, the already-seen ones below. This
	// overrides scroll-anchor restore for that open (see useRestoreScrollAnchor's
	// skip below) so the two don't fight over the position.
	const lastBoundaryNonce = useRef(boundaryNonce);
	useEffect(() => {
		if (boundaryNonce === lastBoundaryNonce.current) return;
		lastBoundaryNonce.current = boundaryNonce;
		const el = scrollContainerRef.current;
		if (el) requestAnimationFrame(() => centerScrollOnDivider(el));
	}, [boundaryNonce, scrollContainerRef]);

	// Track scroll position for the floating button and the status grid:
	// - the status grid and the top-of-feed signals show only at the very top
	//   (so they never cover reading);
	// - once a full screen down, the floating button becomes a back-to-top jump.
	const [atTop, setAtTop] = useState(true);
	const [scrolledDown, setScrolledDown] = useState(false);
	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const onScroll = () => {
			setAtTop(el.scrollTop < 4);
			setScrolledDown(el.scrollTop > el.clientHeight);
		};
		onScroll();
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [scrollContainerRef]);
	// The per-account dots are an initial-load / failure indicator only. A
	// background poll over an already-loaded feed flips accounts to "loading"
	// too, but must not show the dots there — it would look like a full reload
	// (the polling pill already signals a poll). So gate on `loading` (true only
	// during an initial fetch, not a poll) plus any persistent failures.
	const statusValues = [...accountStatuses.values()];
	const showGrid =
		atTop &&
		statusValues.length > 0 &&
		(loading || statusValues.some((s) => s === "failed"));

	// Initial load is driven by useSubscribedFeed (auto-loads uninitialized
	// accounts, including after importing subscriptions).

	// Skip anchor restore when a boundary divider was seeded at mount — that open
	// centers the seam instead (the effect above), and running both would fight.
	useRestoreScrollAnchor(
		scrollContainerRef,
		initialAnchor,
		loading,
		posts.length,
		boundaryNonce > 0,
	);

	if (handles.size === 0) {
		return (
			<div className="p-8 text-center text-gray-400">
				<p className="text-lg font-medium mb-2">No subscriptions yet</p>
				<p className="text-sm">
					Click "+ Subscribe" on any post to add accounts here.
				</p>
			</div>
		);
	}

	return (
		<>
			{pullDistance > 0 && (
				<div
					data-testid="pull-indicator"
					className="fixed top-16 inset-x-0 z-30 mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-gray-700/90 text-gray-100 shadow backdrop-blur-sm"
					style={{
						transform: `translateY(${pullDistance}px)`,
						opacity: Math.min(1, pullDistance / PULL_THRESHOLD),
					}}
				>
					<FontAwesomeIcon
						icon={faArrowsRotate}
						className={armed ? "text-blue-300" : ""}
						style={{ transform: `rotate(${pullDistance * 3}deg)` }}
					/>
				</div>
			)}
			<FloatingRefreshButton
				onPoll={refresh}
				onRefresh={flushBuffer}
				stagedCount={stagedCount}
				unloadedCount={unloadedCount}
				pollProgress={pollProgress}
				atTop={atTop}
				scrolledDown={scrolledDown}
				onScrollTop={() =>
					scrollContainerRef.current?.scrollTo({
						top: 0,
						behavior: "smooth",
					})
				}
			/>
			{showGrid && <AccountStatusGrid statuses={accountStatuses} />}
			{posts.length === 0 && !loading ? (
				<div className="p-8 text-center text-gray-400">
					<p className="text-lg font-medium mb-2">Slide to load</p>
					<p className="text-sm">
						Pull down or tap Refresh to load your feed.
					</p>
				</div>
			) : (
				<PostList
					posts={posts}
					loading={loading}
					error={error}
					onLoadMore={fetchMore}
					onRefresh={flushBuffer}
					onSubscribe={onSubscribe}
					isSubscribed={isSubscribed}
					instanceUrl={instanceUrl}
					accessToken={accessToken}
					scrollContainerRef={scrollContainerRef}
					dividerPostId={dividerPostId}
				/>
			)}
		</>
	);
}
