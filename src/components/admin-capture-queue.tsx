"use client";

import { useEffect, useRef, useState } from "react";
import type { CaptureQueueItem } from "@/lib/place-sheet-pipeline";

export function AdminCaptureQueue({ captures, disabled, isLoading, hasLoaded, sheetId, adminPassword, onMarkedReady }: {
  captures: CaptureQueueItem[]; disabled: boolean; isLoading: boolean; hasLoaded: boolean; sheetId: string; adminPassword: string; onMarkedReady: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const submitting = useRef(false);
  const keyFor = (capture: CaptureQueueItem) => `${capture.rowNumber}:${capture.intakeId}:${capture.captureVersion}`;
  useEffect(() => { setSelected((current) => current.filter((key) => captures.some((capture) => keyFor(capture) === key))); }, [captures]);
  async function markReady() {
    if (submitting.current || disabled) return;
    const chosen = captures.filter((capture) => selected.includes(keyFor(capture)));
    if (!chosen.length) return;
    submitting.current = true;
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/place-pipeline/capture-ready", {
        method: "POST", headers: { "Content-Type": "application/json", ...(adminPassword ? { "x-admin-password": adminPassword } : {}) },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ sheetId, confirmWrite: true, captures: chosen.map(({ rowNumber, intakeId, captureVersion }) => ({ rowNumber, intakeId, captureVersion })) }),
      });
      const payload = await response.json() as { error?: string; readyCount?: number };
      if (!response.ok) {
        // A stale row invalidates this selection. Never automatically repeat its old intent.
        if (response.status === 409) { setSelected([]); onMarkedReady(); }
        throw new Error(payload.error ?? "Could not mark captures Ready. Refresh and review them before retrying.");
      }
      setSelected([]);
      setMessage(`Marked ${payload.readyCount ?? chosen.length} captures Ready for lookup. No place was verified or published.`);
      onMarkedReady();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not mark captures Ready. Refresh before retrying."); }
    finally { submitting.current = false; setIsSaving(false); }
  }
  return <section className="admin-review-queue" aria-labelledby="new-captures-title">
    <div className="admin-review-queue-header"><div><span>Capture sheet</span><h3 id="new-captures-title">New captures</h3><p>Check the source, select the captures you want to look up, then mark them Ready.</p></div><strong>{!hasLoaded ? isLoading ? "Checking…" : "Unavailable" : `${captures.length} waiting`}</strong></div>
    {message ? <p className="admin-success" role="status">{message}</p> : null}
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    {!hasLoaded ? <p className="admin-empty" role="status">{isLoading ? "Checking New captures…" : "New captures are unavailable. Retry refresh above."}</p> : captures.length ? <><div className="admin-capture-list">{captures.map((capture) => {
      const key = keyFor(capture);
      return <article className="admin-capture-card" key={key}>
        <label className="admin-capture-selection"><input type="checkbox" disabled={disabled || isSaving} checked={selected.includes(key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} /><strong>{capture.rawName || "Unnamed capture"}</strong></label>
        <p>{[capture.cityHint, capture.countryHint].filter(Boolean).join(" · ") || "Location needs checking"}</p>
        {capture.rawText ? <p className="admin-capture-evidence">{capture.rawText}</p> : null}
        {capture.notes ? <p>{capture.notes}</p> : null}
        {capture.sourceScreenshot ? <p>Screenshot: {capture.sourceScreenshot}</p> : null}
        <div className="admin-capture-links"><a href={capture.sheetRowUrl} target="_blank" rel="noreferrer">Open Capture row {capture.rowNumber} ↗</a>{/^https?:\/\//i.test(capture.sourceUrl) ? <a href={capture.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a> : null}</div>
      </article>;
    })}</div><button className="admin-pipeline-action is-primary" type="button" disabled={disabled || isSaving || !selected.length} onClick={() => void markReady()}>{isSaving ? "Marking Ready…" : `Mark ${selected.length || "selected"} ready`}</button></> : <p className="admin-empty">No New captures are waiting. Add screenshots below, or continue with Ready rows and candidates.</p>}
  </section>;
}
