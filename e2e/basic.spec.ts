import { expect, test } from "@playwright/test";
import { setAuth } from "./helpers";

test("has title", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/subee/i);
});

test("shows login page when unauthenticated", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("button", { name: /Log in/i })).toBeVisible();
});

test("shows home and subscribed tabs when authenticated", async ({ page }) => {
	await setAuth(page);
	await expect(page.getByRole("button", { name: "Home" })).toBeVisible();
	await expect(page.getByRole("button", { name: /Subscribed/i })).toBeVisible();
});

test("can switch to subscribed tab", async ({ page }) => {
	await setAuth(page);
	await page.getByRole("button", { name: /Subscribed/i }).click();
	await expect(page.getByText("No subscriptions yet")).toBeVisible();
});
