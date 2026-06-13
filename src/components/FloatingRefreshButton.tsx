import { faArrowUp } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import type { PollProgress } from "../hooks/useSubscribedFeed";

function relativeTime(ts: number): string {
	const sec = Math.floor((Date.now() - ts) / 1000);
	if (sec < 60) return "just now";
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
	return `${Math.floor(sec / 3600)}h ago`;
}

interface FloatingRefreshButtonProps {
	onPoll?: () => void;
	onRefresh: () => void;
	stagedCount?: number;
	pollProgress?: PollProgress | null;
	lastPollTime?: number | null;
}

export function FloatingRefreshButton({
	onRefresh,
	onPoll = onRefresh,
	stagedCount = 0,
	pollProgress = null,
	lastPollTime = null,
}: FloatingRefreshButtonProps) {
	const [, tick] = useState(0);

	// Re-render every 30s to keep relative time fresh
	useEffect(() => {
		if (!lastPollTime) return;
		const id = setInterval(() => tick((n) => n + 1), 30_000);
		return () => clearInterval(id);
	}, [lastPollTime]);

	if (pollProgress) {
		return (
			<div className="fixed top-16 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-gray-700/80 text-gray-200 text-xs px-3 py-1.5 rounded-full shadow backdrop-blur-sm z-30 pointer-events-none">
				<span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
				{pollProgress.done}/{pollProgress.total}
			</div>
		);
	}

	if (stagedCount > 0) {
		return (
			<button
				type="button"
				onClick={onRefresh}
				className="fixed top-16 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium hover:bg-blue-600 transition-colors z-30"
			>
				<FontAwesomeIcon icon={faArrowUp} />
				{stagedCount} new
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={onPoll}
			className="fixed top-16 left-1/2 -translate-x-1/2 bg-gray-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium hover:bg-gray-700 transition-colors z-30"
		>
			<FontAwesomeIcon icon={faArrowUp} />
			Refresh{lastPollTime ? ` · checked ${relativeTime(lastPollTime)}` : ""}
		</button>
	);
}
