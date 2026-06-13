import { expect, test } from "@playwright/test";

const INSTANCE = "https://mastodon.social";

const account = {
	id: "acc1",
	acct: "testuser",
	url: `${INSTANCE}/@testuser`,
	display_name: "Test User",
	avatar: "",
	emojis: [],
	followers_count: 0,
};

function statuses() {
	return Array.from({ length: 30 }, (_, i) => ({
		id: String(2000 - i),
		created_at: new Date(Date.UTC(2026, 0, 2) - i * 60_000).toISOString(),
		content: `<p>Post number ${i}</p>`,
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
	}));
}

test.beforeEach(async ({ page }) => {
	// Catch-all for the instance host (Misskey detection etc.) — registered
	// first so the specific routes below take precedence.
	await page.route(`${INSTANCE}/**`, (route) =>
		route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
	);
	await page.route(`${INSTANCE}/api/v1/accounts/lookup**`, (route) =>
		route.fulfill({ json: account }),
	);
	await page.route(`${INSTANCE}/api/v1/accounts/acc1/statuses**`, (route) => {
		const url = new URL(route.request().url());
		// No older pages — only the first (newest) page has content.
		if (url.searchParams.get("max_id")) return route.fulfill({ json: [] });
		return route.fulfill({ json: statuses() });
	});
});

async function authAndSubscribe(page: import("@playwright/test").Page) {
	await page.goto("/");
	await page.evaluate(() => {
		localStorage.setItem("subee:accessToken", "fake-token");
		localStorage.setItem("subee:instanceUrl", "https://mastodon.social");
	});
	await page.reload();
	await page.getByRole("button", { name: "Settings" }).click();
	await page.getByRole("button", { name: /Subscribe to account/i }).click();
	await page.getByRole("textbox").fill("@testuser@mastodon.social");
	await page.getByRole("button", { name: "Add" }).click();
	await expect(page.locator("[data-post-id]").first()).toBeVisible();
	// Let the post/cursor caches finish persisting before any reload.
	await page.waitForTimeout(600);
}

// The active subscribed tab is the scroll container with aria-hidden="false".
const CONTAINER = 'div[aria-hidden="false"]';

function topPostId(page: import("@playwright/test").Page, container: string) {
	return page.evaluate((sel) => {
		const el = document.querySelector(sel) as HTMLElement | null;
		if (!el) return null;
		const top = el.scrollTop;
		const nodes = el.querySelectorAll<HTMLElement>("[data-post-id]");
		for (const node of nodes) {
			if (node.offsetTop + node.offsetHeight > top) {
				return node.dataset.postId ?? null;
			}
		}
		return null;
	}, container);
}

test("restores scroll to the same post after a reload", async ({ page }) => {
	await authAndSubscribe(page);

	// Scroll down with a real wheel gesture, then let layout settle and the
	// debounced save run.
	await page.locator(CONTAINER).hover();
	await page.mouse.wheel(0, 3000);
	await page.waitForTimeout(600);

	// The post the app actually saved as the anchor.
	const before = await page.evaluate(() => {
		const raw = localStorage.getItem("subee:scroll:subscribed");
		return raw ? JSON.parse(raw).id : null;
	});
	expect(before).toBeTruthy();
	// It should match the post currently at the top of the viewport.
	expect(await topPostId(page, CONTAINER)).toBe(before);

	// Reload (simulates a cold start / WebView recreation) and check restore.
	await page.reload();
	await expect(page.locator("[data-post-id]").first()).toBeVisible();
	await page.waitForTimeout(800); // allow the re-align frames to run
	expect(await topPostId(page, CONTAINER)).toBe(before);
});

test("starts at the top when nothing was scrolled", async ({ page }) => {
	await authAndSubscribe(page);
	await page.reload();
	await expect(page.locator("[data-post-id]").first()).toBeVisible();
	const scrollTop = await page
		.locator(CONTAINER)
		.evaluate((el) => el.scrollTop);
	expect(scrollTop).toBe(0);
});
