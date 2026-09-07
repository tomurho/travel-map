"use client";

import { useEffect, useState } from "react";
import type { VerificationConflict } from "@/lib/place-sheet-pipeline";
import type { Place } from "@/lib/place";

function mapsLink(place: Place) {
  const query = new URLSearchParams({ api: "1", query: `${place.latitude},${place.longitude}` });
  if (place.googlePlaceId) query.set("query_place_id", place.googlePlaceId);
  return `https://www.google.com/maps/search/?${query}`;
}

const fieldLabels: Record<string, string> = {
  name: "Name", city: "City", district: "Area", address: "Address",
  latitude: "Latitude", longitude: "Longitude", googleMapsUrl: "Google Maps URL",
  googlePlaceId: "Google Place ID",
};

function display(value: unknown) {
  return value === null || value === undefined || value === "" ? "Not set" : String(value);
}

function ConflictCard({ conflict, sheetId, publishedTabId, previewHash, adminPassword, onVerified, onInvalidated }: {
  conflict: VerificationConflict;
  sheetId: string;
  publishedTabId?: number;
  previewHash?: string;
  adminPassword: string;
  onVerified: (name: string) => void;
  onInvalidated: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setConfirmed(false);
    setReviewing(false);
    if (previewHash) setError("");
  }, [previewHash]);

  const range = `A${conflict.rowNumber}:O${conflict.rowNumber}`;
  const sheetLink = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit#${publishedTabId !== undefined ? `gid=${publishedTabId}&range=${range}` : `range=${encodeURIComponent(`Published!${range}`)}`}`;

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed || !note.trim() || !previewHash || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/place-pipeline/resolve-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": adminPassword },
        body: JSON.stringify({ sheetId, id: conflict.id, rowNumber: conflict.rowNumber, expectedPreviewHash: previewHash, confirmVerified: confirmed, verificationNote: note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not verify this correction. Preview again before retrying.");
      onVerified(conflict.published.name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The result is uncertain. Preview again before retrying.");
      onInvalidated();
    } finally {
      setSaving(false);
    }
  }

  return <li className="admin-conflict-card">
    <h4>{conflict.name}</h4>
    <p>Published row {conflict.rowNumber} · {conflict.id}</p>
    <div className="admin-conflict-table" tabIndex={0} role="region" aria-label={`${conflict.name} conflicting values`}>
      <table>
        <caption>Values that differ for {conflict.name}</caption>
        <thead><tr><th scope="col">Field</th><th scope="col">Local record</th><th scope="col">Published row</th></tr></thead>
        <tbody>{conflict.fields.map((field) => <tr key={field.field}>
          <th scope="row">{fieldLabels[field.field] ?? field.field}</th>
          <td>{display(field.before)}</td><td>{display(field.after)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="admin-conflict-scroll-hint">Scroll sideways in the table to compare all values.</p>
    <p className="admin-conflict-links">
      <a href={sheetLink} target="_blank" rel="noopener noreferrer">Open Published row ↗</a>
      <a href={mapsLink(conflict.local)} target="_blank" rel="noopener noreferrer">Local location in Maps ↗</a>
      <a href={mapsLink(conflict.published)} target="_blank" rel="noopener noreferrer">Published location in Maps ↗</a>
    </p>
    <p>If the local record is correct, correct the Published row to match it, then select Preview again.</p>
    {!reviewing ? <button type="button" disabled={!previewHash || saving} onClick={() => setReviewing(true)}>Review correction for {conflict.name}</button> : <form onSubmit={verify}>
      <p>This adopts the Published venue and pin for this place only. Old verification evidence is retained in the backup and replaced by your new manual decision. Local category, visit status, and loved rating stay unchanged.</p>
      <label>How did you verify {conflict.name}?
        <textarea required value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label><input type="checkbox" checked={confirmed} disabled={saving} onChange={(event) => setConfirmed(event.target.checked)} /> I checked the Published venue and map pin and confirm they are correct.</label>
      <div className="admin-conflict-links">
        <button type="submit" disabled={saving || !confirmed || !note.trim() || !previewHash}>{saving ? "Saving…" : "Verify and save correction"}</button>
        <button type="button" disabled={saving} onClick={() => { setReviewing(false); setConfirmed(false); }}>Cancel</button>
      </div>
    </form>}
    {error ? <p role="alert" className="admin-error">{error}</p> : null}
  </li>;
}

export function AdminConflictReview(props: {
  conflicts: VerificationConflict[];
  sheetId: string;
  publishedTabId?: number;
  previewHash?: string;
  adminPassword: string;
  onVerified: (name: string) => void;
  onInvalidated: () => void;
  onPreviewAgain: () => void;
  isPreviewing: boolean;
}) {
  return <section aria-label="Resolve verification conflicts">
    <h3>Resolve verification conflicts</h3>
    <p>Sync is paused until these verified places agree with Published. Review each correction individually.</p>
    <ul className="admin-conflict-list">{props.conflicts.map((conflict) => <ConflictCard key={conflict.id} {...props} conflict={conflict} />)}</ul>
    <button type="button" disabled={props.isPreviewing} onClick={props.onPreviewAgain}>{props.isPreviewing ? "Refreshing preview…" : "Preview again"}</button>
  </section>;
}
