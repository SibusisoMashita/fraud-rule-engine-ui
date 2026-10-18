import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForReady } from './readiness.mjs';

function controlledProbe(sequence) {
  let elapsed = 0;
  let next = 0;
  const calls = [];
  const responses = [];
  return {
    calls,
    responses,
    elapsed: () => elapsed,
    advance: (milliseconds) => {
      elapsed += milliseconds;
    },
    options: {
      now: () => elapsed,
      sleep: async (milliseconds) => {
        elapsed += milliseconds;
      },
      pollIntervalMs: 10,
      fetchFn: async () => {
        calls.push(elapsed);
        const result = sequence[Math.min(next++, sequence.length - 1)];
        if (result instanceof Error) throw result;
        const response =
          typeof result === 'number' ? new Response('complete', { status: result }) : result;
        responses.push(response);
        return response;
      },
    },
  };
}

test('ordinary readiness consumes the complete first successful response', async () => {
  const probe = controlledProbe([200]);
  await waitForReady('http://disposable.test/ready', probe.options);
  assert.deepEqual(probe.calls, [0]);
  assert.equal(probe.responses[0].bodyUsed, true);
});

test('an HTTP failure after a successful probe restarts the stable period', async () => {
  const probe = controlledProbe([200, 502, 200]);
  await waitForReady('http://disposable.test/ready', {
    ...probe.options,
    stableForMs: 20,
    timeoutMs: 100,
  });
  assert.deepEqual(probe.calls, [0, 10, 20, 30, 40]);
  assert.equal(probe.elapsed(), 40);
  assert(probe.responses.every((response) => response.bodyUsed));
});

test('one successful response does not establish stable readiness', async () => {
  const probe = controlledProbe([200, 502]);
  await assert.rejects(
    waitForReady('http://disposable.test/ready', {
      ...probe.options,
      stableForMs: 20,
      timeoutMs: 40,
    }),
    /Readiness timed out after 40ms; recent statuses: HTTP 200, HTTP 502, HTTP 502, HTTP 502/,
  );
  assert.equal(probe.elapsed(), 40);
});

test('an unreachable service reaches its deadline with bounded safe diagnostics', async () => {
  const secret = 'private-credential';
  const probe = controlledProbe([new Error(`request failed with ${secret}`)]);
  await assert.rejects(
    waitForReady(`http://disposable.test/${secret}`, {
      ...probe.options,
      headers: { 'X-API-Key': secret },
      timeoutMs: 100,
    }),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes('http://'), false);
      assert.match(error.message, /Readiness timed out after 100ms/);
      assert.equal(error.message.match(/network failure/g).length, 8);
      return true;
    },
  );
  assert.equal(probe.elapsed(), 100);
});

test('a failed response body restarts readiness even when HTTP status is 200', async () => {
  const probe = controlledProbe([
    200,
    {
      status: 200,
      arrayBuffer: async () => {
        throw new Error('private body failure');
      },
    },
    200,
  ]);
  await waitForReady('http://disposable.test/ready', {
    ...probe.options,
    stableForMs: 20,
    timeoutMs: 100,
  });
  assert.deepEqual(probe.calls, [0, 10, 20, 30, 40]);
});

test('a network failure restarts the uninterrupted successful interval', async () => {
  const probe = controlledProbe([200, new Error('connection closed'), 200]);
  await waitForReady('http://disposable.test/ready', {
    ...probe.options,
    stableForMs: 20,
    timeoutMs: 100,
  });
  assert.deepEqual(probe.calls, [0, 10, 20, 30, 40]);
});

test('a response completing after the overall deadline cannot establish readiness', async () => {
  const probe = controlledProbe([]);
  await assert.rejects(
    waitForReady('http://disposable.test/ready', {
      ...probe.options,
      timeoutMs: 50,
      fetchFn: async () => {
        probe.advance(60);
        return new Response('late', { status: 200 });
      },
    }),
    /Readiness timed out after 50ms/,
  );
  assert.equal(probe.elapsed(), 60);
});
