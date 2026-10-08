import { z } from "zod";
import { offboardTenant } from "./tenant-storage.js";

const input = z
  .object({
    tenantId: z.string().regex(/^[a-z0-9-]{2,40}$/),
    bucket: z.string().min(3),
    credentialId: z.string().min(1),
  })
  .parse({
    tenantId: process.argv[2],
    bucket: process.argv[3],
    credentialId: process.argv[4],
  });

await offboardTenant({
  tenantId: input.tenantId,
  bucket: input.bucket,
  credentialId: input.credentialId,
});
console.log(`Offboarded tenant ${input.tenantId}`);
