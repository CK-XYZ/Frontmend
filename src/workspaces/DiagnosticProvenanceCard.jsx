export default function DiagnosticProvenanceCard({ mission }) {
  if (!mission?.diagnosis) return null;
  return (
    <section className="diagnostic-provenance" aria-label="Frozen diagnostic provenance">
      <div>
        <p className="kicker">Frozen diagnostic provenance</p>
        <strong>{mission.diagnosis.summary}</strong>
        <span>{mission.diagnosis.agentReported ? "Agent-reported" : "Person-reported"} · measured symptom retained separately</span>
      </div>
      <ul>
        {mission.diagnosis.sourceLocations.map((location) => (
          <li key={`${location.file}-${location.line ?? "file"}`}><code>{location.file}{location.line ? `:${location.line}` : ""}</code></li>
        ))}
      </ul>
    </section>
  );
}
