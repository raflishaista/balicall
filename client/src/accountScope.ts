let scope = '';
export function setAccountScope(employeeId: string | null) { scope = employeeId ? ':' + encodeURIComponent(employeeId) : ''; }
export function accountKey(key: string) { return key + scope; }
export function withAccountScope<T>(employeeId: string | null, run: () => T): T {
  const previous = scope;
  setAccountScope(employeeId);
  try { return run(); } finally { scope = previous; }
}
