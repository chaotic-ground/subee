import { expect, test } from "@playwright/test";
import { authAndSubscribe, CONTAINER, mockFeed } from "./helpers";

test.beforeEach(async ({ page }) => {
	await mockFeed(page);
});

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

test("shows the Refresh button even at the top of the feed", async ({
	page,
}) => {
	await authAndSubscribe(page);
	// At the top (no scrolling), the floating Refresh prompt is still visible.
	const container = page.locator(CONTAINER);
	expect(await container.evaluate((el) => el.scrollTop)).toBe(0);
	await expect(container.getByTestId("fab-refresh")).toBeVisible();
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
