import { debounce } from "lodash";
import { useEffect, useRef, useState } from "react";
import { AddAccountOverlay } from "./components/AddAccountOverlay";
import { AppHeader } from "./components/AppHeader";
import { ImportOverlay } from "./components/ImportOverlay";
import { useAuth } from "./hooks/useAuth";
import { useSubscriptions } from "./hooks/useSubscriptions";
import {
	clearNativeSyncState,
	getNativeBackgroundSync,
	isAndroidApp,
	pushNativeSyncState,
	setNativeBackgroundSync,
} from "./native/android";
import { LoginPage } from "./pages/LoginPage";
import { PublicPage } from "./pages/PublicPage";
import { SubscribedPage } from "./pages/SubscribedPage";
import { importHandles } from "./store/subscriptions";
import {
	isPeriodicSyncSupported,
	loadBgSyncEnabled,
	registerPeriodicSync,
	saveBgSyncEnabled,
	unregisterPeriodicSync,
} from "./sync/registerPeriodicSync";
import type { ScrollAnchor } from "./types";

type Tab = "public" | "subscribed";

const SCROLL_KEYS: Record<Tab, string> = {
	public: "subee:scroll:public",
	subscribed: "subee:scroll:subscribed",
};

const NO_ANCHOR: ScrollAnchor = { id: null, offset: 0 };

// Persisted in localStorage (not sessionStorage) so the position survives the
// WebView/process being recreated after the app sits in the background. Stored
// as a post anchor (top post id + offset into it) rather than a pixel offset,
// so it stays accurate across reloads even as content heights/images settle.
function readAnchor(tab: Tab): ScrollAnchor {
	try {
		const raw = localStorage.getItem(SCROLL_KEYS[tab]);
		if (!raw) return NO_ANCHOR;
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && "id" in parsed) {
			return { id: parsed.id ?? null, offset: Number(parsed.offset) || 0 };
		}
	} catch {
		// legacy/invalid value — start from the top
	}
	return NO_ANCHOR;
}

function saveAnchor(tab: Tab, anchor: ScrollAnchor) {
	localStorage.setItem(SCROLL_KEYS[tab], JSON.stringify(anchor));
}

// The post at the top of the viewport plus how far it's scrolled past.
function captureAnchor(el: HTMLElement): ScrollAnchor {
	const top = el.scrollTop;
	if (top <= 0) return NO_ANCHOR;
	const nodes = el.querySelectorAll<HTMLElement>("[data-post-id]");
	for (const node of nodes) {
		if (node.offsetTop + node.offsetHeight > top) {
			return {
				id: node.dataset.postId ?? null,
				offset: Math.round(top - node.offsetTop),
			};
		}
	}
	return NO_ANCHOR;
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
	const androidApp = isAndroidApp();
	const bgSyncSupported = androidApp || isPeriodicSyncSupported();
	const [bgSyncEnabled, setBgSyncEnabled] = useState(false);

	useEffect(() => {
		if (!bgSyncSupported) return;
		if (androidApp) {
			// Native WorkManager scheduling is the source of truth on Android
			setBgSyncEnabled(getNativeBackgroundSync());
			return;
		}
		let cancelled = false;
		(async () => {
			const enabled = await loadBgSyncEnabled();
			if (cancelled) return;
			setBgSyncEnabled(enabled);
			if (enabled) await registerPeriodicSync();
		})();
		return () => {
			cancelled = true;
		};
	}, [bgSyncSupported, androidApp]);

	// Keep the native poller's auth in sync with the web session
	useEffect(() => {
		if (auth) void pushNativeSyncState(auth.instanceUrl, auth.accessToken);
	}, [auth]);

	const handleToggleBgSync = async (v: boolean) => {
		if (androidApp) {
			setNativeBackgroundSync(v);
			setBgSyncEnabled(v);
			return;
		}
		setBgSyncEnabled(v);
		await saveBgSyncEnabled(v);
		if (v) {
			const result = await registerPeriodicSync();
			if (result !== "granted") {
				setBgSyncEnabled(false);
				await saveBgSyncEnabled(false);
			}
		} else {
			await unregisterPeriodicSync();
		}
	};
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

	// Save scroll positions so they can be restored after a reload or after
	// returning to a backgrounded app. Gated on feedReady so it re-runs once the
	// scroll containers actually exist — on first mount the app shows a loading
	// screen and the refs are still null.
	const feedReady = status === "authenticated" && !subsLoading && !!auth;
	useEffect(() => {
		const publicEl = publicScrollRef.current;
		const subscribedEl = subscribedScrollRef.current;
		if (!feedReady || !publicEl || !subscribedEl) return;
		const savePublic = debounce(
			() => saveAnchor("public", captureAnchor(publicEl)),
			300,
		);
		const saveSubscribed = debounce(
			() => saveAnchor("subscribed", captureAnchor(subscribedEl)),
			300,
		);
		// Capture the latest position the moment the app is backgrounded, before
		// Android can dispose the WebView (debounced saves may not have fired).
		const saveOnHide = () => {
			if (document.visibilityState !== "hidden") return;
			savePublic.cancel();
			saveSubscribed.cancel();
			saveAnchor("public", captureAnchor(publicEl));
			saveAnchor("subscribed", captureAnchor(subscribedEl));
		};
		publicEl.addEventListener("scroll", savePublic, { passive: true });
		subscribedEl.addEventListener("scroll", saveSubscribed, { passive: true });
		document.addEventListener("visibilitychange", saveOnHide);
		return () => {
			publicEl.removeEventListener("scroll", savePublic);
			subscribedEl.removeEventListener("scroll", saveSubscribed);
			document.removeEventListener("visibilitychange", saveOnHide);
			savePublic.cancel();
			saveSubscribed.cancel();
		};
	}, [feedReady]);

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

	const handleLogout = () => {
		clearNativeSyncState();
		logout();
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
				onLogout={handleLogout}
				onImportClick={() => setShowImport(true)}
				onAddAccountClick={() => setShowAddAccount(true)}
				excludeSubscribed={excludeSubscribed}
				onToggleExcludeSubscribed={handleToggleExcludeSubscribed}
				bgSyncSupported={bgSyncSupported}
				bgSyncEnabled={bgSyncEnabled}
				onToggleBgSync={handleToggleBgSync}
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
							initialAnchor={readAnchor("subscribed")}
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
							initialAnchor={readAnchor("public")}
							scrollContainerRef={publicScrollRef}
							excludeSubscribed={excludeSubscribed}
						/>
					</div>
				</div>
			</main>
		</div>
	);
}
