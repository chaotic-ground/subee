import type { mastodon } from "masto";
import type { ReactNode, RefObject } from "react";
import { Component, useEffect } from "react";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { formatHandle } from "../mastodon";
import type { FeedProgress } from "../hooks/useSubscribedFeed";
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
	render() {
		if (this.state.hasError) return null;
		return this.props.children;
	}
}

interface PostListProps {
	posts: mastodon.v1.Status[];
	loading: boolean;
	error: string | null;
	progress?: FeedProgress | null;
	onLoadMore: () => void;
	onRefresh: () => void;
	onSubscribe: (handle: string) => void;
	isSubscribed: (handle: string) => boolean;
	instanceUrl: string;
	accessToken: string;
	scrollContainerRef: RefObject<HTMLElement | null>;
	onMount?: () => void;
	excludeSubscribed?: boolean;
	dividerPostId?: string | null;
	onDividerRef?: (el: HTMLElement | null) => void;
}

function ProgressBar({ progress }: { progress: FeedProgress }) {
	const pct =
		progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
	const label =
		progress.phase === "resolving"
			? `Resolving accounts… ${progress.done} / ${progress.total}`
			: `Loading posts… ${progress.done} / ${progress.total}`;

	return (
		<div className="px-4 py-3">
			<div className="flex justify-between text-xs text-gray-400 mb-1">
				<span>{label}</span>
				<span>{pct}%</span>
			</div>
			<div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
				<div
					className="bg-blue-500 h-1 rounded-full transition-all duration-300"
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

export function PostList({
	posts,
	loading,
	error,
	progress,
	onLoadMore,
	onRefresh,
	onSubscribe,
	isSubscribed,
	instanceUrl,
	accessToken,
	scrollContainerRef,
	onMount,
	excludeSubscribed,
	dividerPostId,
	onDividerRef,
}: PostListProps) {
	useInfiniteScroll(onLoadMore, scrollContainerRef);

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
		<div
			className={excludeSubscribed ? "[&_[data-subscribed]]:hidden" : undefined}
		>
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
				const subscribed =
					status.reblog === null && isSubscribed(formatHandle(status.account));
				return (
					<PostCardErrorBoundary key={status.id}>
						{dividerPostId === status.id && (
							<div
								ref={onDividerRef}
								className="flex items-center gap-3 px-4 py-2 text-xs text-blue-400 select-none"
							>
								<div className="flex-1 h-px bg-blue-300 dark:bg-blue-700" />
								<span>New posts</span>
								<div className="flex-1 h-px bg-blue-300 dark:bg-blue-700" />
							</div>
						)}
						<div
							data-subscribed={subscribed || undefined}
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
			{loading && progress ? (
				<ProgressBar progress={progress} />
			) : loading ? (
				<div className="p-4 text-center text-gray-400">Loading...</div>
			) : null}
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
