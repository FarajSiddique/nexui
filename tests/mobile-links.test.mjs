import assert from 'node:assert/strict';
import test from 'node:test';

import { openableUrl } from '../apps/mobile/src/lib/links.ts';

test('only https and mailto links open, as the URL they parse to', () => {
  assert.equal(
    openableUrl('https://apply.example.net/jobs/1?ref=x'),
    'https://apply.example.net/jobs/1?ref=x',
  );
  assert.equal(
    openableUrl('https://jobs.example.com\\@evil.example/x'),
    'https://jobs.example.com/@evil.example/x',
  );
  assert.equal(
    openableUrl('mailto:a@b.example?subject=Hi&body=x%0D%0Ay'),
    'mailto:a@b.example?subject=Hi&body=x%0D%0Ay',
  );
  assert.equal(openableUrl('mailto:?body=Hi'), 'mailto:?body=Hi');

  for (const refused of [
    'http://apply.example.net/jobs/1',
    'tel:+441234567890',
    'javascript:alert(1)',
    'file:///etc/hosts',
    'not a url',
    '',
  ]) {
    assert.equal(openableUrl(refused), null, refused);
  }
});
