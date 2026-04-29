"use client";

import { useState } from "react";

type ResolveDraft = {
  sourceLabel: string;
  city: string;
  name: string;
  address: string;
  category: string;
  area: string;
  latitude: number | null;
  longitude: number | null;
  subway: string;
  tabelog: string;
  googleCategory: string;
  notes: string[];
};

type DraftStatus = "location" | "been" | "loved" | "want_to_go";

type StagedPlace = {
  id: string;
  name: string;
  city: string;
  category: string;
  status: "location" | "been" | "want_to_go";
  loved: boolean | null;
  district: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  tabelog: string;
  subway: string;
};

type ResolveResponse = {
  drafts: ResolveDraft[];
  warnings: string[];
};

type AdminWorkflowProps = {
  cityOptions: string[];
};

export function AdminWorkflow({ cityOptions }: AdminWorkflowProps) {
  const [cityHint, setCityHint] = useState("all");
  const [plainText, setPlainText] = useState("");
  const [placeUrl, setPlaceUrl] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ResolveResponse | null>(null);
  const [draftStatuses, setDraftStatuses] = useState<Record<string, DraftStatus>>({});
  const [stagedPlaces, setStagedPlaces] = useState<StagedPlace[]>([]);
  const [stagedMessage, setStagedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [stagingDraftKey, setStagingDraftKey] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [deletingStagedId, setDeletingStagedId] = useState<string | null>(null);

  function getDraftKey(draft: ResolveDraft) {
    return `${draft.city}-${draft.name}-${draft.sourceLabel}`;
  }

  function authHeaders() {
    return adminPassword
      ? {
          "x-admin-password": adminPassword,
        }
      : undefined;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.set("cityHint", cityHint);
    formData.set("plainText", plainText);
    formData.set("placeUrl", placeUrl);

    if (file) {
      formData.set("image", file);
    }

    try {
      const response = await fetch("/api/admin/resolve-places", {
        method: "POST",
        body: formData,
        headers: authHeaders(),
      });
      const payload = (await response.json()) as ResolveResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Place resolution failed.");
      }

      setResult(payload);
      setDraftStatuses({});
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Place resolution failed.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function approveDraft(draft: ResolveDraft) {
    const draftKey = getDraftKey(draft);
    setStagingDraftKey(draftKey);
    setError(null);
    setStagedMessage(null);

    try {
      const response = await fetch("/api/admin/staged-places", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders() ?? {}),
        },
        body: JSON.stringify({
          ...draft,
          draftStatus: draftStatuses[draftKey] ?? "location",
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        places?: StagedPlace[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not approve this draft.");
      }

      setStagedPlaces(payload.places ?? []);
      setStagedMessage(`Approved ${draft.name}.`);
    } catch (approvalError) {
      setError(
        approvalError instanceof Error
          ? approvalError.message
          : "Could not approve this draft.",
      );
    } finally {
      setStagingDraftKey(null);
    }
  }

  async function refreshStagedPlaces() {
    setError(null);

    try {
      const response = await fetch("/api/admin/staged-places", {
        headers: authHeaders(),
      });
      const payload = (await response.json()) as {
        error?: string;
        places?: StagedPlace[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load staged places.");
      }

      setStagedPlaces(payload.places ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load staged places.",
      );
    }
  }

  function downloadStagedPlaces() {
    const params = new URLSearchParams();

    if (adminPassword) {
      params.set("adminPassword", adminPassword);
    }

    window.location.href = `/api/admin/staged-places/export${
      params.toString() ? `?${params.toString()}` : ""
    }`;
  }

  async function publishStagedPlaces() {
    if (!window.confirm("Publish all staged places into the live local map dataset?")) {
      return;
    }

    setIsPublishing(true);
    setError(null);
    setStagedMessage(null);

    try {
      const response = await fetch("/api/admin/staged-places/publish", {
        method: "POST",
        headers: authHeaders(),
      });
      const payload = (await response.json()) as {
        error?: string;
        publishedCount?: number;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not publish staged places.");
      }

      setStagedPlaces([]);
      setStagedMessage(`Published ${payload.publishedCount ?? 0} staged places.`);
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Could not publish staged places.",
      );
    } finally {
      setIsPublishing(false);
    }
  }

  async function deleteStagedPlace(place: StagedPlace) {
    if (!window.confirm(`Remove ${place.name} from staging?`)) {
      return;
    }

    setDeletingStagedId(place.id);
    setError(null);
    setStagedMessage(null);

    try {
      const params = new URLSearchParams({ id: place.id });
      const response = await fetch(`/api/admin/staged-places?${params.toString()}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const payload = (await response.json()) as {
        error?: string;
        places?: StagedPlace[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not delete staged place.");
      }

      setStagedPlaces(payload.places ?? []);
      setStagedMessage(`Removed ${place.name} from staging.`);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete staged place.",
      );
    } finally {
      setDeletingStagedId(null);
    }
  }

  async function clearAllStagedPlaces() {
    if (!window.confirm("Clear all approved staged places?")) {
      return;
    }

    setDeletingStagedId("all");
    setError(null);
    setStagedMessage(null);

    try {
      const response = await fetch("/api/admin/staged-places", {
        method: "DELETE",
        headers: authHeaders(),
      });
      const payload = (await response.json()) as {
        error?: string;
        places?: StagedPlace[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not clear staged places.");
      }

      setStagedPlaces(payload.places ?? []);
      setStagedMessage("Cleared approved staging.");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not clear staged places.",
      );
    } finally {
      setDeletingStagedId(null);
    }
  }

  return (
    <main className="shell admin-shell">
      <section className="hero panel admin-hero">
        <h1>Place intake.</h1>
        <p>
          Paste names, drop in a place URL, or upload a screenshot. The workflow
          turns that into a structured draft with address, area, category,
          coordinates, and city-specific extra fields.
        </p>
      </section>

      <section className="admin-grid">
        <section className="panel admin-form-panel">
          <h2>Capture input</h2>
          <form className="admin-form" onSubmit={handleSubmit}>
            <label>
              City hint
              <select
                value={cityHint}
                onChange={(event) => setCityHint(event.target.value)}
              >
                <option value="all">Auto-detect / all cities</option>
                {cityOptions.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Admin password
              <input
                autoComplete="current-password"
                onChange={(event) => setAdminPassword(event.target.value)}
                placeholder="Required after deploy"
                type="password"
                value={adminPassword}
              />
            </label>

            <label>
              Place names
              <textarea
                onChange={(event) => setPlainText(event.target.value)}
                placeholder="One place per line, or paste a short list here."
                rows={8}
                value={plainText}
              />
            </label>

            <label>
              Place URL
              <input
                onChange={(event) => setPlaceUrl(event.target.value)}
                placeholder="Instagram place/profile URL, Google Maps URL, website URL"
                type="url"
                value={placeUrl}
              />
            </label>

            <label>
              Screenshot or image
              <input
                accept="image/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>

            <button className="admin-submit" disabled={isLoading} type="submit">
              {isLoading ? "Resolving places..." : "Resolve places"}
            </button>
          </form>
        </section>

        <section className="panel admin-results-panel">
          <div className="admin-section-header">
            <h2>Structured drafts</h2>
          </div>
          {error ? <p className="admin-error">{error}</p> : null}
          {stagedMessage ? <p className="admin-success">{stagedMessage}</p> : null}
          {result?.warnings.length ? (
            <div className="admin-warning-list">
              {result.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
          {result?.drafts.length ? (
            <div className="admin-draft-list">
              {result.drafts.map((draft) => {
                const draftKey = getDraftKey(draft);
                const draftStatus = draftStatuses[draftKey] ?? "location";

                return (
                  <article className="admin-draft-card" key={draftKey}>
                    <div className="admin-draft-header">
                      <div>
                        <h3>{draft.name || "Unresolved place"}</h3>
                        <p className="admin-source">{draft.sourceLabel}</p>
                      </div>
                      <span className="badge admin-city-badge">{draft.city}</span>
                    </div>

                    <div className="admin-status-group" aria-label={`Status for ${draft.name}`}>
                      {(["location", "been", "loved", "want_to_go"] as const).map(
                        (status) => (
                          <button
                            className={`admin-status-pill${
                              status === "loved" ? " loved" : ""
                            }${draftStatus === status ? " is-active" : ""}`}
                            key={status}
                            onClick={() =>
                              setDraftStatuses((currentStatuses) => ({
                                ...currentStatuses,
                                [draftKey]: status,
                              }))
                            }
                            type="button"
                          >
                            {status === "want_to_go"
                              ? "Want to go"
                              : status === "loved"
                                ? "Loved it"
                                : status.charAt(0).toUpperCase() + status.slice(1)}
                          </button>
                        ),
                      )}
                    </div>

                    <dl className="admin-draft-fields">
                      <div>
                        <dt>Address</dt>
                        <dd>{draft.address || "-"}</dd>
                      </div>
                      <div>
                        <dt>Category</dt>
                        <dd>{draft.category || draft.googleCategory || "-"}</dd>
                      </div>
                      <div>
                        <dt>Area</dt>
                        <dd>{draft.area || "-"}</dd>
                      </div>
                      <div>
                        <dt>Latitude</dt>
                        <dd>{draft.latitude ?? "-"}</dd>
                      </div>
                      <div>
                        <dt>Longitude</dt>
                        <dd>{draft.longitude ?? "-"}</dd>
                      </div>
                      <div>
                        <dt>Subway</dt>
                        <dd>{draft.subway || "-"}</dd>
                      </div>
                      <div>
                        <dt>Tabelog</dt>
                        <dd>{draft.tabelog || "-"}</dd>
                      </div>
                    </dl>

                    {draft.notes.length ? (
                      <ul className="admin-note-list">
                        {draft.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    ) : null}

                    <button
                      className="admin-approve"
                      disabled={stagingDraftKey === draftKey}
                      onClick={() => approveDraft(draft)}
                      type="button"
                    >
                      {stagingDraftKey === draftKey ? "Approving..." : "Approve draft"}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="admin-empty">
              Submit a text list, a URL, or an image to generate structured
              place drafts here.
            </p>
          )}
        </section>

        <section className="panel admin-staged-panel">
          <div className="admin-staged-header">
            <div>
              <h2>Approved staging</h2>
              <p>Review, export, or publish approved places.</p>
            </div>
            <div className="admin-staged-actions">
              <button onClick={refreshStagedPlaces} type="button">
                Refresh
              </button>
              <button onClick={downloadStagedPlaces} type="button">
                Download Excel
              </button>
              <button
                disabled={deletingStagedId === "all" || stagedPlaces.length === 0}
                onClick={clearAllStagedPlaces}
                type="button"
              >
                {deletingStagedId === "all" ? "Clearing..." : "Clear all"}
              </button>
              <button
                disabled={isPublishing || stagedPlaces.length === 0}
                onClick={publishStagedPlaces}
                type="button"
              >
                {isPublishing ? "Publishing..." : "Publish staged places"}
              </button>
            </div>
          </div>

          {stagedPlaces.length ? (
            <div className="admin-staged-list">
              {stagedPlaces.map((place) => (
                <article className="admin-staged-row" key={place.id}>
                  <div>
                    <strong>{place.name}</strong>
                    <span>
                      {place.city} - {place.category || "Uncategorized"} -{" "}
                      {place.loved ? "Loved it" : place.status}
                    </span>
                  </div>
                  <button
                    disabled={deletingStagedId === place.id}
                    onClick={() => deleteStagedPlace(place)}
                    type="button"
                  >
                    {deletingStagedId === place.id ? "Removing..." : "Remove"}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty">
              Approved drafts will appear here before they are merged into the
              live map dataset.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}
