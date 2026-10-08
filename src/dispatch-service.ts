import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decideDispatch } from "./dispatch-policy.js";
import { InfraiError, infrai } from "./infrai.js";
import { bucketForTenant, onboardTenant } from "./tenant-storage.js";

const onboardingBody = z.object({
  tenantId: z.string().regex(/^[a-z0-9-]{2,40}$/),
});

const photoBody = z.object({
  tenantId: z.string().regex(/^[a-z0-9-]{2,40}$/),
  workOrderId: z.string().regex(/^[A-Za-z0-9-]{2,60}$/),
  contentType: z.string().regex(/^image\/(jpeg|png|webp)$/),
  maxBytes: z.number().int().positive().max(15_000_000),
});

const statusBody = z.object({
  tenantId: z.string().regex(/^[a-z0-9-]{2,40}$/),
  workOrderId: z.string().regex(/^[A-Za-z0-9-]{2,60}$/),
  technicianFollowUp: z.boolean(),
});

function photoKey(workOrderId: string): string {
  return `work-orders/${workOrderId}/arrival-photo`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "POST") {
      json(response, 404, { error: "Route not found" });
      return;
    }
    const body = await readJson(request);

    if (request.url === "/tenants/onboard") {
      const { tenantId } = onboardingBody.parse(body);
      const tenant = await onboardTenant(tenantId);
      json(response, 201, tenant);
      return;
    }

    if (request.url === "/work-orders/photo-upload") {
      const input = photoBody.parse(body);
      const bucket = bucketForTenant(input.tenantId);
      await infrai.storage.bucket.create(bucket);
      const key = photoKey(input.workOrderId);
      const signed = await infrai.storage.object.presign(bucket, key, {
        op: "put",
        expires_seconds: 600,
        content_type: input.contentType,
        max_bytes: input.maxBytes,
        idempotency_key: randomUUID(),
      });
      json(response, 200, { method: "PUT", uploadUrl: signed.url, bucket, key });
      return;
    }

    if (request.url === "/work-orders/dispatch-status") {
      const input = statusBody.parse(body);
      const bucket = bucketForTenant(input.tenantId);
      await infrai.storage.bucket.create(bucket);
      const object = await infrai.storage.object.head(bucket, photoKey(input.workOrderId));
      const photos = await infrai.storage.object.list(bucket);
      json(response, 200, {
        workOrderId: input.workOrderId,
        status: decideDispatch({
          photoFound: object.found,
          technicianFollowUp: input.technicianFollowUp,
        }),
        tenantPhotoCount: photos.items.length,
      });
      return;
    }

    json(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      json(response, 400, { error: "Invalid request body", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      json(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        message: error.message,
      });
      return;
    }
    json(response, 500, { error: "Request could not be completed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Field service API listening on http://localhost:${port}`));
