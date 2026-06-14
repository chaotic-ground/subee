import { expect, test } from "@playwright/test";
import { authAndSubscribe, CONTAINER, mockFeed } from "./helpers";

test("the floating Refresh button shows a pressed state on tap", async ({
	page,
}) => {
	await mockFeed(page);
	await authAndSubscribe(page);

	const btn = page.locator(CONTAINER).getByTestId("fab-refresh");
	await expect(btn).toBeVisible();

	// Hover (mouse over), read the (non-pressed) background.
	const box = await btn.boundingBox();
	if (!box) throw new Error("no button box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(200);
	const hoverBg = await btn.evaluate(
		(el) => getComputedStyle(el).backgroundColor,
	);

	// Press and hold: the active state must visibly differ from hover.
	await page.mouse.down();
	await page.waitForTimeout(200); // let the 100ms transition settle
	const pressedBg = await btn.evaluate(
		(el) => getComputedStyle(el).backgroundColor,
	);
	await page.mouse.up();

	expect(pressedBg).not.toBe(hoverBg);
});
