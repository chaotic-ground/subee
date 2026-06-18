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

const SCROLL_KEY = "subee:scroll:subscribed";

const NO_ANCHOR: ScrollAnchor = { id: null, offset: 0 };

// Persisted in localStorage (not sessionStorage) so the position survives the
// WebView/process being recreated after the app sits in the background. Stored
// as a post anchor (top post id + offset into it) rather than a pixel offset,
// so it stays accurate across reloads even as content heights/images settle.
function readAnchor(): ScrollAnchor {
	try {
		const raw = localStorage.getItem(SCROLL_KEY);
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

function saveAnchor(anchor: ScrollAnchor) {
	localStorage.setItem(SCROLL_KEY, JSON.stringify(anchor));
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
	const [showImport, setShowImport] = useState(false);
	const [showAddAccount, setShowAddAccount] = useState(false);
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
	const subscribedScrollRef = useRef<HTMLDivElement>(null);
	const {
		handles,
		loading: subsLoading,
		subscribe,
		unsubscribe,
		isSubscribed,
		replaceAll,
	} = useSubscriptions();

	// Don't let the browser auto-restore scroll on reload — the feed restores its
	// own post anchor (see useRestoreScrollAnchor). The Back gesture is left to
	// its default so it closes/leaves the app rather than being intercepted.
	useEffect(() => {
		history.scrollRestoration = "manual";
	}, []);

	// Save the scroll position so it can be restored after a reload or after
	// returning to a backgrounded app. Gated on feedReady so it re-runs once the
	// scroll container actually exists — on first mount the app shows a loading
	// screen and the ref is still null.
	const feedReady = status === "authenticated" && !subsLoading && !!auth;
	useEffect(() => {
		const el = subscribedScrollRef.current;
		if (!feedReady || !el) return;
		const save = debounce(() => saveAnchor(captureAnchor(el)), 300);
		// Capture the latest position the moment the app is backgrounded, before
		// Android can dispose the WebView (debounced saves may not have fired).
		const saveOnHide = () => {
			if (document.visibilityState !== "hidden") return;
			save.cancel();
			saveAnchor(captureAnchor(el));
		};
		el.addEventListener("scroll", save, { passive: true });
		document.addEventListener("visibilitychange", saveOnHide);
		return () => {
			el.removeEventListener("scroll", save);
			document.removeEventListener("visibilitychange", saveOnHide);
			save.cancel();
		};
	}, [feedReady]);

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

	const handleImportConfirm = async (
		text: string,
		mode: "merge" | "replace",
	) => {
		const incoming = importHandles(text);
		// Merge (the default) unions with the existing list so an import can't
		// silently wipe subscriptions; Replace is the explicit destructive choice.
		const next =
			mode === "merge" ? new Set([...handles, ...incoming]) : incoming;
		await replaceAll(next);
		setShowImport(false);
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
				handles={handles}
				instanceHostname={instanceHostname}
				onLogout={handleLogout}
				onImportClick={() => setShowImport(true)}
				onAddAccountClick={() => setShowAddAccount(true)}
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
					currentCount={handles.size}
					onConfirm={handleImportConfirm}
					onCancel={() => setShowImport(false)}
				/>
			)}

			<main className="flex-1 overflow-hidden relative">
				<div
					ref={subscribedScrollRef}
					data-testid="feed"
					// biome-ignore lint/a11y/noNoninteractiveTabindex: scroll container needs keyboard focus
					tabIndex={0}
					className="absolute inset-0 overflow-y-auto outline-none"
				>
					<div className="max-w-2xl mx-auto">
						<SubscribedPage
							handles={handles}
							instanceUrl={auth.instanceUrl}
							accessToken={auth.accessToken}
							onSubscribe={handleSubscribe}
							isSubscribed={isSubscribed}
							initialAnchor={readAnchor()}
							scrollContainerRef={subscribedScrollRef}
						/>
					</div>
				</div>
			</main>
		</div>
	);
}
