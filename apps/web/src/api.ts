export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
    public readonly retryAfterSeconds?: number
  ) {
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
    const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
    let message = body?.error ?? `Request failed (${response.status}).`;
    if (response.status === 429 && retryAfterSeconds !== undefined) {
      const wait = retryAfterSeconds >= 60
        ? `about ${Math.ceil(retryAfterSeconds / 60)} minute${Math.ceil(retryAfterSeconds / 60) === 1 ? "" : "s"}`
        : `${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}`;
      message = `${message} Try again in ${wait}.`;
    }
    throw new ApiError(message, response.status, body?.details, retryAfterSeconds);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}
