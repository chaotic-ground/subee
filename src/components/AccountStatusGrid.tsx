import { useState } from "react";
import type { AccountLoadStatus } from "../hooks/useSubscribedFeed";

const DOT_COLOR: Record<AccountLoadStatus, string> = {
	idle: "bg-gray-300 dark:bg-gray-600",
	resolving: "bg-yellow-400 animate-pulse",
	loading: "bg-blue-400 animate-pulse",
	done: "bg-green-400",
	failed: "bg-red-500",
};

export function AccountStatusGrid({
	statuses,
}: {
	statuses: Map<string, AccountLoadStatus>;
}) {
	const [selected, setSelected] = useState<string | null>(null);
	const entries = [...statuses.entries()];
	let resolving = 0;
	let loading = 0;
	let done = 0;
	let failed = 0;
	for (const [, s] of entries) {
		if (s === "resolving" || s === "idle") resolving++;
		else if (s === "loading") loading++;
		else if (s === "done") done++;
		else if (s === "failed") failed++;
	}

	const selectedStatus = selected ? statuses.get(selected) : null;

	return (
		<div
			data-testid="account-status-grid"
			className="px-4 py-3 border-b border-gray-200 dark:border-gray-700"
		>
			<div className="flex flex-wrap gap-1 mb-2">
				{entries.map(([handle, status]) => (
					<button
						key={handle}
						type="button"
						onClick={() =>
							setSelected((prev) => (prev === handle ? null : handle))
						}
						className={`w-3 h-3 rounded-full transition-transform hover:scale-150 focus:scale-150 focus:outline-none cursor-pointer ${DOT_COLOR[status]} ${selected === handle ? "scale-150 ring-1 ring-offset-1 ring-gray-400" : ""}`}
					/>
				))}
			</div>
			{selected && (
				<div className="text-xs mb-2 text-gray-600 dark:text-gray-300 font-mono break-all">
					{selected}
					{selectedStatus && (
						<span className="ml-2 text-gray-400">
							{selectedStatus === "resolving" && "— resolving"}
							{selectedStatus === "loading" && "— loading"}
							{selectedStatus === "done" && "— done"}
							{selectedStatus === "failed" && "— failed"}
						</span>
					)}
				</div>
			)}
			<div className="flex gap-3 text-xs text-gray-400">
				{done > 0 && (
					<span>
						<span className="text-green-500">●</span> done {done}
					</span>
				)}
				{loading > 0 && (
					<span>
						<span className="text-blue-400">●</span> loading {loading}
					</span>
				)}
				{resolving > 0 && (
					<span>
						<span className="text-yellow-400">●</span> resolving {resolving}
					</span>
				)}
				{failed > 0 && (
					<span>
						<span className="text-red-500">●</span> failed {failed}
					</span>
				)}
			</div>
		</div>
	);
}
