// ui/InlineTrackingBus.ts
// Minimal pub/sub to tell inline controls (mounted in Edit mode via
// CodeMirror and in Read mode via post-processor) they must re-read the
// tracking state and redraw. Carries no payload: each subscriber
// re-reads the fresh state (getActiveEntry/getAccumulatedMs) instead of
// receiving it through the event, to avoid duplicating calculation logic.
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
