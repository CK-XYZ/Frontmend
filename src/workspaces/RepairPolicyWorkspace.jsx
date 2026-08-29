import { Robot, ShieldCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { auditService } from "../audit-service.js";
import { humanMissionMutationFailure } from "../ui/human-mission-recovery.js";

function RepairPolicyControl({ auditId, policy, onPolicyChange }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const auto = policy?.mode === "auto-low-risk";

  const update = async (mode) => {
    setBusy(mode);
    setError("");
    try {
      const next = await auditService.setRepairPolicy(auditId, mode);
      onPolicyChange(next);
      setConfirmed(false);
    } catch (cause) {
      const failure = await humanMissionMutationFailure(
        cause,
        auditId,
        "The repair policy could not be updated.",
      );
      if (failure.stale) setConfirmed(false);
      setError(failure.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className={`repair-policy ${auto ? "auto" : "review"}`} aria-labelledby="repair-policy-title">
      <div className="repair-policy-heading">
        <span aria-hidden="true"><Robot size={22} weight="duotone" /></span>
        <div>
          <p className="kicker">Human-agent operating policy</p>
          <h2 id="repair-policy-title">Choose how repository missions enter implementation</h2>
          <p>This grant belongs to this audit workspace and is persisted with its repair state.</p>
        </div>
      </div>
      <div className="repair-policy-options">
        <button
          type="button"
          className={!auto ? "active" : ""}
          aria-pressed={!auto}
          disabled={Boolean(busy)}
          onClick={() => update("review")}
        >
          <strong>Review each plan</strong>
          <span>Every agent proposal waits for your visible approval.</span>
        </button>
        <button
          type="button"
          className={auto ? "active" : ""}
          aria-pressed={auto}
          disabled={Boolean(busy) || (!auto && !confirmed)}
          onClick={() => update("auto-low-risk")}
        >
          <strong>{busy === "auto-low-risk" ? "Enabling…" : "Delegated auto mode"}</strong>
          <span>Auto-authorise up to three eligible low-risk HTML or CSS plans.</span>
        </button>
      </div>
      {!auto ? (
        <label className="repair-policy-confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I authorise agent-submitted low-risk HTML or CSS plans that name repository files and checks.
          </span>
        </label>
      ) : (
        <div className="repair-policy-receipt" role="status">
          <ShieldCheck size={18} weight="fill" aria-hidden="true" />
          <span>
            {policy.remainingAutoApprovals} delegated approval{policy.remainingAutoApprovals === 1 ? "" : "s"} remain.
            JavaScript, headers, configuration, medium/high risk, deployment and deployment attestation stay gated.
          </span>
        </div>
      )}
      {error ? <p className="repair-error" role="alert">{error}</p> : null}
    </section>
  );
}

export default function RepairPolicyWorkspace(props) {
  return <RepairPolicyControl {...props} />;
}
