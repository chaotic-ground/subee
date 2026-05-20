import { debounce } from "lodash";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { AddAccountOverlay } from "./components/AddAccountOverlay";
import { ImportOverlay } from "./components/ImportOverlay";
import { useAuth } from "./hooks/useAuth";
import { useSubscriptions } from "./hooks/useSubscriptions";
import { LoginPage } from "./pages/LoginPage";
import { PublicPage } from "./pages/PublicPage";
import { SubscribedPage } from "./pages/SubscribedPage";
import { importHandles } from "./store/subscriptions";

type Tab = "public" | "subscribed";

const SCROLL_KEYS: Record<Tab, string> = {
	public: "subee:scroll:public",
	subscribed: "subee:scroll:subscribed",
};

function readScroll(tab: Tab): number {
	return Number(sessionStorage.getItem(SCROLL_KEYS[tab]) ?? 0);
}

function saveScroll(tab: Tab, y: number) {
	sessionStorage.setItem(SCROLL_KEYS[tab], String(y));
}

export default function App() {
	const { auth, status, error: authError, login, logout } = useAuth();
	const [activeTab, setActiveTab] = useState<Tab>("subscribed");
	const activeTabRef = useRef<Tab>("subscribed");
	const [showImport, setShowImport] = useState(false);
	const [showAddAccount, setShowAddAccount] = useState(false);
	const [excludeSubscribed, setExcludeSubscribed] = useState(
		() => localStorage.getItem("subee:excludeSubscribed") === "true",
	);
	const publicScrollRef = useRef<HTMLDivElement>(null);
	const subscribedScrollRef = useRef<HTMLDivElement>(null);
	const {
		handles,
		loading: subsLoading,
		subscribe,
		unsubscribe,
		isSubscribed,
		replaceAll,
	} = useSubscriptions();

	// Keep a ref so the popstate closure always sees the current tab
	useEffect(() => {
		activeTabRef.current = activeTab;
	}, [activeTab]);

	// Tab-aware history navigation
	useEffect(() => {
		history.scrollRestoration = "manual";
		window.history.replaceState({ tab: "subscribed" }, "");

		const onPopState = (e: PopStateEvent) => {
			const tab = (e.state as { tab?: Tab } | null)?.tab;
			if (tab === "public" || tab === "subscribed") {
				activeTabRef.current = tab;
				setActiveTab(tab);
			} else {
				// External history: scroll to top if scrolled, otherwise let exit
				const container =
					activeTabRef.current === "public"
						? publicScrollRef.current
						: subscribedScrollRef.current;
				if (container && container.scrollTop > 0) {
					container.scrollTo({ top: 0, behavior: "smooth" });
					window.history.pushState({ tab: activeTabRef.current }, "");
				}
				// else: allow the browser to leave the app
			}
		};

		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	// Save scroll positions for page-reload restore
	useEffect(() => {
		const publicEl = publicScrollRef.current;
		const subscribedEl = subscribedScrollRef.current;
		if (!publicEl || !subscribedEl) return;
		const savePublic = debounce(
			() => saveScroll("public", publicEl.scrollTop),
			300,
		);
		const saveSubscribed = debounce(
			() => saveScroll("subscribed", subscribedEl.scrollTop),
			300,
		);
		publicEl.addEventListener("scroll", savePublic, { passive: true });
		subscribedEl.addEventListener("scroll", saveSubscribed, { passive: true });
		return () => {
			publicEl.removeEventListener("scroll", savePublic);
			subscribedEl.removeEventListener("scroll", saveSubscribed);
			savePublic.cancel();
			saveSubscribed.cancel();
		};
	}, []);

	const switchTab = (tab: Tab) => {
		window.history.pushState({ tab }, "");
		setActiveTab(tab);
		const ref = tab === "public" ? publicScrollRef : subscribedScrollRef;
		requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
	};

	const handleSubscribe = (handle: string) => {
		if (isSubscribed(handle)) {
			unsubscribe(handle);
		} else {
			subscribe(handle);
		}
	};

	const handleImportConfirm = async (text: string) => {
		const newHandles = importHandles(text);
		await replaceAll(newHandles);
		setShowImport(false);
	};

	const handleToggleExcludeSubscribed = (v: boolean) => {
		setExcludeSubscribed(v);
		localStorage.setItem("subee:excludeSubscribed", String(v));
	};

	if (status === "loading") {
		return (
			<div className="min-h-screen flex items-center justify-center text-gray-400">
				Loading...
			</div>
		);
	}

	if (status === "unauthenticated") {
		return <LoginPage onLogin={login} error={authError} />;
	}

	if (subsLoading || !auth) {
		return (
			<div className="min-h-screen flex items-center justify-center text-gray-400">
				Loading...
			</div>
		);
	}

	const instanceHostname = new URL(auth.instanceUrl).hostname;

	return (
		<div className="h-dvh flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
			<AppHeader
				activeTab={activeTab}
				onSwitch={switchTab}
				handles={handles}
				instanceHostname={instanceHostname}
				onLogout={logout}
				onImportClick={() => setShowImport(true)}
				onAddAccountClick={() => setShowAddAccount(true)}
				excludeSubscribed={excludeSubscribed}
				onToggleExcludeSubscribed={handleToggleExcludeSubscribed}
			/>

			{showAddAccount && (
				<AddAccountOverlay
					onConfirm={(handle) => {
						subscribe(handle);
						setShowAddAccount(false);
					}}
					onCancel={() => setShowAddAccount(false)}
				/>
			)}
			{showImport && (
				<ImportOverlay
					onConfirm={handleImportConfirm}
					onCancel={() => setShowImport(false)}
				/>
			)}

			<main className="flex-1 overflow-hidden relative">
				<div
					ref={subscribedScrollRef}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: scroll container needs keyboard focus
					tabIndex={0}
					className={`absolute inset-0 overflow-y-auto transition-none outline-none${activeTab !== "subscribed" ? " -translate-x-full" : ""}`}
					aria-hidden={activeTab !== "subscribed"}
				>
					<div className="max-w-2xl mx-auto">
						<SubscribedPage
							handles={handles}
							instanceUrl={auth.instanceUrl}
							accessToken={auth.accessToken}
							onSubscribe={handleSubscribe}
							isSubscribed={isSubscribed}
							initialScrollY={readScroll("subscribed")}
							scrollContainerRef={subscribedScrollRef}
						/>
					</div>
				</div>
				<div
					ref={publicScrollRef}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: scroll container needs keyboard focus
					tabIndex={0}
					className={`absolute inset-0 overflow-y-auto transition-none outline-none${activeTab !== "public" ? " -translate-x-full" : ""}`}
					aria-hidden={activeTab !== "public"}
				>
					<div className="max-w-2xl mx-auto">
						<PublicPage
							instanceUrl={auth.instanceUrl}
							accessToken={auth.accessToken}
							onSubscribe={handleSubscribe}
							isSubscribed={isSubscribed}
							initialScrollY={readScroll("public")}
							scrollContainerRef={publicScrollRef}
							excludeSubscribed={excludeSubscribed}
						/>
					</div>
				</div>
			</main>
		</div>
	);
}
