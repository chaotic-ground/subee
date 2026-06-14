import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { AccountStatusGrid } from "../components/AccountStatusGrid";
import {
	type DividerState,
	FloatingRefreshButton,
} from "../components/FloatingRefreshButton";
import { PostList } from "../components/PostList";
import { useSubscribedFeed } from "../hooks/useSubscribedFeed";
import type { ScrollAnchor } from "../types";
import { restoreScrollAnchor } from "./restoreScrollAnchor";

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
		triggerPoll,
		accountStatuses,
		stagedCount,
		dividerPostId,
		pollProgress,
		lastPollTime,
	} = useSubscribedFeed(handles, instanceUrl, accessToken);

	const dividerRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!dividerPostId) return;
		requestAnimationFrame(() =>
			dividerRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "center",
			}),
		);
	}, [dividerPostId]);

	// Track scroll position for two affordances:
	// - the status grid shows only at the very top (so it never covers reading);
	// - the "New posts" divider's position relative to the viewport drives the
	//   refresh/jump affordances (see FloatingRefreshButton / the inline button).
	const [atTop, setAtTop] = useState(true);
	const [dividerState, setDividerState] = useState<DividerState>("none");
	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const onScroll = () => {
			setAtTop(el.scrollTop < 4);
			const divider = dividerRef.current;
			if (!dividerPostId || !divider) {
				setDividerState("none");
				return;
			}
			const top = el.scrollTop;
			const bottom = top + el.clientHeight;
			const d = divider.offsetTop;
			setDividerState(d < top ? "above" : d > bottom ? "below" : "visible");
		};
		onScroll();
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [scrollContainerRef, dividerPostId]);
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

	// Restore scroll once after the first batch of posts loads
	const restoredRef = useRef(false);
	useEffect(() => {
		if (restoredRef.current || loading || posts.length === 0) return;
		if (!initialAnchor.id) return;
		const el = scrollContainerRef.current;
		if (!el) return;
		restoredRef.current = true;
		restoreScrollAnchor(el, initialAnchor);
	}, [loading, posts.length, initialAnchor, scrollContainerRef]);

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
			<FloatingRefreshButton
				onPoll={triggerPoll}
				onRefresh={flushBuffer}
				stagedCount={stagedCount}
				pollProgress={pollProgress}
				lastPollTime={lastPollTime}
				dividerState={dividerState}
				onJump={() =>
					dividerRef.current?.scrollIntoView({
						behavior: "smooth",
						block: "center",
					})
				}
			/>
			{showGrid && <AccountStatusGrid statuses={accountStatuses} />}
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
				onDividerRef={(el) => {
					dividerRef.current = el;
				}}
				onDividerRefresh={triggerPoll}
			/>
		</>
	);
}
