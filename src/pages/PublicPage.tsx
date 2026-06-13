import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { FloatingRefreshButton } from "../components/FloatingRefreshButton";
import { PostList } from "../components/PostList";
import { usePublicTimeline } from "../hooks/usePublicTimeline";
import type { ScrollAnchor } from "../types";
import { restoreScrollAnchor } from "./restoreScrollAnchor";

interface PublicPageProps {
	instanceUrl: string;
	accessToken: string;
	onSubscribe: (handle: string) => void;
	isSubscribed: (handle: string) => boolean;
	initialAnchor: ScrollAnchor;
	scrollContainerRef: RefObject<HTMLDivElement | null>;
	excludeSubscribed: boolean;
}

export function PublicPage({
	instanceUrl,
	accessToken,
	onSubscribe,
	isSubscribed,
	initialAnchor,
	scrollContainerRef,
	excludeSubscribed,
}: PublicPageProps) {
	const { posts, loading, error, fetchMore, refresh } = usePublicTimeline(
		instanceUrl,
		accessToken,
	);

	useEffect(() => {
		fetchMore();
	}, [fetchMore]);

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

	return (
		<>
			<FloatingRefreshButton onRefresh={refresh} />
			<PostList
				posts={posts}
				excludeSubscribed={excludeSubscribed}
				loading={loading}
				error={error}
				onLoadMore={fetchMore}
				onRefresh={refresh}
				onSubscribe={onSubscribe}
				isSubscribed={isSubscribed}
				instanceUrl={instanceUrl}
				accessToken={accessToken}
				scrollContainerRef={scrollContainerRef}
			/>
		</>
	);
}
