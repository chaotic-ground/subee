import { describe, expect, it } from "vitest";
import { RateLimitError } from "../mastodon";
import {
	isLookupRetryDue,
	LOOKUP_RETRY_MS,
	lookupFailureTombstone,
} from "./cursors";

const H = "@a@test.example";
const I = "https://home.example";
const NOW = 1_000_000;

describe("lookupFailureTombstone", () => {
	it("retries a network failure after LOOKUP_RETRY_MS", () => {
		const t = lookupFailureTombstone(
			H,
			I,
			new TypeError("Failed to fetch"),
			NOW,
		);
		expect(t).toEqual({
			accountId: "",
			instanceUrl: I,
			handle: H,
			done: true,
			retryAt: NOW + LOOKUP_RETRY_MS,
		});
	});

	it("retries a server error after LOOKUP_RETRY_MS", () => {
		const t = lookupFailureTombstone(H, I, new Error("HTTP 502: bad"), NOW);
		expect(t.retryAt).toBe(NOW + LOOKUP_RETRY_MS);
	});

	it("waits out a 429's backoff", () => {
		const t = lookupFailureTombstone(H, I, new RateLimitError(90_000), NOW);
		expect(t.retryAt).toBe(NOW + 90_000);
	});

	it("doesn't retry an account that wasn't found", () => {
		for (const status of [404, 410]) {
			const t = lookupFailureTombstone(
				H,
				I,
				new Error(`HTTP ${status}: {"error":"Record not found"}`),
				NOW,
			);
			expect(t.retryAt).toBeUndefined();
		}
	});
});

describe("isLookupRetryDue", () => {
	const base = { accountId: "", instanceUrl: I, handle: H, done: true };

	it("is due once retryAt has passed", () => {
		expect(isLookupRetryDue({ ...base, retryAt: NOW }, NOW)).toBe(true);
		expect(isLookupRetryDue({ ...base, retryAt: NOW + 1 }, NOW)).toBe(false);
	});

	it("never retries a final tombstone or a resolved account", () => {
		expect(isLookupRetryDue(base, NOW)).toBe(false);
		expect(isLookupRetryDue({ ...base, accountId: "1", retryAt: 0 }, NOW)).toBe(
			false,
		);
	});
});
