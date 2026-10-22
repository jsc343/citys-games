export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(`Request failed with ${status}`);
    this.status = status;
    this.data = data;
  }
}

async function parse(res: Response) {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export async function getJson<T>(
  url: string,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, { headers, cache: "no-store" });
  return (await parse(res)) as T;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
  return (await parse(res)) as T;
}

export function errorReason(err: unknown): string {
  if (err instanceof ApiError && err.data && typeof err.data === "object") {
    const r = (err.data as { error?: unknown }).error;
    if (typeof r === "string") return r;
  }
  return "network";
}
