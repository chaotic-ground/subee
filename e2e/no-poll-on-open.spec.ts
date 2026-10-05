import { expect, test } from "@playwright/test";
import {
	authAndSubscribe,
	CONTAINER,
	freshOnce,
	makeFresh,
	mockFeed,
	pullToRefresh,
} from "./helpers";

// Reopening from a cached feed must NOT poll on its own: opening stays instant,
// showing the cached posts with no loading pill. Fresh posts arrive only from
// background sync, pull-to-refresh, or the Refresh button.
test("does not poll on reopen — cached feed shows, no loading", async ({
	page,
}) => {
	// If an on-open poll fired, the poll (min_id) route would serve these as "N new".
	await mockFeed(page, { since: freshOnce(makeFresh(5)) });
	await authAndSubscribe(page);

	// Reopen the app (cold start). The cached feed is restored with no poll.
	await page.reload();
	const sub = page.locator(CONTAINER);
	await expect(sub.locator("[data-post-id]").first()).toBeVisible();
	// Give any (unwanted) auto-poll time to run.
	await page.waitForTimeout(800);
	// No poll happened: no progress pill, nothing staged, no loading dots, and —
	// with everything already loaded and at the top — no floating button at all.
	await expect(sub.getByTestId("fab-poll")).toHaveCount(0);
	await expect(sub.getByTestId("fab-new")).toHaveCount(0);
	await expect(sub.getByTestId("account-status-grid")).toHaveCount(0);
	await expect(sub.getByTestId("fab-refresh")).toHaveCount(0);
});

// Pull-to-refresh still polls on demand and stages the new posts as "N new",
// quietly (no initial-load dots) — opening no longer does this for you.
test("pull-to-refresh polls on demand and stages 'N new'", async ({ page }) => {
	await mockFeed(page, { since: freshOnce(makeFresh(5)) });
	await authAndSubscribe(page);

	await page.reload();
	const sub = page.locator(CONTAINER);
	await expect(sub.locator("[data-post-id]").first()).toBeVisible();

	await pullToRefresh(page);
	await expect(sub.getByTestId("fab-new")).toContainText("5 new");
	await expect(sub.getByTestId("account-status-grid")).toHaveCount(0);
});
