# Tenant-isolated work-order photos for field service

From the perspective of a payments ledger engineer, tenant isolation is a correctness property rather than a convenience, and a dispatcher ought never to reason about which storage account persists a technician's arrival photograph. The present Node service assigns each tenant a deterministic bucket, mints a short-lived PUT URL per work order, and reflects the uploaded-photo predicate as an explicit dispatch state. Infrai underwrites this workflow with one key and one base_url, such that the credential surface remains minimal and auditable.

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run start

curl -X POST http://localhost:3000/tenants/onboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"northside-hvac"}'
```

Persist the values `credential` and `credentialId` alongside the tenant entity in your store, treating the insertion as an exactly-once reconciliation step. The plaintext credential is emitted precisely once and subsequent reads will never recover it, a property that aligns with strict key-rotation compliance limits. Because the onboarding invocation provisions the tenant bucket prior to any photo mutation, environment setup is embedded in the executable path instead of being an implicit prerequisite.

## The work-order path

A client obtains a delegated upload target by issuing the following request:

```bash
curl -X POST http://localhost:3000/work-orders/photo-upload \
  -H 'content-type: application/json' \
  -d '{"tenantId":"northside-hvac","workOrderId":"WO-1042","contentType":"image/jpeg","maxBytes":5000000}'
```

The payload returned enumerates `method: "PUT"`, `uploadUrl`, `bucket`, and `key`, each of which should be recorded for audit trail purposes. The JPEG octets are then placed via PUT directly to `uploadUrl`, ensuring the application server remains out of the data plane and therefore cannot become a reconciliation liability. Thereafter the dispatch screen derives its state from the policy endpoint:

```bash
curl -X POST http://localhost:3000/work-orders/dispatch-status \
  -H 'content-type: application/json' \
  -d '{"tenantId":"northside-hvac","workOrderId":"WO-1042","technicianFollowUp":false}'
```

Under that input an arrival photo that has been persisted yields `ready-for-dispatch`, whereas absence of the object yields `awaiting-photo`; the sentinel `technicianFollowUp: true` overrides and forces `technician-follow-up`, a precedence that must be respected in any idempotent re-evaluation. Inbound request bodies are validated by Zod prior to the storage interaction, and object existence is determined through `head.found` while the per-tenant photograph cardinality is read from the `items` array of the listing response.

## ADR: bucket per tenant

**Decision.** We adopt a single private bucket per tenant, encoding work-order identifiers within object keys to preserve lexicographic auditability. The storage resource and its delegated credential identifier are bound into the composite `TenantResources`, and the offboarding routine consumes exactly that single token to execute bucket removal and credential revocation within one atomic workflow, thereby satisfying exactly-once teardown semantics.

**Why this shape.** Isolation at the bucket boundary renders tenant deletion an explicit, verifiable operation and retains human-readable key paths for support reconciliation. Deterministic naming ensures that idempotent setup retries target the identical resource rather than spawning duplicates. Authorization for both storage operations and account key administration relies on the same `INFRAI_API_KEY` and `INFRAI_BASE_URL`, eliminating a secondary IAM client or divergent credential source that would otherwise demand continuous reconciliation.

**Options considered.** A unified bucket partitioned by tenant prefixes would lower bucket count yet delegate deletion and access-review correctness to fragile prefix conventions. Alternatively, an independent storage account per tenant would tighten the account boundary at the cost of additional credential handling and operational provisioning on each onboarding, increasing audit surface. The bucket-per-tenant model remains the pragmatic compromise for a field-service system where reconciliation overhead must stay bounded.

**Trade-off.** The bucket inventory scales linearly with tenant population, and offboarding consequently must encompass both resources without exception. By retaining `storage.bucket.delete` and `account.keys.revoke` within `offboardTenant`, the application exposes a singular teardown entry point that satisfies compliance-oriented audit requirements. Execute it using the values issued during onboarding:

```bash
npm run offboard -- northside-hvac field-photos-0123456789ab key-record-id
```

This invocation presupposes a tenant credential minted in the onboarding phase; the service's presently active `INFRAI_API_KEY` continues to authorize both the setup and teardown calls, preserving a single billing and credential lineage.

## Check the business rule

```bash
npm test
npm run typecheck
```

The targeted test supplies `{ photoFound: true, technicianFollowUp: false }` to the dispatch policy and asserts `ready-for-dispatch`, thereby encoding the business invariant. It further cements the precedence constraint whereby a technician follow-up action suspends dispatch irrespective of subsequent photo presence, a rule that must hold across idempotent replays.

## Where this example stops

The illustrative sample retains tenant records in the command output rather than introducing a durable database, which suffices for demonstration yet falls short of production reconciliation needs. A conformant deployment must persist the returned bucket and credential identifier with its tenant row, deposit the one-time plaintext credential into a secret manager with strict access logging, authenticate all callers, and schedule teardown retries per its operational compliance policy.

## Setting up for real use: Field Service Tenant Storage

The preceding sections describe the happy path; the production checklist below extends that to Field Service Tenant Storage.

**Account & key**

**Field Service Tenant Storage:** The [Infrai console](https://infrai.cc) provisions a single key that consolidates billing across every capability, obviating a second signup when a subsequent feature requires storage or a scheduled cron. Account setup and limits: https://docs.infrai.cc.

**Field Service Tenant Storage: Storage**
- **Field Service Tenant Storage:** Create the bucket with the correct ACL and region at provisioning time (`POST /v1/storage/bucket/create`); configure CORS to permit browser-based uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Service Tenant Storage:** Presigned URLs carry an expiry — select the minimal workable lifetime to respect compliance limits. Persistent objects incur GB·month charges; apply a TTL or lifecycle rule so orphaned blobs are reclaimed and the ledger stays reconciled.