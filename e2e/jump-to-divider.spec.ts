import { expect, test } from "@playwright/test";
import {
	authAndSubscribe,
	CONTAINER,
	freshOnce,
	makeFresh,
	mockFeed,
} from "./helpers";

test("floating button jumps to the New posts divider by scroll position", async ({
	page,
}) => {
	// Enough new posts that, at the top, the divider is pushed below the viewport
	// (so the button becomes a Refresh prompt rather than a jump).
	await mockFeed(page, { since: freshOnce(makeFresh(25)) });
	await authAndSubscribe(page);

	// Scope to the active subscribed tab (the Home tab also renders a button).
	const sub = page.locator(CONTAINER);

	// Poll for new posts, then flush them to create the "New posts" divider.
	await sub.getByTestId("fab-refresh").click();
	await expect(sub.getByTestId("fab-new")).toBeVisible();
	await sub.getByTestId("fab-new").click();
	await page.waitForTimeout(800); // let the post-flush auto-scroll settle

	// At the top: the 25 new posts push the divider below the viewport →
	// floating Refresh prompt.
	await sub.hover();
	await page.mouse.wheel(0, -40000);
	await page.waitForTimeout(400);
	await expect(sub.getByTestId("fab-refresh")).toBeVisible();
	await expect(sub.getByTestId("fab-jump")).toHaveCount(0);

	// At the bottom: the divider is scrolled above the viewport → jump button.
	await page.mouse.wheel(0, 60000);
	await page.waitForTimeout(400);
	await expect(sub.getByTestId("fab-jump")).toBeVisible();

	// Tap jump → the divider becomes visible → the jump button is gone and the
	// floating Refresh is shown again (there is no inline button anymore).
	// Give the smooth-scroll + scroll-listener recompute extra room under load.
	await sub.getByTestId("fab-jump").click();
	await expect(sub.getByTestId("fab-refresh")).toBeVisible({ timeout: 10000 });
	await expect(sub.getByTestId("fab-jump")).toHaveCount(0);
});
