export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
      credentials: "include"
    });
  } catch {
    throw new ApiError("Could not reach CampusBid. Check that the API server is running.", 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; details?: unknown } | null;
    throw new ApiError(body?.error ?? `Request failed (${response.status}).`, response.status, body?.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
