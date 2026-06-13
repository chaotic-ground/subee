import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { AccountStatusGrid } from "../components/AccountStatusGrid";
import { FloatingRefreshButton } from "../components/FloatingRefreshButton";
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

	// Show the per-account status grid only at the top of the feed, while a load
	// (initial build or poll) has any account still working. Hidden once
	// scrolled down so it never covers what the user is reading.
	const [atTop, setAtTop] = useState(true);
	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const onScroll = () => setAtTop(el.scrollTop < 4);
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [scrollContainerRef]);
	const showGrid =
		atTop && [...accountStatuses.values()].some((s) => s !== "done");

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
			/>
		</>
	);
}
