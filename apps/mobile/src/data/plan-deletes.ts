/** One request to delete a plan, as TanStack Query's mutation cache records it. */
export interface DeleteAttempt {
  id: string;
  status: 'idle' | 'pending' | 'success' | 'error';
  submittedAt: number;
}

export interface PlanDeletes {
  /** Plans whose delete is in flight: Home hides their cards. */
  deleting: string[];
  /** Plans whose latest delete failed: Home offers to try again. */
  failed: string[];
}

/**
 * Which plans Home hides and which it offers to retry, from every delete request still in the
 * mutation cache. Only each plan's latest request counts, so a retry replaces its failure, and
 * one plan's failure stays put while other plans are deleted.
 *
 * @example
 * planDeletes([
 *   { id: 'a', status: 'error', submittedAt: 1 },
 *   { id: 'b', status: 'pending', submittedAt: 2 },
 * ]);
 * // → { deleting: ['b'], failed: ['a'] }
 */
export function planDeletes(attempts: DeleteAttempt[]): PlanDeletes {
  const latest = new Map<string, DeleteAttempt>();

  for (const attempt of attempts) {
    const seen = latest.get(attempt.id);

    if (!seen || attempt.submittedAt >= seen.submittedAt) {
      latest.set(attempt.id, attempt);
    }
  }

  const settled = [...latest.values()];

  return {
    deleting: settled.filter((attempt) => attempt.status === 'pending').map((item) => item.id),
    failed: settled.filter((attempt) => attempt.status === 'error').map((item) => item.id),
  };
}
