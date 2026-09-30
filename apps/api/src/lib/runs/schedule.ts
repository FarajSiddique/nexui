// `next/server` has no ESM export map; the `.js` path loads under Node's test runner too.
import { after } from 'next/server.js';

export type RunTask = () => Promise<void>;

type Scheduler = (task: RunTask) => void;

// Runs the task after the response is sent, inside the same function instance (spec section F).
const afterResponse: Scheduler = (task) => {
  after(task);
};

let scheduler: Scheduler = afterResponse;

/** Starts a run once the response has been sent. */
export function scheduleRun(task: RunTask): void {
  scheduler(task);
}

/**
 * Tests replace `after()`, which only works inside a Next.js request. Pass `null` to restore it.
 */
export function setRunScheduler(next: Scheduler | null): void {
  scheduler = next ?? afterResponse;
}
