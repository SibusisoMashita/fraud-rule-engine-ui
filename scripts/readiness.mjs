const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Wait for complete HTTP 200 responses, optionally throughout an uninterrupted stable period. */
export async function waitForReady(
  url,
  {
    headers,
    stableForMs = 0,
    timeoutMs = 120_000,
    pollIntervalMs = 250,
    fetchFn = globalThis.fetch,
    now = Date.now,
    sleep = delay,
  } = {},
) {
  if (
    !Number.isInteger(stableForMs) ||
    stableForMs < 0 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs <= 0
  ) {
    throw new RangeError(
      'Readiness timings must use nonnegative whole milliseconds and positive timeout and polling intervals.',
    );
  }

  const deadline = now() + timeoutMs;
  const statuses = [];
  let healthySince;
  while (now() < deadline) {
    let healthy = false;
    let status = 'network failure';
    try {
      const response = await fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(Math.min(3_000, deadline - now())),
      });
      status = `HTTP ${response.status}`;
      try {
        await response.arrayBuffer();
        healthy = response.status === 200;
      } catch {
        status += ' (body failed)';
      }
    } catch {
      // Exception messages, response bodies and credentials are never included in diagnostics.
    }
    statuses.push(status);
    if (statuses.length > 8) statuses.shift();

    if (healthy) {
      healthySince ??= now();
      if (now() < deadline && now() - healthySince >= stableForMs) return;
    } else {
      healthySince = undefined;
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(pollIntervalMs, remaining));
  }
  throw new Error(
    `Readiness timed out after ${timeoutMs}ms; recent statuses: ${statuses.join(', ')}.`,
  );
}
