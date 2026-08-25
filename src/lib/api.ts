export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json: body, ...rest } = init;
  const res = await fetch(path, {
    cache: "no-store",
    ...rest,
    ...(body !== undefined
      ? {
          method: rest.method ?? "POST",
          headers: { "content-type": "application/json", ...rest.headers },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!res.ok) {
    let code = "request_failed";
    let message: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      code = data.error ?? code;
      message = data.message;
    } catch {
      // 非 JSON 錯誤體
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}
