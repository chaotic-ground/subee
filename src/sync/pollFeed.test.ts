import type { mastodon } from "masto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAccountStatuses, RateLimitError } from "../mastodon";
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

	it("polls an account that has no sinceId yet and sets one", async () => {
		// An account that had no posts at first load (or whose first fetch
		// failed) has a cursor but no sinceId. It must still be polled, or a new
		// account that starts posting later would never show up.
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
		mockFetchAccountStatuses.mockResolvedValue([
			makeStatus("a-first", "2026-02-01T00:00:00Z"),
		]);

		const res = await pollFeed({ instanceUrl: INSTANCE, accessToken: "tok" });

		expect(mockFetchAccountStatuses).toHaveBeenCalledWith(
			INSTANCE,
			"a1",
			{ limit: 20 },
			"tok",
		);
		expect(res.newPosts.map((p) => p.id)).toEqual(["a-first"]);
		const updated = new Map((await loadCursorCache(INSTANCE)) ?? []);
		expect(updated.get("@a@test.example")?.sinceId).toBe("a-first");
	});

	it("skips failed lookups and returns the cached total", async () => {
		await saveCursorCache(INSTANCE, [
			[
				"@a@test.example",
				{
					handle: "@a@test.example",
					accountId: "",
					instanceUrl: INSTANCE,
					done: true,
				},
			],
		]);
		await savePostCache(INSTANCE, [makeStatus("x", "2026-01-01T00:00:00Z")]);

		const res = await pollFeed({ instanceUrl: INSTANCE, accessToken: "tok" });

		expect(res).toEqual({ newPosts: [], totalPosts: 1 });
		expect(mockFetchAccountStatuses).not.toHaveBeenCalled();
	});

	it("neither polls nor keeps cursors of unsubscribed accounts", async () => {
		await saveCursorCache(
			INSTANCE,
			["a", "b"].map((n) => [
				`@${n}@test.example`,
				{
					handle: `@${n}@test.example`,
					accountId: `${n}1`,
					instanceUrl: INSTANCE,
					sinceId: `s-${n}`,
					done: true,
				},
			]),
		);
		mockFetchAccountStatuses.mockResolvedValue([]);

		await pollFeed({
			instanceUrl: INSTANCE,
			accessToken: "tok",
			handles: new Set(["@a@test.example"]),
		});

		expect(mockFetchAccountStatuses).toHaveBeenCalledTimes(1);
		expect(mockFetchAccountStatuses.mock.calls[0][1]).toBe("a1");
		const saved = (await loadCursorCache(INSTANCE)) ?? [];
		expect(saved.map(([h]) => h)).toEqual(["@a@test.example"]);
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

		const statuses: string[] = [];
		const res = await pollFeed({
			instanceUrl: INSTANCE,
			accessToken: "tok",
			onAccountStatus: (_h, s) => statuses.push(s),
		});
		expect(res.newPosts).toEqual([]);
		expect(res.totalPosts).toBe(0);
		// A generic error marks the account failed and does not set a backoff.
		expect(statuses).toContain("failed");
		expect(res.rateLimitedUntil).toBeUndefined();
	});

	it("backs off on 429 without flagging the account as failed", async () => {
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
		mockFetchAccountStatuses.mockRejectedValue(new RateLimitError(120_000));

		const statuses: string[] = [];
		const before = Date.now();
		const res = await pollFeed({
			instanceUrl: INSTANCE,
			accessToken: "tok",
			onAccountStatus: (_h, s) => statuses.push(s),
		});

		expect(res.newPosts).toEqual([]);
		// A 429 is a deferral, not a failure: no "failed" status (so the UI's
		// initial-load dots never light up), and a backoff window is returned.
		expect(statuses).not.toContain("failed");
		expect(res.rateLimitedUntil).toBeGreaterThanOrEqual(before + 120_000);
		expect(res.rateLimitedUntil).toBeLessThanOrEqual(Date.now() + 120_000);
	});

	it("stops polling remaining cursors once rate-limited", async () => {
		// 5 cursors, concurrency 3: the first to run 429s, so the cursors that
		// have not started yet are skipped rather than piled on.
		await saveCursorCache(
			INSTANCE,
			Array.from({ length: 5 }, (_, i) => [
				`@a${i}@test.example`,
				{
					handle: `@a${i}@test.example`,
					accountId: `id${i}`,
					instanceUrl: INSTANCE,
					sinceId: `s${i}`,
					lastPolledAt: i, // deterministic order: id0 polled first
					done: false,
				},
			]),
		);
		mockFetchAccountStatuses.mockRejectedValue(new RateLimitError(60_000));

		const res = await pollFeed({ instanceUrl: INSTANCE, accessToken: "tok" });

		expect(res.rateLimitedUntil).toBeDefined();
		// At most the initial concurrency window of requests went out; the rest
		// were skipped after the 429.
		expect(mockFetchAccountStatuses.mock.calls.length).toBeLessThan(5);
	});

	it("pages forward with min_id until it catches up, losing nothing", async () => {
		// An account posted 45 times since the last poll. min_id returns the
		// page right after the cursor (newest-first within the page), so paging
		// forward from each page's newest id walks the whole gap.
		await saveCursorCache(INSTANCE, [
			[
				"@a@test.example",
				{
					handle: "@a@test.example",
					accountId: "a1",
					instanceUrl: INSTANCE,
					sinceId: "100",
					done: true,
				},
			],
		]);
		const all = Array.from({ length: 45 }, (_, i) =>
			makeStatus(String(101 + i), "2026-02-01T00:00:00Z"),
		);
		mockFetchAccountStatuses.mockImplementation(async (_u, _a, params) => {
			const min = Number(params?.minId);
			return all
				.filter((s) => Number(s.id) > min)
				.slice(0, params?.limit ?? 20)
				.reverse();
		});

		const res = await pollFeed({ instanceUrl: INSTANCE, accessToken: "tok" });

		expect(res.newPosts).toHaveLength(45);
		expect(new Set(res.newPosts.map((p) => p.id)).size).toBe(45);
		expect(mockFetchAccountStatuses.mock.calls.map((c) => c[2])).toEqual([
			{ minId: "100", limit: 20 },
			{ minId: "120", limit: 20 },
			{ minId: "140", limit: 20 },
		]);
		const saved = new Map((await loadCursorCache(INSTANCE)) ?? []);
		expect(saved.get("@a@test.example")?.sinceId).toBe("145");
	});

	it("keeps pages fetched before a mid-paging rate limit", async () => {
		await saveCursorCache(INSTANCE, [
			[
				"@a@test.example",
				{
					handle: "@a@test.example",
					accountId: "a1",
					instanceUrl: INSTANCE,
					sinceId: "100",
					done: true,
				},
			],
		]);
		const firstPage = Array.from({ length: 20 }, (_, i) =>
			makeStatus(String(120 - i), "2026-02-01T00:00:00Z"),
		);
		mockFetchAccountStatuses
			.mockResolvedValueOnce(firstPage)
			.mockRejectedValueOnce(new RateLimitError(60_000));

		const res = await pollFeed({ instanceUrl: INSTANCE, accessToken: "tok" });

		expect(res.newPosts).toHaveLength(20);
		expect(res.rateLimitedUntil).toBeDefined();
		const saved = new Map((await loadCursorCache(INSTANCE)) ?? []);
		// The next poll resumes right after what was already fetched.
		expect(saved.get("@a@test.example")?.sinceId).toBe("120");
	});
});
