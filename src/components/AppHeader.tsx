import {
	faCog,
	faFileImport,
	faPlus,
	faShareFromSquare,
	faSignOutAlt,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { exportHandles } from "../store/subscriptions";

type Tab = "public" | "subscribed";

interface AppHeaderProps {
	activeTab: Tab;
	onSwitch: (tab: Tab) => void;
	handles: Set<string>;
	instanceHostname: string;
	onLogout: () => void;
	onImportClick: () => void;
	onAddAccountClick: () => void;
	excludeSubscribed: boolean;
	onToggleExcludeSubscribed: (v: boolean) => void;
	bgSyncSupported: boolean;
	bgSyncEnabled: boolean;
	onToggleBgSync: (v: boolean) => void;
}

export function AppHeader({
	activeTab,
	onSwitch,
	handles,
	instanceHostname,
	onLogout,
	onImportClick,
	onAddAccountClick,
	excludeSubscribed,
	onToggleExcludeSubscribed,
	bgSyncSupported,
	bgSyncEnabled,
	onToggleBgSync,
}: AppHeaderProps) {
	const [showMenu, setShowMenu] = useState(false);
	const [copied, setCopied] = useState(false);
	const [confirmingLogout, setConfirmingLogout] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setShowMenu(false);
				setConfirmingLogout(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(exportHandles(handles));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const tabClass = (tab: Tab) =>
		`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
			activeTab === tab
				? "border-blue-500 text-blue-500"
				: "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
		}`;

	return (
		<header className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 z-40">
			<div className="max-w-2xl mx-auto">
				<div className="flex items-center">
					<h1 className="text-lg font-bold px-4 py-3 flex-shrink-0">subee</h1>
					<nav className="flex flex-1">
						<button
							type="button"
							onClick={() => onSwitch("subscribed")}
							className={tabClass("subscribed")}
						>
							Subscribed
							{handles.size > 0 && (
								<span className="ml-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 rounded-full px-1.5">
									{handles.size}
								</span>
							)}
						</button>
						<button
							type="button"
							onClick={() => onSwitch("public")}
							className={tabClass("public")}
						>
							Home
						</button>
					</nav>
					<div ref={menuRef} className="relative flex-shrink-0 px-2">
						<button
							type="button"
							onClick={() => setShowMenu((v) => !v)}
							title="Settings"
							aria-label="Settings"
							className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
						>
							<FontAwesomeIcon icon={faCog} />
						</button>
						{showMenu && (
							<div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 min-w-max">
								<div className="px-4 py-2 text-xs text-gray-400 border-b border-gray-200 dark:border-gray-700">
									{instanceHostname}
								</div>
								<button
									type="button"
									onClick={() => {
										handleCopy();
										setShowMenu(false);
									}}
									className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
								>
									<FontAwesomeIcon
										icon={faShareFromSquare}
										className={copied ? "text-green-500" : ""}
									/>
									{copied ? "Copied!" : "Export subscriptions"}
								</button>
								<button
									type="button"
									onClick={() => {
										onImportClick();
										setShowMenu(false);
									}}
									className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
								>
									<FontAwesomeIcon icon={faFileImport} />
									Import subscriptions
								</button>
								<button
									type="button"
									onClick={() => {
										onAddAccountClick();
										setShowMenu(false);
									}}
									className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
								>
									<FontAwesomeIcon icon={faPlus} />
									Subscribe to account
								</button>
								<label className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
									<input
										type="checkbox"
										checked={excludeSubscribed}
										onChange={(e) =>
											onToggleExcludeSubscribed(e.target.checked)
										}
									/>
									Exclude subscribed
								</label>
								{bgSyncSupported && (
									<label className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
										<input
											type="checkbox"
											checked={bgSyncEnabled}
											onChange={(e) => onToggleBgSync(e.target.checked)}
										/>
										Background sync
									</label>
								)}
								<div className="border-t border-gray-200 dark:border-gray-700">
									{confirmingLogout ? (
										<div className="flex items-center gap-2 px-4 py-2 text-sm">
											<span className="text-gray-500 flex-1">Log out?</span>
											<button
												type="button"
												onClick={() => {
													onLogout();
													setShowMenu(false);
													setConfirmingLogout(false);
												}}
												className="text-red-500 font-medium hover:underline"
											>
												Yes
											</button>
											<button
												type="button"
												onClick={() => setConfirmingLogout(false)}
												className="text-gray-400 hover:underline"
											>
												Cancel
											</button>
										</div>
									) : (
										<button
											type="button"
											onClick={() => setConfirmingLogout(true)}
											className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-red-500"
										>
											<FontAwesomeIcon icon={faSignOutAlt} />
											Log out
										</button>
									)}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</header>
	);
}
