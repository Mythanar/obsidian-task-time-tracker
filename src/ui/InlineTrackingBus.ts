// ui/InlineTrackingBus.ts
// Fase 5 — UX: icono inline junto al checkbox.
// Pub/sub minimo para avisar a los controles inline (montados en modo
// Edicion via CodeMirror y en modo Lectura via post-processor) de que deben
// releer el estado de tracking y redibujarse. No lleva payload: cada
// suscriptor relee el estado fresco (getActiveEntry/getAccumulatedMs) en
// vez de recibirlo por el evento, para no duplicar logica de calculo.
export class InlineTrackingBus {
	private listeners = new Set<() => void>();

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	notify(): void {
		for (const listener of this.listeners) listener();
	}
}
