/**
 * ARIA Mission Control — server-side event bus.
 *
 * A tiny, dependency-free pub/sub that survives hot-reload (hoisted onto
 * globalThis) and supports SSE fan-out to N concurrent subscribers.
 *
 * "ponytail" pattern: a single typed emitter is the only way events enter
 * the system; subscribers receive validated `MissionEvent` envelopes and
 * never touch raw DB rows on the wire.
 */
import type { MissionEvent } from "./types";

type Subscriber = (event: MissionEvent) => void;

interface Bus {
  subscribers: Set<Subscriber>;
  emit: (event: MissionEvent) => void;
  subscribe: (fn: Subscriber) => () => void;
}

const globalForBus = globalThis as unknown as { __ariaBus?: Bus };

function createBus(): Bus {
  const subscribers = new Set<Subscriber>();
  return {
    subscribers,
    emit(event: MissionEvent) {
      // Fan-out synchronously. Subscribers must be non-blocking; SSE
      // controllers queue writes via their own backpressure mechanism.
      for (const fn of subscribers) {
        try {
          fn(event);
        } catch {
          // A faulty subscriber must never poison the bus.
        }
      }
    },
    subscribe(fn: Subscriber) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}

export const bus: Bus = globalForBus.__ariaBus ?? createBus();
if (!globalForBus.__ariaBus) globalForBus.__ariaBus = bus;

/** Emit a typed event — the single sanctioned entry point. */
export function emit(event: MissionEvent): void {
  bus.emit(event);
}
