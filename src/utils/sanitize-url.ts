const SENSITIVE_QUERY_KEYS = new Set(['sig', 'token', 'code']);
const REDACTED = '[REDACTED]';

export function sanitizeUrlForLogs(value: string): string {
  try {
    const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    const parsed = new URL(value, 'http://memento.invalid');
    for (const key of SENSITIVE_QUERY_KEYS) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, REDACTED);
    }
    return isAbsolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
}

export function redactSensitiveQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? REDACTED : value,
    ]),
  );
}
