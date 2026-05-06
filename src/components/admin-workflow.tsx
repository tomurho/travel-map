"use client";

import { useState } from "react";

import { formatDistance } from "@/lib/geo";

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
  duplicateMatches?: Array<{
    address: string;
    category: string;
    distanceKm: number | null;
    id: string;
    name: string;
    reason: string;
  }>;
};

type ResolveResponse = {
  drafts: ResolveDraft[];
  warnings: string[];
};

type AdminWorkflowProps = {
  categoryOptions: string[];
  cityOptions: string[];
};

const CATEGORY_ALIASES: Record<string, string> = {
  coffee: "Coffee",
  "coffee roaster": "Coffee",
  "coffee roasters": "Coffee",
  "coffee shop": "Coffee",
  "coffee store": "Coffee",
  pastry: "Pastries",
  patisserie: "Pastries",
  "wine bar": "Wine bar",
};

function normalizeCategoryInput(category: string, categoryOptions: string[]) {
  const trimmedCategory = category.trim();
  const lowerCategory = trimmedCategory.toLowerCase();

  if (!trimmedCategory) {
    return "";
  }

  const alias = CATEGORY_ALIASES[lowerCategory];
  if (alias) {
    return alias;
  }

  const existingCategory = categoryOptions.find(
    (option) => option.toLowerCase() === lowerCategory,
  );

  return existingCategory ?? trimmedCategory;
}

function getAdminStatusLabel(place: StagedPlace) {
  if (place.loved) {
    return "Loved it";
  }

  if (place.status === "been") {
    return "Been";
  }

  if (place.status === "want_to_go") {
    return "Want to go";
  }

  return "Location";
}

