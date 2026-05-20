import type { mastodon } from "masto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAccountStatuses } from "../mastodon";
import { loadCursorCache, saveCursorCache } from "../storage/cursors";
import { kvDel } from "../storage/kv";
import { loadPostCache, savePostCache } from "../storage/posts";
import { pollFeed } from "./pollFeed";

vi.mock("../mastodon", async () => {
	const actual =
		await vi.importActual<typeof import("../mastodon")>("../mastodon");
	return {
		...actual,
		fetchAccountStatuses: vi.fn(),
	};
});

const mockFetchAccountStatuses = vi.mocked(fetchAccountStatuses);

function makeStatus(id: string, createdAt: string): mastodon.v1.Status {
	return { id, createdAt } as mastodon.v1.Status;
}

const INSTANCE = "https://test.example";

describe("pollFeed", () => {
	beforeEach(async () => {
		mockFetchAccountStatuses.mockReset();
		await kvDel(`subee:cursors:${INSTANCE}`);
		await kvDel(`subee:posts:${INSTANCE}`);
	});

	it("returns empty when no cursor cache exists", async () => {
		const res = await pollFeed({
			instanceUrl: INSTANCE,
			accessToken: "tok",
		});
		expect(res).toEqual({ newPosts: [], totalPosts: 0 });
		expect(mockFetchAccountStatuses).not.toHaveBeenCalled();
	});

	it("returns empty newPosts but real totalPosts when no cursor has sinceId", async () => {
		await saveCursorCache(INSTANCE, [
			[
				"@a@test.example",
				{
					handle: "@a@test.example",
					accountId: "a1",
					instanceUrl: INSTANCE,
					done: true,
				},
			],
		]);
		await savePostCache(INSTANCE, [makeStatus("x", "2026-01-01T00:00:00Z")]);

		const res = await pollFeed({
			instanceUrl: INSTANCE,
			accessToken: "tok",
		});
		expect(res.newPosts).toEqual([]);
		expect(res.totalPosts).toBe(1);
		expect(mockFetchAccountStatuses).not.toHaveBeenCalled();
	});

	it("polls eligible cursors, updates sinceId, and merges posts", async () => {
		await saveCursorCache(INSTANCE, [
			[
				"@a@test.example",
				{
					handle: "@a@test.example",
					accountId: "a1",
					instanceUrl: INSTANCE,
					sinceId: "s1",
					done: false,
				},
			],
			[
				"@b@test.example",
				{
					handle: "@b@test.example",
					accountId: "b1",
					instanceUrl: INSTANCE,
					sinceId: "s2",
					done: false,
				},
			],
		]);
		await savePostCache(INSTANCE, [makeStatus("old1", "2026-01-01T00:00:00Z")]);

		mockFetchAccountStatuses.mockImplementation(async (_url, accountId) => {
			if (accountId === "a1")
				return [
					makeStatus("a-new", "2026-02-02T00:00:00Z"),
				] as mastodon.v1.Status[];
			if (accountId === "b1")
				return [
					makeStatus("b-new", "2026-02-03T00:00:00Z"),
				] as mastodon.v1.Status[];
			return [] as mastodon.v1.Status[];
		});

		const progressUpdates: [number, number][] = [];
		const res = await pollFeed({
			instanceUrl: INSTANCE,
			accessToken: "tok",
			onProgress: (d, t) => progressUpdates.push([d, t]),
		});

		expect(res.newPosts.map((p) => p.id).sort()).toEqual(["a-new", "b-new"]);
		expect(res.totalPosts).toBe(3);
		expect(progressUpdates[0]).toEqual([0, 2]);
		expect(progressUpdates.at(-1)).toEqual([2, 2]);

		// Cursor cache updated with new sinceId values
		const reloaded = await loadCursorCache(INSTANCE);
		const updated = new Map(reloaded ?? []);
		expect(updated.get("@a@test.example")?.sinceId).toBe("a-new");
		expect(updated.get("@b@test.example")?.sinceId).toBe("b-new");
		expect(updated.get("@a@test.example")?.lastPolledAt).toBeGreaterThan(0);

		// Posts cache contains merged + sorted output (newest first), no dupes
		const reloadedPosts = await loadPostCache(INSTANCE);
		expect(reloadedPosts?.map((p) => p.id)).toEqual(["b-new", "a-new", "old1"]);
	});

	it("treats fetch errors as no-op for that cursor", async () => {
		await saveCursorCache(INSTANCE, [
			[
				"@a@test.example",
				{
					handle: "@a@test.example",
					accountId: "a1",
					instanceUrl: INSTANCE,
					sinceId: "s1",
					done: false,
				},
			],
		]);
		mockFetchAccountStatuses.mockRejectedValue(new Error("boom"));

		const res = await pollFeed({
			instanceUrl: INSTANCE,
			accessToken: "tok",
		});
		expect(res.newPosts).toEqual([]);
		expect(res.totalPosts).toBe(0);
	});
});
