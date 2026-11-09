// ui/positionPopover.ts
// Anchoring mechanism shared by the panel's floating popovers
// (ProjectPickerList.ts, DatePickerPopover.ts): anchored by position
// (getBoundingClientRect), not by the parent container's width — must
// look the same in a narrow sidebar (~300px) and a wide tab. Preferred
// below the button, aligned to its left edge; flips above if it doesn't
// fit vertically, and clips against the window edges horizontally with a
// fixed margin. Shared by both popovers on purpose (see docs/DECISIONS.md)
// instead of each reimplementing its own anchoring.
export function positionPopover(popoverEl: HTMLElement, anchorEl: HTMLElement, maxWidth = 300): void {
	const rect = anchorEl.getBoundingClientRect();
	const margin = 8;
	const width = Math.min(maxWidth, window.innerWidth - margin * 2);
	popoverEl.style.width = `${width}px`;

	let left = rect.left;
	if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
	if (left < margin) left = margin;

	const popoverHeight = popoverEl.offsetHeight;
	let top = rect.bottom + 4;
	if (top + popoverHeight > window.innerHeight - margin) {
		top = rect.top - popoverHeight - 4;
		if (top < margin) top = margin;
	}

	popoverEl.style.left = `${left}px`;
	popoverEl.style.top = `${top}px`;

	// left/top above are window coordinates, but position: fixed is
	// resolved against the nearest ancestor with a transform, filter or
	// backdrop-filter, if any. Some themes leave one on a parent (Primary
	// keeps a transform on .modal after its slide-up animation), which
	// shifts the popover away from its button. Measure where it really
	// landed and correct by the difference.
	const placed = popoverEl.getBoundingClientRect();
	const dx = placed.left - left;
	const dy = placed.top - top;
	if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
		popoverEl.style.left = `${left - dx}px`;
		popoverEl.style.top = `${top - dy}px`;
	}
}