export function AdminWorkflow({
  categoryOptions,
  cityOptions,
}: AdminWorkflowProps) {
  const [cityHint, setCityHint] = useState("all");
  const [plainText, setPlainText] = useState("");
  const [placeUrl, setPlaceUrl] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ResolveResponse | null>(null);
  const [draftStatuses, setDraftStatuses] = useState<Record<string, DraftStatus>>({});
  const [draftCategories, setDraftCategories] = useState<Record<string, string>>({});
  const [approvedDraftKeys, setApprovedDraftKeys] = useState<Record<string, boolean>>(
    {},
  );
  const [stagedPlaces, setStagedPlaces] = useState<StagedPlace[]>([]);
  const [stagedMessage, setStagedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [stagingDraftKey, setStagingDraftKey] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [duplicatePublishPending, setDuplicatePublishPending] = useState(false);
  const [isGeneratingDatasetExport, setIsGeneratingDatasetExport] = useState(false);
  const [datasetExport, setDatasetExport] = useState<{
    downloadUrl: string;
    filePath: string;
  } | null>(null);
  const [deletingStagedId, setDeletingStagedId] = useState<string | null>(null);
  const stagedDuplicateCount = stagedPlaces.filter(
    (place) => place.duplicateMatches?.length,
  ).length;
  const stagedMissingCoordinateCount = stagedPlaces.filter(
    (place) => place.latitude === null || place.longitude === null,
  ).length;
  const stagedCityNames = Array.from(
    new Set(stagedPlaces.map((place) => place.city).filter(Boolean)),
  ).sort((firstCity, secondCity) => firstCity.localeCompare(secondCity));
  const stagedStatusSummary = stagedPlaces.reduce(
    (summary, place) => ({
      ...summary,
      [getAdminStatusLabel(place)]:
        (summary[getAdminStatusLabel(place)] ?? 0) + 1,
    }),
    {} as Record<string, number>,
  );

  function getDraftKey(draft: ResolveDraft) {
    return `${draft.city}-${draft.name}-${draft.sourceLabel}`;
  }

  function setDraftStatus(draftKey: string, status: DraftStatus) {
    setDraftStatuses((currentStatuses) => ({
      ...currentStatuses,
      [draftKey]: status,
    }));
  }

  function setDraftCategory(draftKey: string, category: string) {
    setDraftCategories((currentCategories) => ({
      ...currentCategories,
      [draftKey]: category,
    }));
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

    for (const file of files) {
      formData.append("images", file);
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
      setDraftCategories({});
      setApprovedDraftKeys({});
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
          category: normalizeCategoryInput(
            draftCategories[draftKey] ?? draft.category,
            categoryOptions,
          ),
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
      setDuplicatePublishPending(false);
      setStagedMessage(`Approved ${draft.name}.`);
      setApprovedDraftKeys((currentKeys) => ({
        ...currentKeys,
        [draftKey]: true,
      }));
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
      setDuplicatePublishPending(false);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load staged places.",
      );
    }
  }

  async function publishStagedPlaces() {
    if (stagedMissingCoordinateCount > 0) {
      setError(
        `Remove or fix ${stagedMissingCoordinateCount} staged place${
          stagedMissingCoordinateCount === 1 ? "" : "s"
        } without coordinates before publishing.`,
      );
      return;
    }

    const duplicateCount = stagedPlaces.filter(
      (place) => place.duplicateMatches?.length,
    ).length;
    const confirmed = window.confirm(
      duplicatePublishPending
        ? `Publish anyway and keep ${duplicateCount} possible duplicate${
            duplicateCount === 1 ? "" : "s"
          } as staged entries?`
        : "Publish all staged places into the live local map dataset?",
    );

    if (!confirmed) {
      return;
    }

    setIsPublishing(true);
    setError(null);
    setStagedMessage(null);

    try {
      const params = new URLSearchParams();

      if (duplicatePublishPending) {
        params.set("allowDuplicates", "true");
      }

      const publishUrl = `/api/admin/staged-places/publish${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      const response = await fetch(publishUrl, {
        method: "POST",
        headers: authHeaders(),
      });
      const payload = (await response.json()) as {
        duplicatePlaces?: Array<{
          place: StagedPlace;
          duplicateMatches: NonNullable<StagedPlace["duplicateMatches"]>;
        }>;
        error?: string;
        publishedCount?: number;
        requiresDuplicateConfirmation?: boolean;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not publish staged places.");
      }

      if (payload.requiresDuplicateConfirmation) {
        const duplicateIds = new Set(
          (payload.duplicatePlaces ?? []).map(({ place }) => place.id),
        );

        setStagedPlaces((currentPlaces) =>
          currentPlaces.map((place) => {
            const duplicatePlace = payload.duplicatePlaces?.find(
              ({ place: pendingPlace }) => pendingPlace.id === place.id,
            );

            return duplicateIds.has(place.id) && duplicatePlace
              ? {
                  ...place,
                  duplicateMatches: duplicatePlace.duplicateMatches,
                }
              : place;
          }),
        );
        setDuplicatePublishPending(true);
        setStagedMessage(
          `Found ${payload.duplicatePlaces?.length ?? 0} possible duplicate${
            payload.duplicatePlaces?.length === 1 ? "" : "s"
          }. Review warnings, remove staged rows you do not want, or publish anyway.`,
        );
        return;
      }

      setStagedPlaces([]);
      setDuplicatePublishPending(false);
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

  async function generateLocalDatasetExport() {
    setIsGeneratingDatasetExport(true);
    setError(null);
    setDatasetExport(null);

    try {
      const response = await fetch("/api/admin/places/export/local", {
        method: "POST",
        headers: authHeaders(),
      });
      const payload = (await response.json()) as {
        downloadUrl?: string;
        error?: string;
        filePath?: string;
      };

      if (!response.ok || !payload.downloadUrl || !payload.filePath) {
        throw new Error(payload.error ?? "Could not generate the Excel file.");
      }

      setDatasetExport({
        downloadUrl: payload.downloadUrl,
        filePath: payload.filePath,
      });
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Could not generate the Excel file.",
      );
    } finally {
      setIsGeneratingDatasetExport(false);
    }
  }

  async function deleteStagedPlace(place: StagedPlace) {
    const confirmed = window.confirm(`Remove ${place.name} from staging?`);

    if (!confirmed) {
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
      setDuplicatePublishPending(false);
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
    const confirmed = window.confirm("Clear all approved staged places?");

    if (!confirmed) {
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
      setDuplicatePublishPending(false);
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
          will turn that into a structured draft with address, area, category,
          coordinates, and city-specific extra fields.
        </p>
      </section>

      <section className="admin-grid">
        <section className="panel admin-form-panel">
          <h2>Capture input</h2>
          <form className="admin-form" onSubmit={handleSubmit}>
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
              Screenshots or images
              <input
                accept="image/*"
                multiple
                onChange={(event) =>
                  setFiles(Array.from(event.target.files ?? []))
                }
                type="file"
              />
              {files.length ? (
                <span className="admin-file-count">
                  {files.length} image{files.length === 1 ? "" : "s"} selected
                </span>
              ) : null}
            </label>

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
                const draftCategory =
                  draftCategories[draftKey] ?? draft.category ?? draft.googleCategory ?? "";
                const isApproved = approvedDraftKeys[draftKey] ?? false;

                return (
                  <article
                    className={`admin-draft-card${
                      isApproved ? " is-approved" : ""
                    }`}
                    key={draftKey}
                  >
                    <div className="admin-draft-header">
                      <div>
                        <h3>{draft.name || "Unresolved place"}</h3>
                        <p className="admin-source">{draft.sourceLabel}</p>
                      </div>
                      <span className="badge admin-city-badge">{draft.city}</span>
                    </div>

                    <div
                      className="admin-status-group"
                      aria-label={`Status for ${draft.name}`}
                    >
                      <button
                        className={`admin-status-pill${
                          draftStatus === "location" ? " is-active" : ""
                        }`}
                        onClick={() => setDraftStatus(draftKey, "location")}
                        type="button"
                      >
                        Location
                      </button>
                      <button
                        className={`admin-status-pill${
                          draftStatus === "been" ? " is-active" : ""
                        }`}
                        onClick={() => setDraftStatus(draftKey, "been")}
                        type="button"
                      >
                        Been
                      </button>
                      <button
                        className={`admin-status-pill loved${
                          draftStatus === "loved" ? " is-active" : ""
                        }`}
                        onClick={() => setDraftStatus(draftKey, "loved")}
                        type="button"
                      >
                        Loved it
                      </button>
                      <button
                        className={`admin-status-pill${
                          draftStatus === "want_to_go" ? " is-active" : ""
                        }`}
                        onClick={() => setDraftStatus(draftKey, "want_to_go")}
                        type="button"
                      >
                        Want to go
                      </button>
                    </div>

                    <dl className="admin-draft-fields">
                      <div>
                        <dt>Address</dt>
                        <dd>{draft.address || "-"}</dd>
                      </div>
                      <div>
                        <dt>Category</dt>
                        <dd>
                          <input
                            aria-label={`Category for ${draft.name}`}
                            className="admin-draft-input"
                            list="admin-category-options"
                            onChange={(event) =>
                              setDraftCategory(draftKey, event.target.value)
                            }
                            onBlur={(event) =>
                              setDraftCategory(
                                draftKey,
                                normalizeCategoryInput(
                                  event.target.value,
                                  categoryOptions,
                                ),
                              )
                            }
                            placeholder="Category"
                            type="text"
                            value={draftCategory}
                          />
                        </dd>
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
                        <dt>Nearest subway</dt>
                        <dd>{draft.subway || "-"}</dd>
                      </div>
                      <div>
                        <dt>Tabelog score</dt>
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
                      className={`admin-approve${
                        isApproved ? " is-approved" : ""
                      }`}
                      disabled={stagingDraftKey === draftKey}
                      onClick={() => approveDraft(draft)}
                      type="button"
                    >
                      {stagingDraftKey === draftKey
                        ? "Approving..."
                        : isApproved
                          ? "Approved"
                          : "Approve draft"}
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
              <p>
                {stagedDuplicateCount > 0
                  ? `${stagedDuplicateCount} staged place${
                      stagedDuplicateCount === 1 ? " has" : "s have"
                    } possible duplicate matches.`
                  : "Review or publish approved drafts before they join the map."}
              </p>
            </div>
            <div className="admin-staged-actions">
              <button onClick={refreshStagedPlaces} type="button">
                Refresh
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
                {isPublishing
                  ? "Publishing..."
                  : duplicatePublishPending
                    ? "Publish anyway"
                    : "Publish staged places"}
              </button>
            </div>
          </div>
          {stagedPlaces.length ? (
            <>
              <div className="admin-publish-preview">
                <div>
                  <span>Ready to publish</span>
                  <strong>
                    {stagedPlaces.length} staged place
                    {stagedPlaces.length === 1 ? "" : "s"}
                  </strong>
                  <p>
                    {stagedCityNames.length
                      ? stagedCityNames.join(", ")
                      : "No city assigned"}
                  </p>
                </div>
                <div className="admin-preview-chips">
                  {Object.entries(stagedStatusSummary).map(([status, count]) => (
                    <span key={status}>
                      <strong>{count}</strong> {status}
                    </span>
                  ))}
                  {stagedDuplicateCount > 0 ? (
                    <span className="is-warning">
                      <strong>{stagedDuplicateCount}</strong> possible duplicate
                      {stagedDuplicateCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {stagedMissingCoordinateCount > 0 ? (
                    <span className="is-blocked">
                      <strong>{stagedMissingCoordinateCount}</strong> missing coords
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="admin-staged-list">
                {stagedPlaces.map((place) => (
                  <article className="admin-staged-row" key={place.id}>
                    <div>
                      <strong>{place.name}</strong>
                      <span>
                        {place.city} - {place.category || "Uncategorized"} -{" "}
                        {getAdminStatusLabel(place)}
                      </span>
                      {place.duplicateMatches?.length ? (
                        <div className="admin-duplicate-warning">
                          <strong>Possible duplicate in approved dataset</strong>
                          {place.duplicateMatches.map((match) => (
                            <p key={match.id}>
                              <span>
                                {match.name} - {match.category || "Uncategorized"}
                                {match.distanceKm !== null
                                  ? ` - ${formatDistance(match.distanceKm)} away`
                                  : ""}
                              </span>
                              <small>{match.reason}</small>
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {place.latitude === null || place.longitude === null ? (
                        <div className="admin-duplicate-warning is-blocked">
                          <strong>Cannot publish without coordinates</strong>
                          <small>
                            Remove this staged place or resolve it again with latitude and
                            longitude.
                          </small>
                        </div>
                      ) : null}
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
            </>
          ) : (
            <p className="admin-empty">
              Approved drafts will appear here before they are merged into the
              live map dataset.
            </p>
          )}
        </section>

        <section className="panel admin-export-panel">
          <div className="admin-staged-header">
            <div>
              <h2>Approved dataset export</h2>
              <p>
                Download the full production map dataset as an Excel workbook,
                with each city split into its own worksheet.
              </p>
            </div>
            <div className="admin-staged-actions">
              <button
                disabled={isGeneratingDatasetExport}
                onClick={generateLocalDatasetExport}
                type="button"
              >
                {isGeneratingDatasetExport ? "Generating..." : "Download Excel"}
              </button>
            </div>
          </div>
          {datasetExport ? (
            <div className="admin-export-result">
              <strong>Excel file generated.</strong>
              <a download="travel-map-approved-places.xlsx" href={datasetExport.downloadUrl}>
                Open generated file
              </a>
              <code>{datasetExport.filePath}</code>
            </div>
          ) : null}
        </section>
      </section>
      <datalist id="admin-category-options">
        {categoryOptions.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </main>
  );
}
