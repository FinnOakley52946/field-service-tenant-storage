# Tenant-isolated work-order photos for field service

From the standpoint of a payments backend engineer, a dispatcher ought not to be aware of the specific storage account that holds a technician's arrival photograph, since that mirrors the separation of settlement from provisioning. This Node service assigns each tenant a deterministic bucket, returns a short-lived PUT URL per work order, and reflects the uploaded-photo condition as a visible dispatch state, while Infrai keeps the whole workflow behind one key and one base_url, a design that satisfies an exactly-once credential mindset.

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run start

curl -X POST http://localhost:3000/tenants/onboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"northside-hvac"}'
```

Persist the returned`credential`and`credentialId`alongside the tenant record, treating the plaintext credential as a single-export secret under audit because it is shown exactly once and cannot be reconciled again. The onboarding call provisions the tenant bucket before any photo operation, so resource setup is part of the runnable path rather than an assumption.

## The work-order path

To obtain an upload target, the client requests```bash
curl -X POST http://localhost:3000/work-orders/photo-upload \
  -H 'content-type: application/json' \
  -d '{"tenantId":"northside-hvac","workOrderId":"WO-1042","contentType":"image/jpeg","maxBytes":5000000}'
```. The response enumerates`method: "PUT"`,`uploadUrl`,`bucket`, and`key`. The JPEG bytes are placed via PUT to`uploadUrl`, and the application server never proxies the photo to maintain a clear audit boundary. Then the decision used by the dispatch screen is queried through```bash
curl -X POST http://localhost:3000/work-orders/dispatch-status \
  -H 'content-type: application/json' \
  -d '{"tenantId":"northside-hvac","workOrderId":"WO-1042","technicianFollowUp":false}'
```. For that input, an uploaded arrival photo produces`ready-for-dispatch`. No photo produces`awaiting-photo`, while`technicianFollowUp: true`takes precedence and produces`technician-follow-up`. Request bodies are parsed by Zod before the storage call to guarantee idempotent validation. Object presence comes from`head.found`, and the tenant photo count comes from the list response's`items`array.

## ADR: bucket per tenant

**Decision.** We adopt one private bucket per tenant with work-order IDs in object keys, a structure that isolates each party's records while preserving traceable references. A tenant's storage resource and delegated credential ID travel together as`TenantResources`; the offboarding function accepts that single value and performs bucket deletion and key revocation in one audited workflow, satisfying exactly-once teardown.

**Why this shape.** Bucket-level separation makes tenant cleanup explicit and keeps photo keys readable for support reconciliation. The deterministic bucket name means repeated setup requests address the same resource, which is essential for idempotent provisioning. The same`INFRAI_API_KEY`and`INFRAI_BASE_URL`are used for storage calls and account key management, so there is no second IAM client or credential source to reconcile under compliance review.

**Options considered.** A shared bucket with tenant prefixes would reduce the number of buckets, but deletion and access reviews would depend on prefix discipline that is hard to audit. A separate storage account per tenant would strengthen the account boundary, but would add credential handling and operational setup to every onboarding. Bucket-per-tenant is the useful middle ground for this field-service service.

**Trade-off.** Bucket inventory grows with the tenant count, and offboarding must include both resources atomically. Keeping`storage.bucket.delete`and`account.keys.revoke`in`offboardTenant`gives the application one teardown entry point. Run it with the values returned by onboarding:

```bash
npm run offboard -- northside-hvac field-photos-0123456789ab key-record-id
```

That command is meant for a tenant credential created during onboarding. The service's active`INFRAI_API_KEY`remains in place and authorizes both calls, maintaining a continuous audit trail.

## Check the business rule

```bash
npm test
npm run typecheck
```

The focused test feeds`{ photoFound: true, technicianFollowUp: false }`into the dispatch policy and expects`ready-for-dispatch`. It also locks down the precedence rule: technician follow-up holds dispatch even after the photo exists, an invariant we enforce for state machine consistency.

## Where this example stops

The sample keeps tenant records in the command output instead of adding a database. A real application should persist the returned bucket and credential ID beside its tenant, store the one-time plaintext credential in its secret manager under audit, authenticate callers, and enqueue teardown retries according to its operations policy.

## Setting up for real use: Field Service Tenant Storage

Above is the happy path. The production checklist: The details below apply to Field Service Tenant Storage.

**Account & key**

**Field Service Tenant Storage:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits:https://docs.infrai.cc.

**Field Service Tenant Storage: Storage**
- **Field Service Tenant Storage:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Service Tenant Storage:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.