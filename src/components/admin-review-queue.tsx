"use client";

import { useId, useMemo, useState } from "react";

import { findCanonicalCategory } from "@/lib/place-category";
import type {
  ReviewCandidate,
  ReviewCandidateDecision,
  ReviewCandidateEdits,
  ReviewCandidateStatus,
} from "@/lib/place-sheet-pipeline";

function getCandidateStatus(candidate: ReviewCandidate): ReviewCandidateStatus {
  if (candidate.loved === true) {
    return "loved";
  }

  const status = candidate.status.trim().toLocaleLowerCase();

  if (status === "been" || status === "visited") {
    return "been";
  }

  if (status === "want to go" || status === "want_to_go") {
    return "want_to_go";
  }

  return "location";
}

function isEditableValidationIssue(issue: string) {
  return issue === "Missing category." || issue === "Invalid status.";
}

function AdminReviewCandidateCard({
  candidate,
  categoryOptions,
  isUpdating,
  onDecision,
}: {
  candidate: ReviewCandidate;
  categoryOptions: string[];
  isUpdating: boolean;
  onDecision: (
    candidate: ReviewCandidate,
    decision: ReviewCandidateDecision,
    edits?: ReviewCandidateEdits,
  ) => void;
}) {
  const categoryListId = useId();
  const [category, setCategory] = useState(candidate.category);
  const [status, setStatus] = useState<ReviewCandidateStatus>(() =>
    getCandidateStatus(candidate),
  );
  const canonicalCategory = useMemo(
    () => findCanonicalCategory(category, categoryOptions),
    [category, categoryOptions],
  );
  const blockingIssues = candidate.validationIssues.filter(
    (issue) => !isEditableValidationIssue(issue),
  );
  const categoryError = category.trim()
    ? canonicalCategory
      ? null
      : "Choose an existing category from the suggestions."
    : "Choose a category before verifying.";
  const candidateKey = `${candidate.rowNumber}:${candidate.id}`;
  const displayName = candidate.candidateName || candidate.rawName;

  return (
    <article className="admin-review-candidate" key={candidateKey}>
      <div className="admin-review-candidate-heading">
        <div>
          <span>Captured as {candidate.rawName || "Unnamed place"}</span>
          <h4>{displayName || "Candidate without a name"}</h4>
        </div>
        <small>Row {candidate.rowNumber}</small>
      </div>

      <dl className="admin-review-candidate-details">
        <div>
          <dt>Address</dt>
          <dd>{candidate.candidateAddress || "Not populated"}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            {[candidate.area, candidate.city].filter(Boolean).join(" · ") ||
              "Not populated"}
          </dd>
        </div>
      </dl>

      <div className="admin-review-candidate-editors">
        <label>
          <span>Category</span>
          <input
            aria-describedby={categoryError ? `${categoryListId}-error` : undefined}
            aria-invalid={Boolean(categoryError)}
            autoComplete="off"
            disabled={isUpdating}
            list={categoryListId}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Choose an existing category"
            value={category}
          />
          <datalist id={categoryListId}>
            {categoryOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          {categoryError ? (
            <small className="admin-review-field-error" id={`${categoryListId}-error`}>
              {categoryError}
            </small>
          ) : null}
        </label>
        <label>
          <span>Status</span>
          <select
            disabled={isUpdating}
            onChange={(event) =>
              setStatus(event.target.value as ReviewCandidateStatus)
            }
            value={status}
          >
            <option value="location">Saved</option>
            <option value="want_to_go">Want to go</option>
            <option value="been">Been</option>
            <option value="loved">Loved</option>
          </select>
        </label>
      </div>

      {candidate.notes ? (
        <p className="admin-review-candidate-note">{candidate.notes}</p>
      ) : null}
      {blockingIssues.length > 0 ? (
        <div className="admin-review-candidate-warning" role="status">
          <strong>Cannot verify yet</strong>
          <span>{blockingIssues.join(" ")}</span>
        </div>
      ) : null}

      <div className="admin-review-candidate-actions">
        {candidate.candidateGoogleMapsUrl ? (
          <a
            href={candidate.candidateGoogleMapsUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open in Google Maps ↗
          </a>
        ) : (
          <span>Google Maps link unavailable</span>
        )}
        <div>
          <button
            className="admin-pipeline-action is-secondary"
            disabled={isUpdating}
            onClick={() => onDecision(candidate, "reject")}
            type="button"
          >
            Reject
          </button>
          <button
            className="admin-pipeline-action is-primary"
            disabled={
              isUpdating || blockingIssues.length > 0 || !canonicalCategory
            }
            onClick={() =>
              onDecision(candidate, "verify", {
                category: canonicalCategory ?? category,
                status,
              })
            }
            type="button"
          >
            {isUpdating ? "Updating…" : "Verify"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function AdminReviewQueue({
  candidates,
  categoryOptions,
  error,
  isLoading,
  message,
  onDecision,
  updatingKey,
}: {
  candidates: ReviewCandidate[];
  categoryOptions: string[];
  error: string | null;
  isLoading: boolean;
  message: string | null;
  onDecision: (
    candidate: ReviewCandidate,
    decision: ReviewCandidateDecision,
    edits?: ReviewCandidateEdits,
  ) => void;
  updatingKey: string | null;
}) {
  return (
    <section
      aria-labelledby="admin-review-candidates-title"
      className="admin-review-queue"
    >
      <div className="admin-review-queue-header">
        <div>
          <span>Review sheet</span>
          <h3 id="admin-review-candidates-title">Candidate review</h3>
          <p>
            Compare each Google result with the captured place. Set its category
            and status, then verify the match or reject it; publishing remains a
            separate step.
          </p>
        </div>
        <strong>
          {error
            ? "Unavailable"
            : isLoading && candidates.length === 0
              ? "Checking…"
              : `${candidates.length} waiting`}
        </strong>
      </div>

      {message ? (
        <p aria-live="polite" className="admin-success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="admin-pipeline-status-error" role="alert">
          {candidates.length > 0
            ? `Candidate refresh paused: ${error}`
            : `Candidate review unavailable: ${error}`}
        </p>
      ) : null}
      {isLoading && candidates.length === 0 ? (
        <p className="admin-pipeline-status-loading">Checking Review…</p>
      ) : null}
      {!isLoading && !error && candidates.length === 0 ? (
        <p className="admin-empty">No Candidate rows are waiting for review.</p>
      ) : null}

      {candidates.length > 0 ? (
        <div className="admin-review-candidate-list">
          {candidates.map((candidate) => {
            const candidateKey = `${candidate.rowNumber}:${candidate.id}`;

            return (
              <AdminReviewCandidateCard
                candidate={candidate}
                categoryOptions={categoryOptions}
                isUpdating={updatingKey === candidateKey}
                key={candidateKey}
                onDecision={onDecision}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
