import { AuditError, auditService } from "../audit-service.js";

export async function humanMissionMutationFailure(cause, auditId, fallbackMessage) {
  if (cause?.code !== "MISSION_REVISION_STALE") {
    return {
      stale: false,
      message: cause instanceof AuditError ? cause.message : fallbackMessage,
    };
  }
  try {
    const refreshed = await auditService.refreshMissionWorkspace(auditId);
    return {
      stale: true,
      message: refreshed.unavailable.length
        ? "Mission changed in another session. The current checkpoint and available workspace state were refreshed; reload any unavailable details and inspect the mission before acting again."
        : "Mission changed in another session. The complete workspace was refreshed; inspect the current mission before acting again.",
    };
  } catch {
    return {
      stale: true,
      message: "Mission changed in another session. Refresh this audit and inspect its current state before acting again.",
    };
  }
}
