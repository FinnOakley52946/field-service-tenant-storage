export type DispatchStatus =
  | "awaiting-photo"
  | "ready-for-dispatch"
  | "technician-follow-up";

export function decideDispatch(input: {
  photoFound: boolean;
  technicianFollowUp: boolean;
}): DispatchStatus {
  if (input.technicianFollowUp) return "technician-follow-up";
  return input.photoFound ? "ready-for-dispatch" : "awaiting-photo";
}
