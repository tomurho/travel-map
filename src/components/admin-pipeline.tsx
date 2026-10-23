"use client";

import { useEffect, useRef, useState } from "react";
import { AdminConflictReview } from "@/components/admin-conflict-review";
import { AdminReviewQueue } from "@/components/admin-review-queue";
import { AdminCaptureQueue } from "@/components/admin-capture-queue";
import type { CaptureQueueItem, PipelineValidationIssue, PlacePipelineStatus, VerificationConflict, ReviewCandidate, ReviewCandidateDecision, ReviewCandidateEdits } from "@/lib/place-sheet-pipeline";

type PipelineFieldChange = { field: string; before: unknown; after: unknown };
type PipelineRowChanges = { id: string; name?: string; rowNumber?: number; fields: PipelineFieldChange[] };

function PipelineChanges({ rows }: { rows: PipelineRowChanges[] }) {
  return <ul className="admin-note-list">{rows.map((row) => (
    <li key={`${row.id}-${row.rowNumber ?? ""}`}>
      <details>
        <summary>{row.name || row.id}{row.rowNumber ? ` · Row ${row.rowNumber}` : ""} · {row.fields.length} changed fields</summary>
        <ul>{row.fields.map((change) => <li key={change.field}>
          <strong>{change.field.replace(/([a-z])([A-Z])/g, "$1 $2")}</strong>: {JSON.stringify(change.before)} → {JSON.stringify(change.after)}
        </li>)}</ul>
      </details>
    </li>
  ))}</ul>;
}

type PipelineSyncResult = {
  previewHash?: string;
  canApply?: boolean;
  verificationConflicts?: VerificationConflict[];
  publishedTabId?: number;
  preservedClosures?: Array<{ id: string; name: string; rowNumber: number }>;
  changes?: Array<{
    action: "insert" | "update";
    fields: PipelineFieldChange[];
    id: string;
    name: string;
    rowNumber: number;
  }>;
  error?: string;
  inserted?: number;
  rowsRead?: number;
  skipped?: number;
  updated?: number;
  validationErrors?: Array<{
    errors: string[];
    id: string;
    rowNumber: number;
  }>;
  wrote?: boolean;
};

type PipelinePublishResult = {
  previewHash?: string;
  canApply?: boolean;
  fieldChanges?: PipelineRowChanges[];
  approvedRowsFound?: number;
  blankIdRowsSkipped?: number;
  duplicateIdsSkipped?: string[];
  duplicateRowsSkipped?: number;
  error?: string;
  mode?: "preview" | "write";
  publishedRows?: number;
  rowsSkipped?: number;
  rowsToPublish?: number;
  rowsToUpdate?: number;
  validationIssues?: number;
  validationErrors?: Array<{ rowNumber: number; id: string; errors: string[] }>;
  verifiedRowsFound?: number;
  wouldPublishRows?: Array<{
    id: string;
    name: string;
  }>;
  wrote?: boolean;
};

type PipelineReviewResult = {
  apiCallsMade?: number;
  blankRawName?: number;
  duplicateReviewId?: string;
  duplicateReviewIds?: string[];
  duplicateReviewRows?: Array<{
    id: string;
    rowNumber: number;
  }>;
  enrichedRows?: number;
  reconciledRows?: number;
  error?: string;
  skippedRowDetails?: Array<{
    reason: string;
    rowNumber: number;
  }>;
  skippedRows?: number;
};

type PipelineSnapshotResponse = {
  cached?: boolean;
  candidates?: ReviewCandidate[];
  error?: string;
  status?: PlacePipelineStatus;
  captures?: CaptureQueueItem[];
  checkedAt?: string;
};

const PIPELINE_ACTION_LABELS: Record<
  PlacePipelineStatus["recommendedAction"],
  string
> = {
  fix_errors: "Fix the listed invalid rows before applying their changes.",
  mark_ready: "Choose the New captures you want to process and mark them Ready.",
  process_ready: "Process the Ready Capture rows next.",
  publish_verified: "Preview and apply Publish for the verified changes.",
  up_to_date: "Nothing is waiting. The Sheet and travel map are up to date.",
  update_app: "Preview and apply the travel-map update next.",
  verify_candidates: "Use Candidate review below to verify or reject each match.",
};

const DEFAULT_PIPELINE_SHEET_ID = "1kVnvUBm-jxAR8zIxh8PyhFEDUgC8b1Y0Q3SObITMpJw";
function formatCheckedAt(value: string | null) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "the last successful refresh";
}

