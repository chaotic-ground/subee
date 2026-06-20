import { type RefObject, useEffect, useRef } from "react";
import { restoreScrollAnchor } from "../pages/restoreScrollAnchor";
import type { ScrollAnchor } from "../types";

/**
 * Restore the saved scroll anchor once, after the first batch of posts has
 * loaded.
 */
export function useRestoreScrollAnchor(
	scrollContainerRef: RefObject<HTMLElement | null>,
	initialAnchor: ScrollAnchor,
	loading: boolean,
	postsLength: number,
	skip = false,
): void {
	const restoredRef = useRef(false);
	useEffect(() => {
		if (skip || restoredRef.current || loading || postsLength === 0) return;
		if (!initialAnchor.id) return;
		const el = scrollContainerRef.current;
		if (!el) return;
		restoredRef.current = true;
		restoreScrollAnchor(el, initialAnchor);
	}, [loading, postsLength, initialAnchor, scrollContainerRef, skip]);
}
