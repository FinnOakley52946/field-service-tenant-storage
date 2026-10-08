import { createHash } from "node:crypto";
import { infrai } from "./infrai.js";

export type TenantResources = {
  tenantId: string;
  bucket: string;
  credentialId: string;
};

export type TenantOnboarding = TenantResources & {
  credential: string;
};

export function bucketForTenant(tenantId: string): string {
  const suffix = createHash("sha256").update(tenantId).digest("hex").slice(0, 12);
  return `field-photos-${suffix}`;
}

export async function onboardTenant(tenantId: string): Promise<TenantOnboarding> {
  const bucket = bucketForTenant(tenantId);
  await infrai.storage.bucket.create(bucket);
  const created = await infrai.account.keys.create({
    name: `field-service-${tenantId}`,
    scopes: ["storage"],
    idempotency_key: `tenant-onboarding-${tenantId}`,
  });
  return {
    tenantId,
    bucket,
    credentialId: created.key_id,
    credential: created.key_secret,
  };
}

export async function offboardTenant(resources: TenantResources): Promise<void> {
  const results = await Promise.allSettled([
    infrai.storage.bucket.delete(resources.bucket),
    infrai.account.keys.revoke(resources.credentialId),
  ]);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
}