export function AdminPipeline({ adminPassword, categoryOptions, refreshKey = 0, onSheetIdChange }: {
  adminPassword: string; categoryOptions: string[]; refreshKey?: number; onSheetIdChange: (sheetId: string) => void;
}) {
  const lastPipelineResumeRefreshAtRef = useRef(0);
  const pipelineSnapshotRequestRef = useRef<{ sheetId: string; promise: Promise<void> } | null>(null);
  const snapshotGenerationRef = useRef(0);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [captureQueue, setCaptureQueue] = useState<CaptureQueueItem[]>([]);
  const [validationIssues, setValidationIssues] = useState<PipelineValidationIssue[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [pipelineSheetId, setPipelineSheetId] = useState(
    DEFAULT_PIPELINE_SHEET_ID,
  );
  const [pipelineResult, setPipelineResult] = useState<PipelineSyncResult | null>(
    null,
  );
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [pipelinePublishResult, setPipelinePublishResult] =
    useState<PipelinePublishResult | null>(null);
  const [pipelinePublishMessage, setPipelinePublishMessage] = useState<
    string | null
  >(null);
  const [pipelineReviewResult, setPipelineReviewResult] =
    useState<PipelineReviewResult | null>(null);
  const [pipelineReviewMessage, setPipelineReviewMessage] = useState<string | null>(
    null,
  );
  const [pipelineStatus, setPipelineStatus] =
    useState<PlacePipelineStatus | null>(null);
  const [pipelineStatusError, setPipelineStatusError] = useState<string | null>(
    null,
  );
  const [reviewCandidates, setReviewCandidates] = useState<ReviewCandidate[]>([]);
  const [reviewCandidateError, setReviewCandidateError] = useState<string | null>(
    null,
  );
  const [reviewCandidateMessage, setReviewCandidateMessage] = useState<
    string | null
  >(null);
  const [isLoadingPipelineSnapshot, setIsLoadingPipelineSnapshot] =
    useState(false);
  const [updatingReviewCandidateKey, setUpdatingReviewCandidateKey] = useState<
    string | null
  >(null);
  const [pipelineMaxApiCalls, setPipelineMaxApiCalls] = useState("1");
  const [isReviewingNewPlaces, setIsReviewingNewPlaces] = useState(false);
  const [isSyncingPublished, setIsSyncingPublished] = useState(false);
  const [isPublishingApprovedPlaces, setIsPublishingApprovedPlaces] =
    useState(false);
  const currentSheetIdRef = useRef(pipelineSheetId.trim());
  currentSheetIdRef.current = pipelineSheetId.trim();
  function authHeaders() { return adminPassword ? { "x-admin-password": adminPassword } : undefined; }
  useEffect(() => { onSheetIdChange(pipelineSheetId.trim()); }, [pipelineSheetId, onSheetIdChange]);
  useEffect(() => {
    void refreshPipelineSnapshot(undefined, { force: true });
    // Refresh explicitly after intake. Do not refresh on every Sheet ID keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  useEffect(() => {
    const refreshAfterResume = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastPipelineResumeRefreshAtRef.current < 60_000) return;
      void refreshPipelineSnapshot();
    };
    window.addEventListener("focus", refreshAfterResume);
    document.addEventListener("visibilitychange", refreshAfterResume);
    return () => { window.removeEventListener("focus", refreshAfterResume); document.removeEventListener("visibilitychange", refreshAfterResume); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPassword, pipelineSheetId]);
  function refreshPipelineSnapshot(
    sheetId = pipelineSheetId.trim(),
    options: { force?: boolean } = {},
  ) {
    if (!sheetId) {
      setReviewCandidates([]);
      setPipelineStatus(null);
      setReviewCandidateError("Add a Google Sheet ID to check Review candidates.");
      setPipelineStatusError("Add a Google Sheet ID to check pipeline status.");
      return Promise.resolve();
    }

    if (!options.force && pipelineSnapshotRequestRef.current?.sheetId === sheetId) {
      return pipelineSnapshotRequestRef.current.promise;
    }
    const requestGeneration = ++snapshotGenerationRef.current;

    setIsLoadingPipelineSnapshot(true);
    setReviewCandidateError(null);
    setPipelineStatusError(null);
    lastPipelineResumeRefreshAtRef.current = Date.now();

    const request = (async () => {
      const searchParams = new URLSearchParams({ sheetId });

      if (options.force) {
        searchParams.set("force", "1");
      }

      const response = await fetch(
        `/api/admin/place-pipeline/snapshot?${searchParams.toString()}`,
        { headers: authHeaders(), signal: AbortSignal.timeout(60_000), cache: "no-store" },
      );
      const payload = (await response.json()) as PipelineSnapshotResponse;

      if (!response.ok || !payload.status) {
        throw new Error(payload.error ?? "Could not read the pipeline snapshot.");
      }

      if (requestGeneration !== snapshotGenerationRef.current || currentSheetIdRef.current !== sheetId) return;
      setCaptureQueue(payload.captures ?? []);
      setValidationIssues(payload.status.validationIssues ?? []);
      setCheckedAt(payload.checkedAt ?? payload.status.fetchedAt);
      setReviewCandidates(payload.candidates ?? []);
      setPipelineStatus(payload.status);
    })()
      .catch((snapshotError) => {
        if (requestGeneration !== snapshotGenerationRef.current || currentSheetIdRef.current !== sheetId) return;
        const message =
          snapshotError instanceof Error
            ? snapshotError.message
            : "Could not read the Google Sheets pipeline.";

        // Keep the last successful snapshot visible during transient failures.
        setReviewCandidateError(message);
        setPipelineStatusError(message);
      })
      .finally(() => {
        if (requestGeneration !== snapshotGenerationRef.current) return;
        setIsLoadingPipelineSnapshot(false);
        pipelineSnapshotRequestRef.current = null;
      });

    pipelineSnapshotRequestRef.current = { sheetId, promise: request };
    return request;
  }

  async function updateReviewCandidateDecision(
    candidate: ReviewCandidate,
    decision: ReviewCandidateDecision,
    edits?: ReviewCandidateEdits,
  ) {
    if (!pipelineSheetId.trim()) {
      setReviewCandidateError("Add a Google Sheet ID before reviewing candidates.");
      return;
    }

    const displayName = candidate.candidateName || candidate.rawName || "this row";
    if (
      decision === "reject" &&
      !window.confirm(`Reject ${displayName} as the match for this capture?`)
    ) {
      return;
    }

    const candidateKey = `${candidate.rowNumber}:${candidate.id}`;
    setUpdatingReviewCandidateKey(candidateKey);
    setReviewCandidateError(null);
    setReviewCandidateMessage(null);

    try {
      const response = await fetch(
        "/api/admin/place-pipeline/review-candidates",
        {
          body: JSON.stringify({
            confirmWrite: true,
            decision,
            edits,
            expectedReviewStamp: candidate.reviewStamp,
            id: candidate.id,
            rowNumber: candidate.rowNumber,
            sheetId: pipelineSheetId.trim(),
          }),
          headers: {
            "Content-Type": "application/json",
            ...(authHeaders() ?? {}),
          },
          signal: AbortSignal.timeout(90_000),
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 409) {
          // Clear the previous intent. A changed row must be reviewed afresh.
          setReviewCandidates([]);
          setPipelinePublishResult(null);
          setPipelineResult(null);
          await refreshPipelineSnapshot(undefined, { force: true });
        }
        throw new Error(payload.error ?? "Could not update the Review candidate.");
      }

      setReviewCandidates((currentCandidates) =>
        currentCandidates.filter(
          (currentCandidate) =>
            currentCandidate.rowNumber !== candidate.rowNumber ||
            currentCandidate.id !== candidate.id,
        ),
      );
      setPipelinePublishResult(null);
      setPipelineResult(null);
      setReviewCandidateMessage(
        decision === "verify"
          ? `Verified ${displayName}. It is ready for Publish preview.`
          : `Rejected ${displayName}. It will not be published.`,
      );
      void refreshPipelineSnapshot(undefined, { force: true });
    } catch (candidateError) {
      setReviewCandidateError(
        candidateError instanceof Error
          ? candidateError.message
          : "Could not update the Review candidate.",
      );
    } finally {
      setUpdatingReviewCandidateKey(null);
    }
  }

  async function syncPublishedToApp(write: boolean) {
    if (!pipelineSheetId.trim()) {
      setPipelineMessage(null);
      setPipelineResult(null);
      setSyncError("Add a Google Sheet ID before syncing Published rows.");
      return;
    }

    if (write && pipelineResult?.wrote !== false) {
      setSyncError("Preview the app update before applying it.");
      return;
    }

    if (write && pipelineResult?.validationErrors?.length) {
      setSyncError("Resolve every validation error before updating the app.");
      return;
    }

    if (write && !window.confirm("Apply the previewed changes to the travel map?")) {
      return;
    }

    if (write && (!pipelineResult?.previewHash || !pipelineResult.canApply)) {
      setSyncError("Create a valid preview with changes before applying.");
      return;
    }

    setIsSyncingPublished(true);
    setSyncError(null);
    setPipelineMessage(null);
    if (!write) {
      setPipelineResult(null);
    }

    try {
      const response = await fetch("/api/admin/place-pipeline/sync-published", {
        body: JSON.stringify({
          confirmWrite: write,
          expectedPreviewHash: write ? pipelineResult?.previewHash : undefined,
          sheetId: pipelineSheetId.trim(),
          write,
        }),
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders() ?? {}),
        },
        signal: AbortSignal.timeout(90_000),
        method: "POST",
      });
      const payload = (await response.json()) as PipelineSyncResult;

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not sync Published rows.");
      }

      setPipelineResult(payload);
      setPipelineMessage(
        write
          ? "Published rows were written to the app dataset."
          : "Dry run complete. No app data was changed.",
      );
      if (write) {
        void refreshPipelineSnapshot(undefined, { force: true });
      }
    } catch (syncError) {
      if (write) {
        setPipelineResult((current) => current ? { ...current, canApply: false, previewHash: undefined } : null);
      }
      setSyncError(
        syncError instanceof Error
          ? syncError.message
          : "Could not sync Published rows.",
      );
    } finally {
      setIsSyncingPublished(false);
    }
  }

  async function reviewNewPlaces() {
    if (!pipelineSheetId.trim()) {
      setPipelineReviewMessage(null);
      setPipelineReviewResult(null);
      setLookupError("Add a Google Sheet ID before processing Ready rows.");
      return;
    }

    const maxApiCalls = Number(pipelineMaxApiCalls);

    if (!Number.isInteger(maxApiCalls) || maxApiCalls <= 0 || maxApiCalls > 10) {
      setPipelineReviewMessage(null);
      setPipelineReviewResult(null);
      setLookupError("Max API calls must be an integer from 1 to 10.");
      return;
    }

    if (
      !window.confirm(
        `This will call Google Places for up to ${maxApiCalls} rows. Continue?`,
      )
    ) {
      return;
    }

    setIsReviewingNewPlaces(true);
    setLookupError(null);
    setPipelineReviewMessage(null);
    setPipelineReviewResult(null);

    try {
      const response = await fetch("/api/admin/place-pipeline/review-new", {
        body: JSON.stringify({
          confirmLiveApi: true,
          maxApiCalls,
          sheetId: pipelineSheetId.trim(),
        }),
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders() ?? {}),
        },
        signal: AbortSignal.timeout(90_000),
        method: "POST",
      });
      const payload = (await response.json()) as PipelineReviewResult;

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not review new places.");
      }

      setPipelineReviewResult(payload);
      setPipelineReviewMessage(
        "Ready Capture rows were enriched. Review the new Candidate rows in the Review sheet.",
      );
      setPipelinePublishResult(null);
      setPipelineResult(null);
      void refreshPipelineSnapshot(undefined, { force: true });
    } catch (reviewError) {
      setLookupError(
        reviewError instanceof Error
          ? reviewError.message
          : "Could not process Ready rows.",
      );
    } finally {
      setIsReviewingNewPlaces(false);
    }
  }

  async function publishApprovedPlaces(write: boolean) {
    if (!pipelineSheetId.trim()) {
      setPipelinePublishMessage(null);
      setPipelinePublishResult(null);
      setPublishError("Add a Google Sheet ID before publishing verified Review rows.");
      return;
    }

    if (write && pipelinePublishResult?.mode !== "preview") {
      setPublishError("Preview the Published changes before applying them.");
      return;
    }

    if (
      write &&
      !window.confirm("Apply the previewed changes to the Published sheet?")
    ) {
      return;
    }

    if (write && (!pipelinePublishResult?.previewHash || !pipelinePublishResult.canApply)) {
      setPublishError("Create a valid preview with changes before applying.");
      return;
    }

    setIsPublishingApprovedPlaces(true);
    setPublishError(null);
    setPipelinePublishMessage(null);
    if (!write) {
      setPipelinePublishResult(null);
    }

    try {
      const response = await fetch("/api/admin/place-pipeline/publish-approved", {
        body: JSON.stringify({
          confirmWrite: write,
          expectedPreviewHash: write ? pipelinePublishResult?.previewHash : undefined,
          sheetId: pipelineSheetId.trim(),
          write,
        }),
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders() ?? {}),
        },
        signal: AbortSignal.timeout(90_000),
        method: "POST",
      });
      const payload = (await response.json()) as PipelinePublishResult;

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not publish verified Review rows.");
      }

      setPipelinePublishResult(payload);
      if (write) {
        setPipelineResult(null);
      }
      setPipelinePublishMessage(
        write
          ? "Previewed changes were applied to Published."
          : "Publish preview ready. Review the summary before applying changes.",
      );
      if (write) {
        void refreshPipelineSnapshot(undefined, { force: true });
      }
    } catch (publishError) {
      if (write) {
        setPipelinePublishResult((current) => current ? { ...current, canApply: false, previewHash: undefined } : null);
      }
      setPublishError(
        publishError instanceof Error
          ? publishError.message
          : "Could not publish verified Review rows.",
      );
    } finally {
      setIsPublishingApprovedPlaces(false);
    }
  }

  return (
    <details
      className="panel admin-export-panel admin-secondary-panel admin-pipeline-panel"
      open
    >
      <summary>Current work</summary>
      <div className="admin-pipeline-header">
        <p>
          Move each place from Capture to Review, then Published, then the local
          travel map.
        </p>
      </div>
      <div className="admin-pipeline-body">
        <section
          aria-labelledby="admin-resume-guide-title"
          className="admin-pipeline-guide"
        >
          <div className="admin-pipeline-guide-header">
            <div>
              <h3 id="admin-resume-guide-title">Pipeline overview</h3>
              <p>
                Check what is ready, review candidates, then preview your changes.
              </p>
            </div>
            <div className="admin-pipeline-guide-actions">
              <button
                disabled={isLoadingPipelineSnapshot}
                onClick={() => {
                  void refreshPipelineSnapshot(undefined, { force: true });
                }}
                type="button"
              >
                {isLoadingPipelineSnapshot ? "Checking…" : "Refresh data"}
              </button>
              <a
                href={`https://docs.google.com/spreadsheets/d/${pipelineSheetId.trim()}/edit`}
                rel="noreferrer"
                target="_blank"
              >
                Open Google Sheet ↗
              </a>
            </div>
          </div>
          {pipelineStatusError ? <div className="admin-pipeline-status-error" role="alert">
            <p>{pipelineStatus ? `Refresh failed. Showing data checked at ${formatCheckedAt(checkedAt)}.` : "Refresh failed."} {pipelineStatusError}</p>
            <button type="button" disabled={isLoadingPipelineSnapshot} onClick={() => void refreshPipelineSnapshot(undefined, { force: true })}>Retry refresh</button>
          </div> : null}
          {pipelineStatus ? (
            <div
              aria-live="polite"
              className={`admin-pipeline-next-action${
                pipelineStatus.recommendedAction === "fix_errors"
                  ? " is-warning"
                  : ""
              }`}
            >
              <span>Do this next</span>
              <strong>
                {PIPELINE_ACTION_LABELS[pipelineStatus.recommendedAction]}
              </strong>
              <small>
                Checked{" "}
                {new Date(pipelineStatus.fetchedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </small>
            </div>
          ) : pipelineStatusError ? (
            <p className="admin-pipeline-status-error" role="alert">
              Status unavailable: {pipelineStatusError}
            </p>
          ) : (
            <p className="admin-pipeline-status-loading" aria-live="polite">
              Checking the Google Sheet…
            </p>
          )}
          {pipelineStatus && pipelineStatus.validationErrors > 0 ? (
            <p className="admin-pipeline-status-error" role="alert">
              {pipelineStatus.validationErrors} pipeline {pipelineStatus.validationErrors === 1 ? "issue needs" : "issues need"} correction. See the affected rows and fields below.
            </p>
          ) : null}
          <dl className="admin-pipeline-counts">
            <div><dt>New captures</dt><dd>{pipelineStatus?.capture.new ?? "–"}</dd></div>
            <div><dt>Ready for lookup</dt><dd>{pipelineStatus?.capture.ready ?? "–"}</dd></div>
            <div><dt>Candidates to review</dt><dd>{pipelineStatus?.review.candidate ?? "–"}</dd></div>
            <div><dt>Ready to publish</dt><dd>{pipelineStatus?.readyToPublish ?? "–"}</dd></div>
            <div><dt>App changes</dt><dd>{pipelineStatus?.appChanges ?? "–"}</dd></div>
          </dl>

        </section>

        <AdminCaptureQueue captures={captureQueue} isLoading={isLoadingPipelineSnapshot} hasLoaded={pipelineStatus !== null} disabled={isLoadingPipelineSnapshot || Boolean(pipelineStatusError)} adminPassword={adminPassword} sheetId={pipelineSheetId.trim()} onMarkedReady={() => void refreshPipelineSnapshot(undefined, { force: true })} />
        {validationIssues.length ? <section className="admin-pipeline-status-error" aria-label="Rows that need correction">
          <h3>Rows that need correction</h3><ul>{validationIssues.map((issue, index) => <li key={index}>{issue.section} · Row {issue.rowNumber}: {issue.errors.join(" ")}</li>)}</ul>
          <p>Correct these fields, then retry the affected preview. Other candidates remain available below.</p>
        </section> : null}
        {reviewCandidateError ? <button type="button" disabled={isLoadingPipelineSnapshot} onClick={() => void refreshPipelineSnapshot(undefined, { force: true })}>Retry candidate refresh</button> : null}
        <AdminReviewQueue
          candidates={reviewCandidates}
          categoryOptions={categoryOptions}
          error={reviewCandidateError}
          isLoading={isLoadingPipelineSnapshot}
          message={reviewCandidateMessage}
          onDecision={updateReviewCandidateDecision}
          updatingKey={updatingReviewCandidateKey}
        />



        <section className="admin-pipeline-workflow" aria-label="Pipeline workflow">
          <article className="admin-pipeline-step">
            <span className="admin-pipeline-step-number">1</span>
            <div>
              <h3>Enrich Ready Captures</h3>
              <p>Looks up Capture rows marked Ready using Google Places. Review the resulting candidates before publishing.</p>
            </div>
            <button
              className="admin-pipeline-action is-secondary"
              disabled={isReviewingNewPlaces}
              onClick={reviewNewPlaces}
              type="button"
            >
              {isReviewingNewPlaces ? "Processing..." : "Process Ready Rows"}
            </button>
            {lookupError ? <p className="admin-error" role="alert">{lookupError} <button type="button" onClick={() => void reviewNewPlaces()}>Retry lookup</button></p> : null}
          </article>

          <article className="admin-pipeline-step">
            <span className="admin-pipeline-step-number">2</span>
            <div>
              <h3>Publish Verified Reviews</h3>
              <p>Preview verified Review rows, then apply the changes to Published.</p>
            </div>
            <div className="admin-pipeline-step-actions">
            <button
              className="admin-pipeline-action is-secondary"
              disabled={isPublishingApprovedPlaces}
              onClick={() => publishApprovedPlaces(false)}
              type="button"
            >
              {isPublishingApprovedPlaces
                ? "Working..."
                : "Preview Publish"}
            </button>
            <button
              className="admin-pipeline-action is-primary"
              disabled={
                isPublishingApprovedPlaces ||
                pipelinePublishResult?.mode !== "preview" ||
                pipelinePublishResult?.canApply !== true ||
                (pipelinePublishResult.rowsToPublish ?? 0) === 0 ||
                Boolean(pipelinePublishResult.validationIssues)
              }
              onClick={() => publishApprovedPlaces(true)}
              type="button"
            >
              Apply Publish
            </button>
            {publishError ? <p className="admin-error" role="alert">{publishError} <button type="button" onClick={() => void publishApprovedPlaces(false)}>Retry Publish preview</button></p> : null}
            </div>
          </article>

          <article className="admin-pipeline-step">
            <span className="admin-pipeline-step-number">3</span>
            <div>
              <h3>Update Travel Map</h3>
              <p>Preview Published changes, resolve any conflicts, then update the app.</p>
            </div>
            <div className="admin-pipeline-step-actions">
            <button
              className="admin-pipeline-action is-secondary"
              disabled={isSyncingPublished}
              onClick={() => syncPublishedToApp(false)}
              type="button"
            >
              {isSyncingPublished ? "Working..." : "Preview Update"}
            </button>
            <button
              className="admin-pipeline-action is-primary"
              disabled={
                isSyncingPublished ||
                pipelineResult?.wrote !== false ||
                pipelineResult?.canApply !== true ||
                Boolean(pipelineResult.validationErrors?.length) ||
                (pipelineResult.changes?.length ?? 0) === 0
              }
              onClick={() => syncPublishedToApp(true)}
              type="button"
            >
              Apply Update
            </button>
            {syncError ? <p className="admin-error" role="alert">{syncError} <button type="button" onClick={() => void syncPublishedToApp(false)}>Retry Update preview</button></p> : null}
            </div>
          </article>
        </section>

        <details className="admin-workflow-reference">
          <summary>Workflow guide · Coming back after a break?</summary>
          <p>Find the stage that matches your Sheet. Use column headers; column letters may move.</p>
          <ol className="admin-pipeline-resume-list">
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Capture</span>
                <strong>{pipelineStatus?.capture.new ?? "–"}</strong>
              </div>
              <code>intakeStatus = New</code>
              <p>Select it in New captures, then choose <strong>Mark ready</strong>. This does not verify or publish it.</p>
            </li>
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Capture</span>
                <strong>{pipelineStatus?.capture.ready ?? "–"}</strong>
              </div>
              <code>intakeStatus = Ready</code>
              <p>Select <strong>Process Ready Rows</strong>.</p>
            </li>
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Capture → Review</span>
                <strong>{pipelineStatus?.review.candidate ?? "–"}</strong>
              </div>
              <code>intakeStatus = Enriched</code>
              <code>reviewStatus = Candidate</code>
              <p>
                Lookup is complete, but the place is not verified. Use Candidate
                review to open Maps, then verify or reject the match.
              </p>
            </li>
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Review</span>
                <strong>{pipelineStatus?.readyToPublish ?? "–"}</strong>
              </div>
              <code>reviewStatus = Verified</code>
              <p>
                {pipelineStatus
                  ? `${pipelineStatus.readyToPublish} change${pipelineStatus.readyToPublish === 1 ? "" : "s"} waiting to publish.`
                  : "Preview, then apply Publish."}
              </p>
            </li>
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Published</span>
                <strong
                  className={
                    validationIssues.some((issue) => issue.section === "sync") ? "is-warning" : undefined
                  }
                >
                  {pipelineStatus?.appChanges ?? "–"}
                </strong>
              </div>
              <code>verifiedStatus = Verified</code>
              <p>
                {validationIssues.some((issue) => issue.section === "sync")
                  ? "Correct the listed Published rows before updating the app."
                  : "No status edit is needed; preview and apply the travel-map update."}
              </p>
            </li>
          </ol>
          <p>Google lookup creates candidates, not verification. Review each venue and pin before publishing. Preview and Apply remain separate steps; Published needs no further status edit. After updating, open the Field Guide to check the result.</p>
        </details>

        <details className="admin-pipeline-settings">
          <summary>Advanced settings</summary>
          <div className="admin-pipeline-settings-grid">
            <label>
              <span>Sheet ID</span>
              <input
                className="admin-draft-input"
                disabled={isReviewingNewPlaces || isPublishingApprovedPlaces || isSyncingPublished || updatingReviewCandidateKey !== null}
                onChange={(event) => {
                  ++snapshotGenerationRef.current;
                  pipelineSnapshotRequestRef.current = null;
                  setIsLoadingPipelineSnapshot(false);
                  setCaptureQueue([]);
                  setValidationIssues([]);
                  setCheckedAt(null);
                  setPipelineSheetId(event.target.value);
                  setPipelineStatus(null);
                  setPipelineStatusError(null);
                  setLookupError(null);
                  setSyncError(null);
                  setPublishError(null);
                  setPipelinePublishResult(null);
                  setPipelineResult(null);
                  setReviewCandidates([]);
                  setReviewCandidateError(null);
                  setReviewCandidateMessage(null);
                }}
                value={pipelineSheetId}
              />
            </label>
            <label className="admin-pipeline-max-calls">
              <span>Max API calls per run</span>
              <small>Used by Process Ready Rows.</small>
              <input
                className="admin-draft-input"
                max="10"
                min="1"
                onChange={(event) => setPipelineMaxApiCalls(event.target.value)}
                type="number"
                value={pipelineMaxApiCalls}
              />
            </label>
          </div>
        </details>
      </div>
      <section className="admin-pipeline-results" aria-label="Pipeline results">
        <h3>Result summary</h3>
        {pipelineReviewMessage ||
        pipelineMessage ||
        pipelinePublishMessage ||
        pipelineReviewResult ||
        pipelinePublishResult ||
        pipelineResult ? null : (
          <p className="admin-empty">
            Run a pipeline step to see the latest summary here.
          </p>
        )}
        {pipelineReviewMessage ? (
          <p className="admin-success">{pipelineReviewMessage}</p>
        ) : null}
        {pipelineReviewResult ? (
          <div className="admin-export-result">
          <strong>Review New Places summary</strong>
          <div className="admin-preview-chips">
                <span>
                  <strong>{pipelineReviewResult.enrichedRows ?? 0}</strong>{" "}
                  enriched
                </span>
                <span>
                  <strong>{pipelineReviewResult.reconciledRows ?? 0}</strong>{" "}
                  retries reconciled
                </span>
            <span>
              <strong>{pipelineReviewResult.skippedRows ?? 0}</strong> skipped
            </span>
            <span>
              <strong>{pipelineReviewResult.apiCallsMade ?? 0}</strong> API calls
            </span>
            <span
              className={
                pipelineReviewResult.blankRawName ? "is-warning" : undefined
              }
            >
              <strong>{pipelineReviewResult.blankRawName ?? 0}</strong>{" "}
              blankRawName
            </span>
          </div>
          {pipelineReviewResult.duplicateReviewRows?.length ? (
            <ul className="admin-note-list">
              {pipelineReviewResult.duplicateReviewRows
                .slice(0, 8)
                .map((row) => (
                  <li key={`duplicate-review-${row.rowNumber}-${row.id}`}>
                    Row {row.rowNumber}: skipped duplicate Review id {row.id}
                  </li>
                ))}
            </ul>
          ) : pipelineReviewResult.duplicateReviewIds?.length ? (
            <ul className="admin-note-list">
              {pipelineReviewResult.duplicateReviewIds
                .slice(0, 8)
                .map((id) => (
                  <li key={`duplicate-review-${id}`}>
                    Skipped duplicate Review id: {id}
                  </li>
                ))}
            </ul>
          ) : null}
          {pipelineReviewResult.skippedRowDetails?.length ? (
            <ul className="admin-note-list">
              {pipelineReviewResult.skippedRowDetails
                .slice(0, 8)
                .map((row) => (
                  <li key={`review-skip-${row.rowNumber}-${row.reason}`}>
                    Row {row.rowNumber}: {row.reason}
                  </li>
              ))}
            </ul>
          ) : null}
        </div>
        ) : null}
        {pipelineMessage ? (
          <p className="admin-success">{pipelineMessage}</p>
        ) : null}
        {pipelinePublishMessage ? (
          <p className="admin-success">{pipelinePublishMessage}</p>
        ) : null}
        {pipelinePublishResult ? (
          <div className="admin-export-result">
          <strong>
            {pipelinePublishResult.wrote
              ? "Publish complete"
              : "Verified Review preview"}
          </strong>
          <div className="admin-preview-chips">
            <span>
              <strong>
                {pipelinePublishResult.verifiedRowsFound ??
                  pipelinePublishResult.approvedRowsFound ??
                  0}
              </strong>{" "}
              verified
            </span>
                <span>
                  <strong>{pipelinePublishResult.rowsToPublish ?? 0}</strong>{" "}
                  publishable
                </span>
                <span>
                  <strong>{pipelinePublishResult.rowsToUpdate ?? 0}</strong>{" "}
                  corrections
                </span>
            <span>
              <strong>{pipelinePublishResult.rowsSkipped ?? 0}</strong> skipped
            </span>
            <span
              className={
                pipelinePublishResult.validationIssues ? "is-warning" : undefined
              }
            >
              <strong>{pipelinePublishResult.validationIssues ?? 0}</strong>{" "}
              validation issues
            </span>
          </div>
          {pipelinePublishResult.validationErrors?.length ? <ul className="admin-note-list">{pipelinePublishResult.validationErrors.map((row) => <li key={`${row.rowNumber}-${row.id}`}>Review row {row.rowNumber} ({row.id}): {row.errors.join(" ")}</li>)}</ul> : null}
          {pipelinePublishResult.fieldChanges?.length ? (
            <PipelineChanges rows={pipelinePublishResult.fieldChanges} />
          ) : null}
          <p>Publication sets the check date when applied. If a write fails, preview again before retrying.</p>
          {pipelinePublishResult.duplicateIdsSkipped?.length ? (
            <ul className="admin-note-list">
              {pipelinePublishResult.duplicateIdsSkipped
                .slice(0, 8)
                .map((id) => (
                  <li key={`duplicate-publish-${id}`}>
                    Skipped duplicate id: {id}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
        ) : null}
        {pipelineResult ? (
          <div className="admin-export-result">
          <strong>
            {pipelineResult.wrote ? "Write complete" : "Dry run summary"}
          </strong>
          <div className="admin-preview-chips">
            <span>
              <strong>{pipelineResult.rowsRead ?? 0}</strong> rows read
            </span>
            <span>
              <strong>{pipelineResult.inserted ?? 0}</strong> inserted
            </span>
            <span>
              <strong>{pipelineResult.updated ?? 0}</strong> updated
            </span>
            <span>
              <strong>{pipelineResult.skipped ?? 0}</strong> skipped
            </span>
            <span
              className={
                pipelineResult.validationErrors?.length ? "is-warning" : undefined
              }
            >
              <strong>{pipelineResult.validationErrors?.length ?? 0}</strong>{" "}
              validation errors
            </span>
          </div>
          {pipelineResult.verificationConflicts?.length ? <AdminConflictReview
            conflicts={pipelineResult.verificationConflicts}
            sheetId={pipelineSheetId.trim()}
            publishedTabId={pipelineResult.publishedTabId}
            previewHash={pipelineResult.previewHash}
            adminPassword={adminPassword}
            isPreviewing={isSyncingPublished}
            onPreviewAgain={() => void syncPublishedToApp(false)}
            onInvalidated={() => setPipelineResult((current) => current ? { ...current, previewHash: undefined, canApply: false } : null)}
            onVerified={(name) => {
              setPipelineResult((current) => current ? { ...current, previewHash: undefined, canApply: false } : null);
              setPipelineMessage(`Verified ${name}. Select Preview again to refresh the remaining changes.`);
              setPipelinePublishResult(null);
            }}
          /> : null}
          {pipelineResult.preservedClosures?.length ? <ul className="admin-note-list">
            {pipelineResult.preservedClosures.map((row) => <li key={row.id}>Preserved local closure: {row.name} · Row {row.rowNumber}</li>)}
          </ul> : null}
          {pipelineResult.validationErrors?.length ? <ul className="admin-note-list">
            {pipelineResult.validationErrors.map((row) => <li key={`${row.id}-${row.rowNumber}`}>Row {row.rowNumber} ({row.id}): {row.errors.join(" ")}</li>)}
          </ul> : null}
          {pipelineResult.changes?.length ? <PipelineChanges rows={pipelineResult.changes} /> : null}
          <p>If Apply fails, refresh with Preview Update before retrying.</p>
      </div>
        ) : null}
      </section>
    </details>
  );

}
