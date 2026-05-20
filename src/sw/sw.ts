/// <reference lib="webworker" />

import { ExpirationPlugin } from "workbox-expiration";
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { loadAuth } from "../store/auth";
import { FEED_SYNC_TAG } from "../sync/feedSync";
import { pollFeed } from "../sync/pollFeed";

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
	({ request }) => request.destination === "image",
	new CacheFirst({
		cacheName: "images",
		plugins: [
			new ExpirationPlugin({
				maxEntries: 500,
				maxAgeSeconds: 60 * 60 * 24 * 30,
			}),
		],
	}),
);

async function runFeedSync(): Promise<void> {
	try {
		const auth = await loadAuth();
		if (!auth) return;
		await pollFeed({
			instanceUrl: auth.instanceUrl,
			accessToken: auth.accessToken,
		});
	} catch {
		// silent fail — wait for the next sync
	}
}

self.addEventListener("periodicsync", (event) => {
	const e = event as ExtendableEvent & { tag: string };
	if (e.tag !== FEED_SYNC_TAG) return;
	e.waitUntil(runFeedSync());
});
