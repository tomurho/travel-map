"use client";

import { useEffect, useRef, useState } from "react";
import { retainScreenshotDrafts, type ScreenshotDraft, type ScreenshotImageOutcome } from "@/lib/screenshot-intake";

type SelectedImage = { id: string; file: File; previewUrl: string; status: "pending" | "success" | "error"; error?: string };
type SubmissionSummary = { rowsCreated?: number; rowsSkipped?: number; results?: Array<{ rawName: string; sourceScreenshot: string; status: "created" | "duplicate" }> };

export function AdminScreenshotIntake({ adminPassword, sheetId, onSubmitted }: {
  adminPassword: string; sheetId: string; onSubmitted: () => void;
}) {
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [drafts, setDrafts] = useState<ScreenshotDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<SubmissionSummary | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [viewerImage, setViewerImage] = useState<SelectedImage | null>(null);
  const selectionGeneration = useRef(0);
  const extractionRequest = useRef<AbortController | null>(null);
  const previewUrls = useRef<string[]>([]);
  const viewerRef = useRef<HTMLDialogElement | null>(null);
  const viewerTrigger = useRef<HTMLElement | null>(null);
  const sendingRef = useRef(false);
  const extractingRef = useRef(false);

  useEffect(() => () => {
    ++selectionGeneration.current;
    extractionRequest.current?.abort();
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => {
    if (viewerImage && viewerRef.current && !viewerRef.current.open) viewerRef.current.showModal();
  }, [viewerImage]);
  function closeViewer() {
    viewerRef.current?.close();
    setViewerImage(null);
    viewerTrigger.current?.focus();
  }
  function selectImages(files: File[]) {
    if (extractingRef.current || sendingRef.current) return;
    ++selectionGeneration.current;
    extractionRequest.current?.abort();
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const nextImages = files.slice(0, 10).map((file): SelectedImage => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), status: "pending" }));
    previewUrls.current = nextImages.map((image) => image.previewUrl);
    setImages(nextImages);
    setDrafts([]);
    setSummary(null);
    setMessage(null);
    setError(files.length > 10 ? "Select at most 10 images. Only the first 10 were selected." : null);
  }
  async function extract() {
    if (extractingRef.current || sendingRef.current) return;
    const pendingImages = images.filter((image) => image.status !== "success");
    if (!pendingImages.length) return;
    extractingRef.current = true;
    setIsExtracting(true);
    setError(null);
    setMessage(null);
    const generation = selectionGeneration.current;
    const controller = new AbortController();
    extractionRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 65_000);
    const formData = new FormData();
    pendingImages.forEach((image) => { formData.append("images", image.file); formData.append("imageIds", image.id); });
    try {
      const response = await fetch("/api/admin/screenshot-intake/extract", {
        body: formData, headers: adminPassword ? { "x-admin-password": adminPassword } : undefined,
        method: "POST", signal: controller.signal,
      });
      const payload = await response.json() as { error?: string; results?: ScreenshotImageOutcome[] };
      if (generation !== selectionGeneration.current) return;
      if (!response.ok || !Array.isArray(payload.results)) throw new Error(payload.error ?? "Could not extract places. Retry the failed images.");
      // Ignore unrequested or duplicated outcomes. Never attach a response to another selection.
      const requested = new Set(pendingImages.map((image) => image.id));
      const outcomes = payload.results.filter((outcome) => requested.delete(outcome.imageId));
      const outcomeById = new Map(outcomes.map((outcome) => [outcome.imageId, outcome]));
      setImages((current) => current.map((image) => {
        if (!pendingImages.some((pending) => pending.id === image.id)) return image;
        const outcome = outcomeById.get(image.id);
        return outcome?.status === "success" ? { ...image, status: "success", error: undefined } : {
          ...image, status: "error", error: outcome?.status === "error" ? outcome.error : "No result was returned. Retry this image.",
        };
      }));
      setDrafts((current) => retainScreenshotDrafts(current, outcomes, () => crypto.randomUUID()));
      const failed = pendingImages.length - outcomes.filter((outcome) => outcome.status === "success").length;
      setMessage(failed ? `${failed} image${failed === 1 ? "" : "s"} failed. Successful results and your corrections are kept. Retry failed images.` : "Extraction complete. Check each name and location before sending to Capture.");
    } catch (failure) {
      if (generation !== selectionGeneration.current) return;
      const reason = failure instanceof Error && failure.name === "AbortError" ? "Extraction timed out. Retry the failed images." : failure instanceof Error ? failure.message : "Extraction failed. Retry the failed images.";
      setImages((current) => current.map((image) => pendingImages.some((pending) => pending.id === image.id) ? { ...image, status: "error", error: reason } : image));
      setError(reason);
    } finally {
      window.clearTimeout(timeout);
      if (generation === selectionGeneration.current) { extractingRef.current = false; setIsExtracting(false); }
    }
  }
  function editDraft(id: string, field: "rawName" | "cityHint" | "countryHint" | "rawText", value: string) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, [field]: value } : draft));
    setSummary(null);
  }
  const sendableDrafts = drafts.filter((draft) => !draft.ignored && draft.rawName.trim());
  async function send() {
    if (sendingRef.current || extractingRef.current || !sendableDrafts.length) return;
    if (!sheetId) { setError("Add a Google Sheet ID in Advanced settings before sending rows."); return; }
    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    const generation = selectionGeneration.current;
    try {
      const response = await fetch("/api/admin/screenshot-intake/send-to-capture", {
        method: "POST", headers: { "Content-Type": "application/json", ...(adminPassword ? { "x-admin-password": adminPassword } : {}) },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ sheetId, rows: sendableDrafts.map((draft) => ({ ...draft, sourceScreenshot: draft.fileName })) }),
      });
      const payload = await response.json() as SubmissionSummary & { error?: string };
      if (generation !== selectionGeneration.current) return;
      if (!response.ok) throw new Error(payload.error ?? "Could not send rows. Your drafts are kept. Retry Send to Capture.");
      setSummary(payload);
      setMessage(`Created ${payload.rowsCreated ?? 0} New Capture rows. Skipped ${payload.rowsSkipped ?? 0} duplicate or invalid rows. Review New captures above.`);
      onSubmitted();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not send rows. Your drafts are kept."); }
    finally { sendingRef.current = false; setIsSending(false); }
  }
  const failedImages = images.filter((image) => image.status === "error");
  return <details className="panel admin-export-panel admin-secondary-panel admin-pipeline-panel admin-screenshot-intake-panel">
    <summary>Add screenshots</summary>
    <p>Extract names from screenshots. Check the text, then send New rows to Capture. Lookup and verification happen separately.</p>
    <div className="admin-screenshot-intake-layout">
      <section className="admin-pipeline-settings admin-screenshot-upload-card" aria-label="Screenshot upload" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectImages(Array.from(event.dataTransfer.files)); }}>
        <h3>Select screenshots</h3>
        <p>Choose up to 10 JPEG, PNG, WebP, HEIC, or HEIF images. Each image can be up to 8 MB.</p>
        <label><span>{images.length ? "Replace selected images" : "Screenshot images"}</span><input accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={isExtracting || isSending} multiple type="file" onChange={(event) => selectImages(Array.from(event.target.files ?? []))} /></label>
        {isExtracting ? <p role="status">Extraction is running. Wait before replacing images.</p> : null}
        <ul className="admin-screenshot-file-list">{images.map((image) => <li key={image.id}>
          <strong>{image.file.name}</strong> · {image.status === "success" ? "Complete" : image.status === "error" ? "Failed" : "Waiting"}
          {image.error ? <p className="admin-error">{image.error}</p> : null}
          <button className="admin-screenshot-original" type="button" onClick={(event) => { viewerTrigger.current = event.currentTarget; setViewerImage(image); }} aria-label={`View original screenshot ${image.file.name}`}><img alt="" src={image.previewUrl} /><span>View original screenshot</span></button>
        </li>)}</ul>
        <button className="admin-pipeline-action" disabled={isExtracting || isSending || !images.some((image) => image.status !== "success")} onClick={() => void extract()} type="button">{isExtracting ? "Extracting…" : failedImages.length ? `Retry ${failedImages.length} failed image${failedImages.length === 1 ? "" : "s"}` : "Extract places"}</button>
      </section>
      <section className="admin-pipeline-results admin-screenshot-results" aria-label="Screenshot extraction results">
        <div className="admin-screenshot-results-header"><h3>Check extracted places</h3><button className="admin-pipeline-action" disabled={isSending || isExtracting || !sendableDrafts.length} type="button" onClick={() => void send()}>{isSending ? "Sending…" : `Send ${sendableDrafts.length} rows to Capture`}</button></div>
        {error ? <p className="admin-error" role="alert">{error}</p> : null}
        {message ? <p className="admin-success" role="status">{message}</p> : null}
        {drafts.length ? <div className="admin-screenshot-result-list">{drafts.map((draft) => {
          const image = images.find((item) => item.id === draft.imageId);
          return <article className={`admin-screenshot-result-card${draft.ignored ? " is-ignored" : ""}`} key={draft.id}>
            {image ? <button type="button" className="admin-screenshot-original" onClick={(event) => { viewerTrigger.current = event.currentTarget; setViewerImage(image); }} aria-label={`View original screenshot ${image.file.name}`}><img alt="" src={image.previewUrl} /><span>View original screenshot</span></button> : null}
            <div className="admin-screenshot-result-fields">{([['rawName', 'Place name'], ['cityHint', 'City'], ['countryHint', 'Country']] as const).map(([field, label]) => <label key={field}><span>{label}</span><input className="admin-draft-input" disabled={isSending} value={draft[field]} onChange={(event) => editDraft(draft.id, field, event.target.value)} /></label>)}
              <label className="admin-screenshot-raw-text"><span>Supporting text</span><textarea rows={3} className="admin-draft-input" disabled={isSending} value={draft.rawText} onChange={(event) => editDraft(draft.id, "rawText", event.target.value)} /></label>
              <label className="admin-screenshot-ignore-toggle"><input type="checkbox" disabled={isSending} checked={draft.ignored} onChange={() => setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, ignored: !item.ignored } : item))} />Ignore this row</label>
            </div>
          </article>;
        })}</div> : <p className="admin-empty">Extracted places appear here. Extraction does not write to Google Sheets.</p>}
        {summary?.results?.length ? <ul className="admin-note-list">{summary.results.map((result, index) => <li key={index}>{result.sourceScreenshot}: {result.rawName} — {result.status}</li>)}</ul> : null}
      </section>
    </div>
    <dialog ref={viewerRef} className="admin-screenshot-viewer" aria-labelledby="screenshot-viewer-title" onCancel={(event) => { event.preventDefault(); closeViewer(); }} onClose={() => { setViewerImage(null); viewerTrigger.current?.focus(); }} onClick={(event) => { if (event.target === event.currentTarget) closeViewer(); }}>
      <div className="admin-screenshot-viewer-content"><h3 id="screenshot-viewer-title">{viewerImage?.file.name}</h3><button autoFocus type="button" onClick={closeViewer}>Close original screenshot</button>{viewerImage ? <img src={viewerImage.previewUrl} alt={`Original screenshot ${viewerImage.file.name}`} /> : null}</div>
    </dialog>
  </details>;
}
