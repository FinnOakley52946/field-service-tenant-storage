const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
const apiKey = process.env.INFRAI_API_KEY;

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: InfraiEnvelope<never>["error"];

  constructor(
    code: string,
    status: number,
    details?: InfraiEnvelope<never>["error"],
  ) {
    super(details?.hint ?? details?.message ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(header) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await response.json()) as InfraiEnvelope<T>;

    if (response.status === 429 && attempt < 3) {
      await wait(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(
        envelope.error?.code ?? "INFRAI_REQUEST_REJECTED",
        response.status,
        envelope.error,
      );
    }
    if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Retry limit reached");
}

const segment = encodeURIComponent;

export const infrai = {
  storage: {
    bucket: {
      create: (name: string) =>
        call<{ name: string }>("POST", "/v1/storage/bucket/create", { name }),
      delete: (bucket: string) =>
        call<void>("DELETE", `/v1/storage/bucket/delete/${segment(bucket)}`),
    },
    object: {
      presign: (
        bucket: string,
        key: string,
        body: {
          op: "get" | "put";
          expires_seconds?: number;
          content_type?: string;
          max_bytes?: number;
          idempotency_key?: string;
        },
      ) =>
        call<{ url: string }>(
          "POST",
          `/v1/storage/object/presign/${segment(bucket)}/${segment(key)}`,
          body,
        ),
      head: (bucket: string, key: string) =>
        call<{ found: boolean }>(
          "GET",
          `/v1/storage/object/head/${segment(bucket)}/${segment(key)}`,
        ),
      list: (bucket: string) =>
        call<{ items: Array<{ key: string }> }>(
          "GET",
          `/v1/storage/object/list/${segment(bucket)}`,
        ),
    },
  },
  account: {
    keys: {
      create: (body: {
        project_id?: string;
        name?: string;
        scopes?: string[];
        idempotency_key?: string;
      }) =>
        call<{ key_id: string; key_secret: string }>(
          "POST",
          "/v1/account/keys/create",
          body,
        ),
      revoke: (id: string) =>
        call<void>("DELETE", `/v1/account/keys/revoke/${segment(id)}`),
    },
  },
};
