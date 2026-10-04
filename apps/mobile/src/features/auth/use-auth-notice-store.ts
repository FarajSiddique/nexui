import { create } from 'zustand';

interface AuthNoticeState {
  /** An account was deleted, but Nexui couldn't remove its Sign in with Apple access. */
  appleAccessRemains: boolean;
}

// Outlives the session on purpose: the Account screen sets it before the session clears, and the
// sign-in screen shows it however the session ended.
export const useAuthNoticeStore = create<AuthNoticeState>(() => ({ appleAccessRemains: false }));

export function showAppleAccessNotice(): void {
  useAuthNoticeStore.setState({ appleAccessRemains: true });
}

export function dismissAppleAccessNotice(): void {
  useAuthNoticeStore.setState({ appleAccessRemains: false });
}
