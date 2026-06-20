import type { mastodon } from "masto";
import type { ReactNode, RefObject } from "react";
import { Component, useEffect } from "react";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { PostCard } from "./PostCard";

class PostCardErrorBoundary extends Component<
	{ children: ReactNode },
	{ hasError: boolean }
> {
	constructor(props: { children: ReactNode }) {
		super(props);
		this.state = { hasError: false };
	}
	static getDerivedStateFromError() {
		return { hasError: true };
	}
	componentDidCatch(error: unknown) {
		// A post rendered to null is invisible — surface why instead of silently
		// dropping it.
		console.warn("[subee] post failed to render:", error);
	}
	render() {
		if (this.state.hasError) return null;
		return this.props.children;
	}
}

interface PostListProps {
	posts: mastodon.v1.Status[];
	loading: boolean;
	error: string | null;
	onLoadMore: () => void;
	onRefresh: () => void;
	onSubscribe: (handle: string) => void;
	isSubscribed: (handle: string) => boolean;
	instanceUrl: string;
	accessToken: string;
	scrollContainerRef: RefObject<HTMLElement | null>;
	onMount?: () => void;
	dividerPostId?: string | null;
	onDividerRef?: (el: HTMLElement | null) => void;
}

export function PostList({
	posts,
	loading,
	error,
	onLoadMore,
	onRefresh,
	onSubscribe,
	isSubscribed,
	instanceUrl,
	accessToken,
	scrollContainerRef,
	onMount,
	dividerPostId,
	onDividerRef,
}: PostListProps) {
	useInfiniteScroll(onLoadMore, scrollContainerRef, posts.length);

	useEffect(() => {
		onMount?.();
	}, [onMount]);

	if (error && posts.length === 0) {
		return (
			<div className="p-8 text-center">
				<p className="text-red-500 mb-3 text-sm font-mono break-all">{error}</p>
				<button
					type="button"
					onClick={onRefresh}
					className="text-sm px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
				>
					Retry
				</button>
			</div>
		);
	}

	return (
		<div>
			{error && (
				<div className="px-4 py-2 text-center text-xs text-red-500 font-mono break-all">
					{error} —{" "}
					<button
						type="button"
						onClick={onRefresh}
						className="underline hover:no-underline"
					>
						retry
					</button>
				</div>
			)}
			{posts.map((status) => {
				return (
					<PostCardErrorBoundary key={status.id}>
						{dividerPostId === status.id && (
							<div
								ref={onDividerRef}
								data-divider="true"
								className="flex items-center gap-3 px-4 py-2 text-xs text-blue-400 select-none"
							>
								<div className="flex-1 h-px bg-blue-300 dark:bg-blue-700" />
								<span>New posts above</span>
								<div className="flex-1 h-px bg-blue-300 dark:bg-blue-700" />
							</div>
						)}
						<div
							data-post-id={status.id}
							style={{
								contentVisibility: "auto",
								containIntrinsicSize: "auto 400px",
							}}
						>
							<PostCard
								status={status}
								instanceUrl={instanceUrl}
								accessToken={accessToken}
								onSubscribe={onSubscribe}
								isSubscribed={isSubscribed}
							/>
						</div>
					</PostCardErrorBoundary>
				);
			})}
			{loading && (
				<div className="p-4 text-center text-gray-400">Loading...</div>
			)}
			{!loading && posts.length === 0 && (
				<div className="p-8 text-center text-gray-400">
					<p className="mb-3">No posts yet.</p>
					<button
						type="button"
						onClick={onRefresh}
						className="text-sm px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
					>
						Refresh
					</button>
				</div>
			)}
		</div>
	);
}
