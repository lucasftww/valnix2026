// API Helper — abstracts all backend function calls to Vercel Serverless Functions.
const API_BASE_URL = '/api';

interface InvokeFunctionOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  /** Pass an AbortController.signal to cancel the request (e.g. on unmount). */
  signal?: AbortSignal;
}

/**
 * Invoke a backend function by name.
 * Returns the raw Response object for flexibility.
 */
export async function invokeFunction(
  functionName: string,
  options: InvokeFunctionOptions = {}
): Promise<Response> {
  const { method = 'POST', body, headers = {}, queryParams, signal } = options;

  let url = `${API_BASE_URL}/${functionName}`;
  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    url += `?${params.toString()}`;
  }

  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  const res = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  // Auto-handle 401 on authenticated admin calls only (not login attempts).
  // Login POST to admin-auth doesn't send x-admin-token, so it's excluded.
  const hasAdminToken = Object.keys(headers).some(k => k.toLowerCase() === "x-admin-token");
  if (res.status === 401 && hasAdminToken) {
    import("@/lib/adminAuth").then(m => m.clearAdminToken()).catch(() => {});
  }

  return res;
}

/**
 * Invoke a backend function and parse JSON response.
 * Fire-and-forget variant that doesn't throw on errors.
 */
export async function invokeFunctionFireAndForget(
  functionName: string,
  body: any
): Promise<void> {
  try {
    const response = await invokeFunction(functionName, { body });
    if (!response.ok && import.meta.env.DEV) {
      console.warn(`⚠️ ${functionName} failed:`, response.status);
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`⚠️ ${functionName} error:`, e);
  }
}
