import { expect, test } from "@playwright/test";
import {
	authAndSubscribe,
	CONTAINER,
	freshOnce,
	makeFresh,
	mockFeed,
} from "./helpers";

// Reopening from a cached (stale) feed should poll once automatically and stage
// the new posts as a "N new" pill, with no manual Refresh tap.
test("auto-polls on reopen and shows the 'N new' pill", async ({ page }) => {
	await mockFeed(page, { since: freshOnce(makeFresh(5)) });
	await authAndSubscribe(page);

	// Reopen the app (cold start). The cached feed is restored, then a single
	// auto-poll runs because the last poll is stale (never polled yet).
	await page.reload();
	const sub = page.locator(CONTAINER);
	await expect(sub.getByTestId("fab-new")).toBeVisible();
	await expect(sub.getByTestId("fab-new")).toContainText("5 new");
	// The background auto-poll must NOT show the initial-load dots — the cached
	// feed is already present, so it should poll quietly behind the "N new" pill.
	await expect(sub.getByTestId("account-status-grid")).toHaveCount(0);
});

// The reported bug: on reopen the auto-poll fires, and if an account is
// rate-limited (429) the dots used to pop up over the cached feed (the
// showGrid "someFailed" branch). A poll failure must stay silent now.
test("a 429 during the on-open auto-poll does not show the loading dots", async ({
	page,
}) => {
	await mockFeed(page, {
		since: () => ({ status: 429, contentType: "application/json", body: "{}" }),
	});
	await authAndSubscribe(page);

	await page.reload();
	const sub = page.locator(CONTAINER);
	// Cached feed shows instantly.
	await expect(sub.locator("[data-post-id]").first()).toBeVisible();
	// Give the auto-poll time to run and 429.
	await page.waitForTimeout(800);
	// No loading dots, and nothing staged (the poll failed, quietly).
	await expect(sub.getByTestId("account-status-grid")).toHaveCount(0);
	await expect(sub.getByTestId("fab-new")).toHaveCount(0);
});
