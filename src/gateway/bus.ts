// gateway 內部事件匯流排:route/引擎發佈,WS 模組(M3)訂閱後廣播給前端。
export type BusEvent = { type: string } & Record<string, unknown>;

type Sink = (tripId: string, event: BusEvent) => void;

const sinks: Sink[] = [];

export function subscribe(fn: Sink) {
  sinks.push(fn);
}

export function publish(tripId: string, event: BusEvent) {
  for (const fn of sinks) {
    try {
      fn(tripId, event);
    } catch (e) {
      console.error("[bus] sink error:", e);
    }
  }
}
