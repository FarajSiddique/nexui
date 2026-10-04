import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dismissAppleAccessNotice,
  showAppleAccessNotice,
  useAuthNoticeStore,
} from '../apps/mobile/src/features/auth/use-auth-notice-store.ts';

test('the Apple access notice is hidden until a deletion leaves Apple access behind', () => {
  assert.equal(useAuthNoticeStore.getState().appleAccessRemains, false);
  showAppleAccessNotice();
  assert.equal(useAuthNoticeStore.getState().appleAccessRemains, true);
});

test('dismissing the notice hides it', () => {
  showAppleAccessNotice();
  dismissAppleAccessNotice();
  assert.equal(useAuthNoticeStore.getState().appleAccessRemains, false);
});
