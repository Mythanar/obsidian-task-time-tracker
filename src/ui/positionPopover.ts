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
}
