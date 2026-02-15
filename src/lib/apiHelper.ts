/**
 * API Helper - abstracts backend function calls.
 * Currently uses Supabase Edge Functions URLs.
 * When migrating to Firebase Cloud Functions, just change API_BASE_URL.
 * 
 * Set VITE_API_BASE_URL in .env to point to your Firebase Cloud Functions:
 * e.g. https://us-central1-valnix.cloudfunctions.net
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

interface InvokeFunctionOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
}

/**
 * Invoke a backend function by name.
 * Returns the raw Response object for flexibility.
 */
export async function invokeFunction(
  functionName: string,
  options: InvokeFunctionOptions = {}
): Promise<Response> {
  const { method = 'POST', body, headers = {}, queryParams } = options;

  let url = `${API_BASE_URL}/${functionName}`;
  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    url += `?${params.toString()}`;
  }

  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  return fetch(url, {
    method,
    headers: fetchHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
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
    if (!response.ok) {
      console.warn(`⚠️ ${functionName} failed:`, response.status);
    }
  } catch (e) {
    console.warn(`⚠️ ${functionName} error:`, e);
  }
}
