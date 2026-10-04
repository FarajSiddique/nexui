// `next/server` has no ESM export map; the `.js` path loads under Node's test runner too.
import { after } from 'next/server.js';

export type MediaTask = () => Promise<void>;

type Scheduler = (task: MediaTask) => void;

const afterResponse: Scheduler = (task) => {
  after(task);
};

let scheduler: Scheduler = afterResponse;

/** Finishes lookups that outlast the request, once its response has been sent. */
export function scheduleMediaTask(task: MediaTask): void {
  scheduler(task);
}

/**
 * Tests replace `after()`, which only works inside a Next.js request. Pass `null` to restore it.
 */
export function setMediaScheduler(next: Scheduler | null): void {
  scheduler = next ?? afterResponse;
}
