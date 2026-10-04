/**
 * A drivable stand-in for the connection's event bus.
 *
 * ## Why it is separate
 *
 * `PermissionProvider` subscribes to the bus and does its most consequential work
 * there: enqueueing a request as it arrives, closing one when the agent says it was
 * answered, and posting the notification. None of that ran in any test, because the
 * connection slot the preload substitutes had no `eventBus` at all — so the effect
 * returned early and the whole subscription was dead code as far as the suite could
 * tell.
 *
 * ## What is real
 *
 * Subscription order, unsubscription, and — the part worth having — the shape of the
 * stream. `emit` hands the same event object to every subscriber, in registration
 * order, and a subscriber may unsubscribe from inside its own callback without
 * affecting the subscribers after it. That last detail is not pedantry: the real
 * emitter is a `Set` under a `for...of`, and a handler that unsubscribes mid-dispatch
 * would otherwise skip the next handler only in tests.
 */

type Listener = (event: unknown) => void;

const listeners = new Set<Listener>();

export interface EventBusStub {
  onEvent: (listener: Listener) => () => void;
}

export const eventBusStub: EventBusStub = {
  onEvent(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * Deliver an event to every subscriber.
 *
 * Snapshot first, for the reason above.
 */
export function emitEvent(event: unknown): void {
  for (const listener of [...listeners]) {
    listener(event);
  }
}

/** How many subscribers there are, so a leak is assertable. */
export function eventSubscriberCount(): number {
  return listeners.size;
}

export function resetEventBus(): void {
  listeners.clear();
}
