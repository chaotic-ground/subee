import { kvGet, kvSet } from "../storage/kv";
import { FEED_SYNC_TAG } from "./feedSync";

export const BG_SYNC_ENABLED_KEY = "subee:bgSyncEnabled";
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface PeriodicSyncManager {
	register(tag: string, options?: { minInterval: number }): Promise<void>;
	unregister(tag: string): Promise<void>;
	getTags(): Promise<string[]>;
}

interface RegistrationWithPeriodicSync extends ServiceWorkerRegistration {
	periodicSync?: PeriodicSyncManager;
}

export function isPeriodicSyncSupported(): boolean {
	return (
		typeof navigator !== "undefined" &&
		"serviceWorker" in navigator &&
		typeof window !== "undefined" &&
		"PeriodicSyncManager" in window
	);
}

async function getRegistration(): Promise<RegistrationWithPeriodicSync | null> {
	if (!("serviceWorker" in navigator)) return null;
	const reg = await navigator.serviceWorker.ready;
	return reg as RegistrationWithPeriodicSync;
}

export async function registerPeriodicSync(): Promise<
	"granted" | "denied" | "unsupported"
> {
	if (!isPeriodicSyncSupported()) return "unsupported";
	try {
		const perm = await navigator.permissions.query({
			// "periodic-background-sync" is not in the standard PermissionName union
			name: "periodic-background-sync" as PermissionName,
		});
		if (perm.state !== "granted") return "denied";

		const reg = await getRegistration();
		if (!reg?.periodicSync) return "unsupported";

		await reg.periodicSync.register(FEED_SYNC_TAG, {
			minInterval: MIN_INTERVAL_MS,
		});
		return "granted";
	} catch {
		return "denied";
	}
}

export async function unregisterPeriodicSync(): Promise<void> {
	try {
		const reg = await getRegistration();
		if (!reg?.periodicSync) return;
		await reg.periodicSync.unregister(FEED_SYNC_TAG);
	} catch {
		// ignore
	}
}

export async function loadBgSyncEnabled(): Promise<boolean> {
	return (await kvGet<boolean>(BG_SYNC_ENABLED_KEY)) === true;
}

export async function saveBgSyncEnabled(enabled: boolean): Promise<void> {
	await kvSet(BG_SYNC_ENABLED_KEY, enabled);
}
