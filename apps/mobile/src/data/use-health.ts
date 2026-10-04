import { useQuery } from '@tanstack/react-query';

import { getHealth } from './api';

/** Polls `GET /api/health` every 15 s. Every tab's banner and the Account screen share it. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 15_000,
  });
}
