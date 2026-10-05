import type { entities } from "misskey-js";
import { kvGet, kvGetOrMigrate, kvMigrateRaw, kvSet } from "./storage/kv";

export type MisskeyReactions = Record<string, number>;

const EMOJI_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
// Every Misskey post card asks for its reactions on mount, and the whole cached
// feed mounts at once on app open — so without this, each open re-fetched every
// note. Short enough that counts stay reasonably fresh.
const REACTIONS_CACHE_TTL = 30 * 60 * 1000; // 30 min

type ReactionsResult = {
	reactions: MisskeyReactions;
	reactionEmojis: Record<string, string>;
} | null;

const fetchingEmoji = new Map<string, Promise<string | null>>();

async function fetchLocalEmoji(
	hostname: string,
	name: string,
): Promise<string | null> {
	const cacheKey = `subee:misskey:emoji:${hostname}:${name}`;
	const cached = await kvGetOrMigrate<string>(cacheKey, EMOJI_CACHE_TTL);
	if (cached) return cached;

	const inflightKey = `${hostname}:${name}`;
	const inflight = fetchingEmoji.get(inflightKey);
	if (inflight) return inflight;

	const promise = (async () => {
		try {
			const res = await fetch(`https://${hostname}/api/emoji`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name }),
			});
			if (!res.ok) return null;
			const data = (await res.json()) as { url: string };
			await kvSet(cacheKey, data.url);
			return data.url;
		} catch {
			return null;
		} finally {
			fetchingEmoji.delete(inflightKey);
		}
	})();

	fetchingEmoji.set(inflightKey, promise);
	return promise;
}

const checkingMisskey = new Map<string, Promise<boolean>>();

async function isMisskey(hostname: string): Promise<boolean> {
	const cacheKey = `subee:misskey:is:${hostname}`;
	const cached = await kvGet<string>(cacheKey);
	if (cached !== null) return cached === "true";
	const migrated = await kvMigrateRaw(cacheKey);
	if (migrated !== null) return migrated === "true";

	const inflight = checkingMisskey.get(hostname);
	if (inflight) return inflight;

	const promise = (async () => {
		try {
			const res = await fetch(`https://${hostname}/api/meta`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			const result = res.ok;
			// Only cache a definitive server response. A thrown fetch (transient
			// network/CORS drop) must not poison the cache forever — retry later.
			await kvSet(cacheKey, String(result));
			return result;
		} catch {
			return false;
		} finally {
			checkingMisskey.delete(hostname);
		}
	})();

	checkingMisskey.set(hostname, promise);
	return promise;
}

const fetchingReactions = new Map<string, Promise<ReactionsResult>>();

export async function fetchMisskeyReactions(
	statusUrl: string,
): Promise<ReactionsResult> {
	// Most posts aren't Misskey notes; skip the cache lookup for them.
	if (!statusUrl.includes("/notes/")) return null;
	const cacheKey = `subee:misskey:reactions:${statusUrl}`;
	// Wrapped so a cached "no reactions" (null) is distinguishable from a miss.
	const cached = await kvGet<{ r: ReactionsResult }>(
		cacheKey,
		REACTIONS_CACHE_TTL,
	);
	if (cached) return cached.r;

	const inflight = fetchingReactions.get(statusUrl);
	if (inflight) return inflight;

	const promise = fetchReactionsUncached(statusUrl).then(
		async ({ result, cacheable }) => {
			if (cacheable) await kvSet(cacheKey, { r: result });
			return result;
		},
	);
	fetchingReactions.set(statusUrl, promise);
	try {
		return await promise;
	} finally {
		fetchingReactions.delete(statusUrl);
	}
}

async function fetchReactionsUncached(
	statusUrl: string,
): Promise<{ result: ReactionsResult; cacheable: boolean }> {
	const done = (result: ReactionsResult) => ({ result, cacheable: true });
	// Transient failures are retried next time; the cheap early outs (not a
	// note, not Misskey, restricted) have caches of their own.
	const transient = { result: null, cacheable: false };
	const skip = transient;
	try {
		const url = new URL(statusUrl);
		const match = url.pathname.match(/^\/notes\/([a-zA-Z0-9]+)$/);
		if (!match) return skip;

		const noteId = match[1];
		const hostname = url.hostname;

		if (!(await isMisskey(hostname))) return skip;

		const restrictedKey = `subee:misskey:restricted:${hostname}`;
		const restricted = await kvGetOrMigrate<boolean>(
			restrictedKey,
			EMOJI_CACHE_TTL,
		);
		if (restricted) return skip;

		let res: Response;
		try {
			res = await fetch(`https://${hostname}/api/notes/show`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ noteId }),
			});
		} catch {
			// Being offline says nothing about the instance — don't blacklist it
			// for a week over a dropped connection.
			if (typeof navigator !== "undefined" && navigator.onLine === false)
				return transient;
			// Network error or browser-blocked request — skip this instance for 7 days
			await kvSet(restrictedKey, true);
			return done(null);
		}
		if (!res.ok) {
			if (res.status === 400) {
				try {
					const err = await res.json();
					const errCode = err?.error?.code ?? err?.code;
					if (errCode) {
						// Valid Misskey error (e.g. CONTENT_RESTRICTED_BY_USER) — skip this instance for 7 days
						await kvSet(restrictedKey, true);
					} else {
						// Not a Misskey-format error — false-positive isMisskey, mark permanently
						await kvSet(`subee:misskey:is:${hostname}`, "false");
					}
				} catch {
					await kvSet(`subee:misskey:is:${hostname}`, "false");
				}
				return done(null);
			}
			return transient;
		}

		const note = (await res.json()) as entities.Note;
		const reactions = (note.reactions ?? {}) as MisskeyReactions;
		const reactionEmojis = {
			...((note.reactionEmojis ?? {}) as Record<string, string>),
		};

		// reactionEmojis only contains remote emojis; local emojis (name@.)
		// must be looked up individually from the instance.
		const localEmojiNames = Object.keys(reactions)
			.map((r) => r.match(/^:(.+)@\.:$/)?.[1])
			.filter((n): n is string => !!n);
		if (localEmojiNames.length > 0) {
			const urls = await Promise.all(
				localEmojiNames.map((name) => fetchLocalEmoji(hostname, name)),
			);
			for (let i = 0; i < localEmojiNames.length; i++) {
				const url = urls[i];
				if (url) reactionEmojis[`${localEmojiNames[i]}@.`] = url;
			}
		}

		if (Object.keys(reactions).length === 0) return done(null);

		return done({ reactions, reactionEmojis });
	} catch {
		return transient;
	}
}
