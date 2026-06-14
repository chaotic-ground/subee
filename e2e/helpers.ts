import { expect, type Page } from "@playwright/test";

export const INSTANCE = "https://mastodon.social";
// The active subscribed tab is the scroll container with aria-hidden="false".
export const CONTAINER = 'div[aria-hidden="false"]';
export const BASE = Date.UTC(2026, 0, 2);

export const account = {
	id: "acc1",
	acct: "testuser",
	url: `${INSTANCE}/@testuser`,
	display_name: "Test User",
	avatar: "",
	emojis: [],
	followers_count: 0,
};

export function makeStatus(id: number, when: number) {
	return {
		id: String(id),
		created_at: new Date(when).toISOString(),
		content: `<p>Post ${id}</p>`,
		account,
		media_attachments: [],
		emojis: [],
		reblog: null,
		favourited: false,
		reblogged: false,
		replies_count: 0,
		reblogs_count: 0,
		favourites_count: 0,
		spoiler_text: "",
		visibility: "public",
	};
}

// `count` posts, newest first, ids counting down from 2000 at BASE - i*1min.
export function makeStatuses(count: number) {
	return Array.from({ length: count }, (_, i) =>
		makeStatus(2000 - i, BASE - i * 60_000),
	);
}

// `count` NEW posts (newer than makeStatuses), ids counting up from 2001.
export function makeFresh(count: number) {
	return Array.from({ length: count }, (_, i) =>
		makeStatus(2001 + i, BASE + (i + 1) * 60_000),
	);
}

type FulfillOptions = {
	status?: number;
	contentType?: string;
	body?: string;
	json?: unknown;
};
type Responder = () => FulfillOptions;

// Register the three feed routes (catch-all 404, account lookup, account
// statuses). Pass responders for the since_id / max_id / base branches; each
// defaults to an empty array (base defaults to 30 posts). Responders are
// functions so callers can make them stateful (see freshOnce).
export async function mockFeed(
	page: Page,
	handlers: { initial?: Responder; since?: Responder; max?: Responder } = {},
) {
	await page.route(`${INSTANCE}/**`, (route) =>
		route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
	);
	await page.route(`${INSTANCE}/api/v1/accounts/lookup**`, (route) =>
		route.fulfill({ json: account }),
	);
	await page.route(`${INSTANCE}/api/v1/accounts/acc1/statuses**`, (route) => {
		const u = new URL(route.request().url());
		if (u.searchParams.get("since_id"))
			return route.fulfill((handlers.since ?? (() => ({ json: [] })))());
		if (u.searchParams.get("max_id"))
			return route.fulfill((handlers.max ?? (() => ({ json: [] })))());
		return route.fulfill(
			(handlers.initial ?? (() => ({ json: makeStatuses(30) })))(),
		);
	});
}

// A since_id responder that returns `posts` on the first poll, then [].
export function freshOnce(posts: unknown[]): Responder {
	let used = false;
	return () => {
		if (used) return { json: [] };
		used = true;
		return { json: posts };
	};
}

// Seed a fake session in localStorage. The app only checks token presence.
export async function setAuth(page: Page) {
	await page.goto("/");
	await page.evaluate(() => {
		localStorage.setItem("subee:accessToken", "fake-token");
		localStorage.setItem("subee:instanceUrl", "https://mastodon.social");
	});
	await page.reload();
}

// Authenticate and subscribe to @testuser@mastodon.social, then wait for the
// feed and let the post/cursor caches persist before any reload.
export async function authAndSubscribe(page: Page) {
	await setAuth(page);
	await page.getByRole("button", { name: "Settings" }).click();
	await page.getByRole("button", { name: /Subscribe to account/i }).click();
	await page.getByRole("textbox").fill("@testuser@mastodon.social");
	await page.getByRole("button", { name: "Add" }).click();
	await expect(page.locator("[data-post-id]").first()).toBeVisible();
	await page.waitForTimeout(600);
}
