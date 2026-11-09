/**
 * The Figma sandbox does not require DOM AbortController. Status/cancel messages can interrupt a
 * pending font/API promise even while background timers are throttled.
 */
export class RestoreInterrupted extends Error {}

export class RestoreExecution {
  phase = 'queued';
  private reason: string | undefined;
  private readonly pending = new Set<(error: Error) => void>();

  check(): void {
    if (this.reason) throw new RestoreInterrupted(this.reason);
  }
  private stop(reason: string): void {
    this.reason = reason;
    for (const reject of this.pending) reject(new RestoreInterrupted(reason));
  }
  cancel(): void {
    this.stop('Restore cancelled');
  }
  async wait<T>(promise: Promise<T>, phase: string): Promise<T> {
    this.check();
    this.phase = phase;
    return new Promise<T>((resolve, reject) => {
      const finish = (error?: unknown, value?: T): void => {
        clearTimeout(timer);
        this.pending.delete(interrupt);
        if (error !== undefined) reject(error);
        else resolve(value as T);
      };
      const interrupt = (error: Error): void => finish(error);
      const timer = setTimeout(
        () => this.stop(`Restore API wait exceeded 30000 ms: ${phase}`),
        30_000,
      );
      this.pending.add(interrupt);
      void promise.then(
        value => finish(undefined, value),
        error => finish(error),
      );
    });
  }
}
