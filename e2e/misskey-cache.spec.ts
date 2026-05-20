import { expect, test } from "@playwright/test";

const HOSTNAME = "buttersc.one";
const NOTE_URL = `https://${HOSTNAME}/notes/abc123test`;
const NOTES_SHOW_URL = `https://${HOSTNAME}/api/notes/show`;
const RESTRICTED_KEY = `subee:misskey:restricted:${HOSTNAME}`;
const IS_MISSKEY_KEY = `subee:misskey:is:${HOSTNAME}`;

async function setMisskeyTrue(page: import("@playwright/test").Page) {
	await page.evaluate(async (key) => {
		const mod = await import("/src/storage/kv.ts");
		await mod.kvSet(key, "true");
	}, IS_MISSKEY_KEY);
}

async function getKvItem<T>(
	page: import("@playwright/test").Page,
	key: string,
): Promise<T | null> {
	return page.evaluate(async (k) => {
		const mod = await import("/src/storage/kv.ts");
		return mod.kvGet(k);
	}, key);
}

test.describe("Misskey reaction caching", () => {
	test("caches restricted instance after CONTENT_RESTRICTED_BY_USER 400", async ({
		page,
	}) => {
		await page.goto("/");
		await setMisskeyTrue(page);

		let notesShowCallCount = 0;
		await page.route(NOTES_SHOW_URL, (route) => {
			notesShowCallCount++;
			route.fulfill({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({
					message: "Content restricted by user. Please sign in to view.",
					code: "CONTENT_RESTRICTED_BY_USER",
					id: "fbcc002d-37d9-4944-a6b0-d9e29f2d33ab",
				}),
			});
		});

		await page.evaluate((url) => {
			// @ts-ignore
			return window.__fetchMisskeyReactionsForTest?.(url);
		}, NOTE_URL);

		// Trigger fetchMisskeyReactions by calling it via the module
		await page.evaluate(async (url) => {
			const mod = await import("/src/misskey.ts");
			await mod.fetchMisskeyReactions(url);
		}, NOTE_URL);

		expect(notesShowCallCount).toBe(1);
		const restricted = await getKvItem<boolean>(page, RESTRICTED_KEY);
		expect(restricted).not.toBeNull();

		// Second call — should be skipped due to cache
		await page.evaluate(async (url) => {
			const mod = await import("/src/misskey.ts");
			await mod.fetchMisskeyReactions(url);
		}, NOTE_URL);

		expect(notesShowCallCount).toBe(1); // Still 1, not 2
	});

	test("caches blocked (network error) instance", async ({ page }) => {
		await page.goto("/");
		await setMisskeyTrue(page);

		let notesShowCallCount = 0;
		await page.route(NOTES_SHOW_URL, (route) => {
			notesShowCallCount++;
			route.abort("blockedbyclient");
		});

		await page.evaluate(async (url) => {
			const mod = await import("/src/misskey.ts");
			await mod.fetchMisskeyReactions(url);
		}, NOTE_URL);

		expect(notesShowCallCount).toBe(1);
		const restricted = await getKvItem<boolean>(page, RESTRICTED_KEY);
		expect(restricted).not.toBeNull();

		// Second call — should be skipped
		await page.evaluate(async (url) => {
			const mod = await import("/src/misskey.ts");
			await mod.fetchMisskeyReactions(url);
		}, NOTE_URL);

		expect(notesShowCallCount).toBe(1);
	});

	test("restricted cache persists across page reload", async ({ page }) => {
		await page.goto("/");
		await setMisskeyTrue(page);

		let callCount = 0;
		await page.route(NOTES_SHOW_URL, (route) => {
			callCount++;
			route.abort("blockedbyclient");
		});

		// First load: triggers fetch, gets blocked, saves cache
		await page.evaluate(async (url) => {
			const mod = await import("/src/misskey.ts");
			await mod.fetchMisskeyReactions(url);
		}, NOTE_URL);
		expect(callCount).toBe(1);

		// Reload (simulates page refresh)
		await page.reload();

		// After reload, restricted cache should still be there → no fetch
		await page.evaluate(async (url) => {
			const mod = await import("/src/misskey.ts");
			await mod.fetchMisskeyReactions(url);
		}, NOTE_URL);
		expect(callCount).toBe(1);
	});
});
