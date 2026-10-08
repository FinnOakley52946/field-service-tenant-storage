import assert from "node:assert/strict";
import test from "node:test";
import { decideDispatch } from "./dispatch-policy.js";

test("a submitted photo makes a work order dispatchable", () => {
  assert.equal(
    decideDispatch({ photoFound: true, technicianFollowUp: false }),
    "ready-for-dispatch",
  );
});

test("technician follow-up holds dispatch even when a photo exists", () => {
  assert.equal(
    decideDispatch({ photoFound: true, technicianFollowUp: true }),
    "technician-follow-up",
  );
});

test("a work order without its required photo waits", () => {
  assert.equal(
    decideDispatch({ photoFound: false, technicianFollowUp: false }),
    "awaiting-photo",
  );
});
