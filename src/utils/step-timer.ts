/**
 * Times the steps of one request ("user", "context.overview", "token") so
 * slow ones show up in the logs. Steps run in parallel are timed separately;
 * total() is wall time since the timer was made.
 */
export class StepTimer {
  private readonly began = Date.now();
  readonly steps: Record<string, number> = {};

  async time<T>(name: string, work: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await work();
    } finally {
      this.steps[name] = Date.now() - start;
    }
  }

  total(): number {
    return Date.now() - this.began;
  }
}
