import type { ScrollAnchor } from "../types";

function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value;
}

/**
 * Re-align the scroll position over a few frames so late layout settling
 * (content-visibility, lazy images) doesn't leave it drifted. `compute` returns
 * the desired scrollTop given the current layout, or null to skip a frame.
 * Aborts the moment the user starts scrolling/typing so we don't yank their
 * gesture back mid-realign.
 */
function realign(el: HTMLElement, compute: () => number | null): void {
	let tries = 0;
	let cancelled = false;

	const cancel = () => {
		cancelled = true;
	};
	const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
	const stop = () => {
		for (const e of events) el.removeEventListener(e, cancel);
	};
	for (const e of events)
		el.addEventListener(e, cancel, { passive: true, once: true });

	const step = () => {
		if (cancelled) return stop();
		const want = compute();
		if (want !== null && el.scrollTop !== want) el.scrollTop = want;
		if (++tries < 10) requestAnimationFrame(step);
		else stop();
	};
	requestAnimationFrame(step);
}

/**
 * Scroll the container so the anchored post sits at the top again (plus the
 * saved offset into it).
 */
export function restoreScrollAnchor(
	el: HTMLElement,
	anchor: ScrollAnchor,
): void {
	if (!anchor.id) return;
	const selector = `[data-post-id="${cssEscape(anchor.id)}"]`;
	realign(el, () => {
		const target = el.querySelector<HTMLElement>(selector);
		return target ? target.offsetTop + anchor.offset : null;
	});
}

/**
 * Scroll the container so the "New posts above" divider sits vertically
 * centered — the cold-start-after-background-sync landing, where the unseen
 * posts are above the seam and the already-seen ones below it.
 */
export function centerScrollOnDivider(el: HTMLElement): void {
	realign(el, () => {
		const target = el.querySelector<HTMLElement>("[data-divider]");
		if (!target) return null;
		return Math.max(
			0,
			target.offsetTop - (el.clientHeight - target.offsetHeight) / 2,
		);
	});
}
