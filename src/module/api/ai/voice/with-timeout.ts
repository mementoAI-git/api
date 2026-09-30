/** Resolve to `fallback` if `work` rejects or takes longer than `timeoutMs`. */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([work.catch(() => fallback), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
