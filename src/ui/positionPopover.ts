// ui/positionPopover.ts
// Mecanismo de anclaje compartido por los popovers flotantes del panel
// (ProjectPickerList.ts, DatePickerPopover.ts): anclado por posicion
// (getBoundingClientRect), no por ancho del contenedor padre — debe verse
// igual en sidebar estrecho (~300px) y en tab ancho. Preferido debajo del
// boton, alineado a su borde izquierdo; si no cabe verticalmente se
// voltea encima, y horizontalmente se recorta contra los bordes de la
// ventana con un margen fijo.
//
// Extraido de ProjectPickerList.ts (agosto 2026) tras el bug del
// date-picker cortandose en sidebar estrecha: DatePickerPopover.ts habia
// reimplementado su propio anclaje en vez de reutilizar este, que ya
// resolvia el mismo problema en produccion.
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
