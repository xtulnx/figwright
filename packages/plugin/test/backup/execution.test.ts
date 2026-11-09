import { afterEach, describe, expect, it, vi } from 'vitest';

import { RestoreExecution, RestoreInterrupted } from '../../src/backup/execution.js';

afterEach(() => {
  vi.useRealTimers();
});
describe('restore API waits', () => {
  it('cancels a stalled API without requiring its promise or a background timer to resolve', async () => {
    const execution = new RestoreExecution();
    const promise = execution.wait(new Promise<void>(() => {}), 'font unavailable');
    const rejected = promise.catch((error: unknown) => error);
    execution.cancel();
    expect(await rejected).toBeInstanceOf(RestoreInterrupted);
    expect(execution.phase).toBe('font unavailable');
    expect(() => execution.check()).toThrow('cancelled');
  });
  it('terminates all nested waits after a deadline so delayed completions cannot resume writes', async () => {
    vi.useFakeTimers();
    const execution = new RestoreExecution();
    const one = execution.wait(new Promise<void>(() => {}), 'first');
    const two = execution.wait(new Promise<void>(() => {}), 'second');
    const oneRejected = one.catch((error: unknown) => error);
    const twoRejected = two.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await oneRejected).toBeInstanceOf(RestoreInterrupted);
    expect(await twoRejected).toBeInstanceOf(RestoreInterrupted);
    expect(() => execution.check()).toThrow('30000');
  });
});
