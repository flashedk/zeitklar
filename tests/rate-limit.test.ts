import test from 'node:test';
import assert from 'node:assert/strict';
import { createFailureLimiter } from '../src/lib/server/rate-limit';

test('only failed attempts count toward the limit and success clears it', () => {
  const limiter = createFailureLimiter(3, 1000);
  for (let i = 0; i < 2; i++) limiter.fail('a', 0);
  assert.equal(limiter.blocked('a', 0), false);
  limiter.succeed('a');
  for (let i = 0; i < 3; i++) limiter.fail('a', 0);
  assert.equal(limiter.blocked('a', 10), true);
  assert.equal(limiter.blocked('b', 10), false);
});

test('the block expires after the window', () => {
  const limiter = createFailureLimiter(1, 1000);
  limiter.fail('a', 0);
  assert.equal(limiter.blocked('a', 999), true);
  assert.equal(limiter.blocked('a', 1000), false);
  limiter.fail('a', 1000);
  assert.equal(limiter.blocked('a', 1500), true);
});

test('tracked addresses stay bounded', () => {
  const limiter = createFailureLimiter(1, 60_000, 100);
  for (let i = 0; i < 1000; i++) limiter.fail(`ip${i}`, 0);
  assert.equal(limiter.blocked('ip999', 1), true);
  assert.equal(limiter.blocked('ip0', 1), false);
});
