/// <reference lib="webworker" />

import { ExpirationPlugin } from "workbox-expiration";
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";

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

self.addEventListener("periodicsync", (event) => {
	const e = event as ExtendableEvent & { tag: string };
	console.log("periodicsync", e.tag);
});
