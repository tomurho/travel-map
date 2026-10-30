"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CatalogueEntry } from "@/lib/catalogue";
import type { Place } from "@/lib/place";
import styles from "./catalogue-admin.module.css";

type Tab = "inbox" | "review" | "live";
type Receipt = {
  confirmed: boolean;
  mode: "live" | "local";
  checkedAt: string;
  version: string;
  publicUrl: string;
};
async function call(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error ?? "Could not complete this request. Refresh before retrying.",
    );
  return data;
}
function stage(entry: CatalogueEntry): Tab {
  return entry.draft ? "review" : entry.live ? "live" : "inbox";
}
function label(entry: CatalogueEntry) {
  return entry.draft?.name ?? entry.live?.name ?? entry.input.name;
}
function ReviewEditor({
  entry,
  categories,
  busy,
  onSave,
  onAction,
  onDirty,
}: {
  entry: CatalogueEntry;
  categories: string[];
  busy: boolean;
  onSave: (
    patch: Record<string, unknown>,
    confirm: boolean,
    publish: boolean,
  ) => void;
  onAction: (action: string, extra?: Record<string, unknown>) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const draft = entry.draft!;
  const [form, setForm] = useState<Place>(draft);
  const [confirmed, setConfirmed] = useState(Boolean(entry.confirmedMatch));
  const [rejected, setRejected] = useState(Boolean(entry.matchRejected));
  useEffect(() => {
    onDirty(
      JSON.stringify(form) !== JSON.stringify(draft) ||
        confirmed !== Boolean(entry.confirmedMatch),
    );
  }, [form, confirmed, draft, entry.confirmedMatch, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const identity = (key: keyof Place, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }));
    setConfirmed(false);
    setRejected(false);
  };
  return (
    <form
      className={styles.editor}
      aria-label="Review place"
      onSubmit={(event) => {
        event.preventDefault();
        const publish =
          (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") ===
          "publish";
        const keys = [
          "name",
          "city",
          "category",
          "district",
          "address",
          "latitude",
          "longitude",
          "googleMapsUrl",
          "googlePlaceId",
          "status",
          "loved",
          "notes",
        ] as const;
        onSave(
          Object.fromEntries(
            keys.filter((k) => form[k] !== undefined).map((k) => [k, form[k]]),
          ),
          confirmed,
          publish,
        );
      }}
    >
      <fieldset disabled={busy}>
        <p className={styles.eyebrow}>
          {entry.live
            ? "Changes stay private until you publish"
            : "Check the suggested place"}
        </p>
        <h2>{draft.name}</h2>
        <p>
          Added as <strong>{entry.input.name}</strong> · {entry.input.city}
        </p>
        {entry.input.source ? (
          <details>
            <summary>Original source</summary>
            <p className={styles.source}>{entry.input.source}</p>
          </details>
        ) : null}
        <div className={styles.venue}>
          <p>{draft.address}</p>
          <a href={draft.googleMapsUrl} target="_blank" rel="noreferrer">
            Open this place in Google Maps ↗
          </a>
        </div>
        <iframe
          className={styles.map}
          title={`Map preview for ${draft.name}`}
          loading="lazy"
          src={`https://maps.google.com/maps?q=${draft.latitude},${draft.longitude}&z=17&output=embed`}
          referrerPolicy="no-referrer-when-downgrade"
        />
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() =>
            onAction("wrong", {
              patch: Object.fromEntries(
                [
                  "name",
                  "city",
                  "category",
                  "district",
                  "address",
                  "latitude",
                  "longitude",
                  "status",
                  "loved",
                  "notes",
                ].map((k) => [k, form[k as keyof Place]]),
              ),
            })
          }
        >
          Wrong place or pin
        </button>
        <div className={styles.fieldGrid}>
          <label>
            Category
            <input
              required
              list="catalogue-categories"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
            <datalist id="catalogue-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label>
            My status
            <select
              aria-label="My status"
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as Place["status"] })
              }
            >
              <option value="location">Saved</option>
              <option value="want_to_go">Want to go</option>
              <option value="been">Been</option>
            </select>
          </label>
          <label>
            My rating
            <select
              aria-label="My rating"
              value={
                form.loved === null
                  ? "unrated"
                  : form.loved
                    ? "loved"
                    : "not-loved"
              }
              onChange={(e) =>
                setForm({
                  ...form,
                  loved:
                    e.target.value === "unrated"
                      ? null
                      : e.target.value === "loved",
                })
              }
            >
              <option value="unrated">Not rated</option>
              <option value="loved">Loved it</option>
              <option value="not-loved">Not a favourite</option>
            </select>
          </label>
          <label>
            District or area
            <input
              value={form.district}
              onChange={(e) => setForm({ ...form, district: e.target.value })}
            />
          </label>
        </div>
        <label>
          Notes
          <textarea
            aria-label="Notes"
            rows={3}
            value={
              Array.isArray(form.notes)
                ? form.notes.join("\n")
                : (form.notes ?? "")
            }
            onChange={(e) =>
              setForm({ ...form, notes: e.target.value.split("\n") })
            }
          />
        </label>
        <details className={styles.corrections}>
          <summary>Correct the name, city, address, or pin</summary>
          <div className={styles.fieldGrid}>
            <label>
              Place name
              <input
                required
                value={form.name}
                onChange={(e) => identity("name", e.target.value)}
              />
            </label>
            <label>
              City
              <input
                required
                value={form.city}
                onChange={(e) => identity("city", e.target.value)}
              />
            </label>
            <label className={styles.wide}>
              Address
              <input
                required
                value={form.address}
                onChange={(e) => identity("address", e.target.value)}
              />
            </label>
            <label>
              Latitude
              <input
                required
                type="number"
                step="any"
                min="-90"
                max="90"
                value={form.latitude}
                onChange={(e) => identity("latitude", Number(e.target.value))}
              />
            </label>
            <label>
              Longitude
              <input
                required
                type="number"
                step="any"
                min="-180"
                max="180"
                value={form.longitude}
                onChange={(e) => identity("longitude", Number(e.target.value))}
              />
            </label>
          </div>
          <p>To use a different Google listing, choose another result below.</p>
        </details>
        <label className={styles.confirm}>
          <input
            type="checkbox"
            disabled={rejected}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I checked this is the correct place and map pin.</span>
        </label>
        <div className={styles.publishSummary}>
          {entry.live
            ? "Publishing replaces the live details with this draft."
            : "Publishing adds this place to the public map."}{" "}
          Your category, status, rating, and notes are included.
        </div>
        <div className={styles.actions}>
          <button
            className={styles.primary}
            type="submit"
            name="publish"
            disabled={busy || !confirmed || rejected}
          >
            {busy ? "Saving…" : "Publish to live map"}
          </button>
          <button type="submit" name="save" disabled={busy}>
            Save draft
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction("discard")}
          >
            Discard draft
          </button>
        </div>
      </fieldset>
    </form>
  );
}
export function CatalogueAdmin({ publicUrl = "/" }: { publicUrl?: string }) {
  const [entries, setEntries] = useState<CatalogueEntry[]>([]),
    [categories, setCategories] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false),
    [configured, setConfigured] = useState(false),
    [storage, setStorage] = useState("shared");
  const [password, setPassword] = useState(""),
    [tab, setTab] = useState<Tab>("inbox"),
    [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(""),
    [city, setCity] = useState(""),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [mapsUrl, setMapsUrl] = useState(""),
    [lookupCity, setLookupCity] = useState("");
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showRemoved, setShowRemoved] = useState(false),
    [limit, setLimit] = useState(30);
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({}),
    [removeOpen, setRemoveOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const leaveDraft = () =>
    !dirty ||
    window.confirm("Discard your unsaved edits? Use Save draft to keep them.");
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const submitting = useRef(false),
    intakeId = useRef(crypto.randomUUID());
  const fileRef = useRef<HTMLInputElement>(null);
  const [screenshots, setScreenshots] = useState<
    Array<{
      rawName: string;
      cityHint: string;
      rawText: string;
      fileName: string;
      requestId: string;
      added?: boolean;
    }>
  >([]);
  const replace = (entry: CatalogueEntry) =>
    setEntries((current) =>
      current.some((e) => e.id === entry.id)
        ? current.map((e) => (e.id === entry.id ? entry : e))
        : [entry, ...current],
    );
  const refresh = useCallback(async () => {
    const data = await call("/api/admin/catalogue");
    setEntries(data.entries);
    setCategories(data.categories);
    setConfigured(data.configured);
    setStorage(data.storage ?? "shared");
    setLoaded(true);
  }, []);
  useEffect(() => {
    void refresh().catch((failure) => setError(failure.message));
  }, [refresh]);
  useEffect(() => {
    setLimit(30);
    setRemoveOpen(false);
  }, [tab, search, selected]);
  const run = async (fn: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Request failed. Refresh before retrying.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const mutate = async (
    entry: CatalogueEntry,
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    const data = await call(
      `/api/admin/catalogue/${encodeURIComponent(entry.id)}`,
      {
        action,
        expectedVersion: entry.version,
        operationId: crypto.randomUUID(),
        ...extra,
      },
    );
    if (data.entry) replace(data.entry);
    return data.entry as CatalogueEntry;
  };
  const verify = async (entry: CatalogueEntry) => {
    try {
      const receipt = (await call(
        `/api/admin/catalogue/${encodeURIComponent(entry.id)}`,
        {
          action: "verify",
          expectedVersion: entry.version,
          operationId: crypto.randomUUID(),
        },
      )) as Receipt;
      setReceipts((current) => ({ ...current, [entry.id]: receipt }));
      setMessage(
        receipt.confirmed
          ? receipt.mode === "live"
            ? "Live confirmed. The public map serves this version."
            : "Local preview confirmed. This does not confirm the public website."
          : "Saved; live check pending. Retry the check shortly.",
      );
    } catch {
      setMessage(
        "Saved; live check pending. Your change is saved. Retry the check shortly.",
      );
    }
  };
  async function addPlace(
    rawName: string,
    cityHint: string,
    requestId: string,
    source?: string,
  ) {
    const result = await call("/api/admin/catalogue", {
      name: rawName,
      city: cityHint,
      requestId,
      source,
    });
    const entry = result.entry as CatalogueEntry;
    replace(entry);
    setSelected(entry.id);
    if (result.duplicate) {
      setTab(stage(entry));
      setMessage(
        "This place is already in your catalogue. Opened the existing entry.",
      );
      return;
    }
    setTab("inbox");
    const looked = await mutate(entry, "lookup");
    setTab(stage(looked));
    if (looked.lookupError)
      setMessage("Saved in Inbox. You can retry the lookup.");
    else setMessage("Match found. Check the venue and pin before publishing.");
  }
  const active = entries.find((e) => e.id === selected);
  useEffect(() => {
    setQuery(active?.input.name ?? "");
    setLookupCity(active?.input.city ?? "");
    setMapsUrl("");
  }, [selected]);
  const counts = {
    inbox: entries.filter((e) => !e.draft && !e.live && !e.archived).length,
    review: entries.filter((e) => e.draft).length,
    live: entries.filter((e) => e.live && !e.archived).length,
  };
  const filtered = entries
    .filter((e) =>
      tab === "inbox"
        ? !e.draft && !e.live && !e.archived
        : tab === "review"
          ? Boolean(e.draft)
          : Boolean(e.live) && (showRemoved || !e.archived),
    )
    .filter((e) =>
      `${label(e)} ${e.input.name} ${e.live?.city ?? e.input.city}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      tab === "live"
        ? label(a).localeCompare(label(b))
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!active) return;
    await run(async () => {
      const result = await mutate(active, action, extra);
      setRemoveOpen(false);
      if (action === "edit") setTab("review");
      if (["discard", "lookup", "select"].includes(action))
        setTab(stage(result));
      if (["publish", "remove", "undo"].includes(action)) {
        setTab("live");
        if (result.archived) setShowRemoved(true);
        await verify(result);
      }
    });
  };
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Your Field Guide</p>
          <h1>Places admin</h1>
          <p>Add a place. Check the match. Publish it to the map.</p>
        </div>
        <Link href={publicUrl}>Open public map ↗</Link>
      </header>
      {!loaded ? (
        <section className={styles.panel}>
          <h2>Sign in</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const response = await fetch("/api/admin/session", {
                  method: "POST",
                  headers: { "x-admin-password": password },
                });
                if (!response.ok)
                  throw new Error("Enter the correct admin password.");
                setPassword("");
                await refresh();
              });
            }}
          >
            <label>
              Admin password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className={styles.primary} disabled={busy}>
              Sign in
            </button>
          </form>
        </section>
      ) : (
        <>
          <div className={styles.connection}>
            <span className={configured ? styles.connected : styles.warning}>
              {configured
                ? storage === "shared"
                  ? "Shared catalogue connected"
                  : "Local development catalogue"
                : "Shared catalogue not connected"}
            </span>
            <a href="/api/admin/catalogue/export">Export catalogue</a>
            <button
              disabled={busy}
              onClick={() => {
                if (leaveDraft()) void run(refresh);
              }}
            >
              Refresh
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  await fetch("/api/admin/session", { method: "DELETE" });
                  setEntries([]);
                  setLoaded(false);
                })
              }
            >
              Sign out
            </button>
          </div>
          {!configured ? (
            <section className={styles.panel}>
              <h2>Setup is not finished</h2>
              <p>
                Connect and migrate the shared catalogue before adding or
                publishing places. The public map keeps its current places.
              </p>
            </section>
          ) : (
            <>
              <section className={styles.panel} aria-labelledby="add-place">
                <h2 id="add-place">Add a place</h2>
                <form
                  className={styles.intake}
                  aria-label="Add place"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await addPlace(name, city, intakeId.current);
                      intakeId.current = crypto.randomUUID();
                      setName("");
                    });
                  }}
                >
                  <label>
                    Place name
                    <input
                      required
                      maxLength={300}
                      value={name}
                      placeholder="For example, FUHI Coffee Roasters"
                      onChange={(e) => {
                        setName(e.target.value);
                        intakeId.current = crypto.randomUUID();
                      }}
                    />
                  </label>
                  <label>
                    City
                    <input
                      required
                      maxLength={150}
                      list="catalogue-cities"
                      value={city}
                      placeholder="Kaohsiung"
                      onChange={(e) => {
                        setCity(e.target.value);
                        intakeId.current = crypto.randomUUID();
                      }}
                    />
                    <datalist id="catalogue-cities">
                      {[...new Set(entries.map((e) => e.input.city))]
                        .sort()
                        .map((c) => (
                          <option key={c} value={c} />
                        ))}
                    </datalist>
                  </label>
                  <button className={styles.primary} disabled={busy}>
                    {busy ? "Working…" : "Add and find match"}
                  </button>
                </form>
                <p className={styles.help}>
                  Only name and city are needed. Nothing goes public until you
                  publish it.
                </p>
                <details className={styles.screenshots}>
                  <summary>Add from screenshots</summary>
                  <p>
                    Extract place names, check the text, then send them to
                    Inbox.
                  </p>
                  <input
                    ref={fileRef}
                    aria-label="Screenshots"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                    multiple
                    disabled={busy}
                  />
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const files = Array.from(fileRef.current?.files ?? []);
                        if (!files.length)
                          throw new Error("Choose screenshots first.");
                        if (files.length > 10)
                          throw new Error("Choose at most 10 screenshots.");
                        const body = new FormData();
                        files.forEach((f) => body.append("images", f));
                        const response = await fetch(
                          "/api/admin/screenshot-intake/extract",
                          {
                            method: "POST",
                            body,
                            signal: AbortSignal.timeout(60_000),
                          },
                        );
                        const payload = await response.json();
                        if (!response.ok) throw new Error(payload.error);
                        setScreenshots((current) => [
                          ...current,
                          ...(payload.rows ?? []).map(
                            (r: Record<string, string>) => ({
                              ...r,
                              requestId: crypto.randomUUID(),
                            }),
                          ),
                        ]);
                        const failed = (payload.results ?? []).filter(
                          (r: { status: string }) => r.status === "error",
                        );
                        if (failed.length)
                          setError(
                            `${failed.length} screenshot(s) failed. Successful text is kept below; retry failed images.`,
                          );
                      })
                    }
                  >
                    Extract names
                  </button>
                  {screenshots.map((row, i) => (
                    <div className={styles.screenshotRow} key={row.requestId}>
                      <label>
                        Place name
                        <input
                          value={row.rawName}
                          disabled={row.added}
                          onChange={(e) =>
                            setScreenshots((rows) =>
                              rows.map((r, j) =>
                                i === j ? { ...r, rawName: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        City
                        <input
                          value={row.cityHint}
                          disabled={row.added}
                          onChange={(e) =>
                            setScreenshots((rows) =>
                              rows.map((r, j) =>
                                i === j
                                  ? { ...r, cityHint: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        disabled={
                          busy || row.added || !row.cityHint || !row.rawName
                        }
                        onClick={() =>
                          void run(async () => {
                            await addPlace(
                              row.rawName,
                              row.cityHint,
                              row.requestId,
                              `${row.fileName}\n${row.rawText}`,
                            );
                            setScreenshots((rows) =>
                              rows.map((r, j) =>
                                i === j ? { ...r, added: true } : r,
                              ),
                            );
                          })
                        }
                      >
                        {row.added ? "Added" : "Add to Inbox"}
                      </button>
                    </div>
                  ))}
                </details>
              </section>
              <nav className={styles.tabs} aria-label="Catalogue stages">
                {(["inbox", "review", "live"] as const).map((value) => (
                  <button
                    key={value}
                    aria-current={tab === value ? "page" : undefined}
                    onClick={() => {
                      if (leaveDraft()) {
                        setTab(value);
                        setSelected(null);
                      }
                    }}
                  >
                    {value === "inbox"
                      ? "Inbox"
                      : value === "review"
                        ? "Review"
                        : "Live"}
                    <span>{counts[value]}</span>
                  </button>
                ))}
              </nav>
              <div className={styles.workspace}>
                <section className={styles.queue} aria-label={`${tab} places`}>
                  <label className={styles.search}>
                    Find a place
                    <input
                      type="search"
                      placeholder="Search names or cities"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  {tab === "live" ? (
                    <label className={styles.confirm}>
                      <input
                        type="checkbox"
                        checked={showRemoved}
                        onChange={(e) => setShowRemoved(e.target.checked)}
                      />
                      Show removed places
                    </label>
                  ) : null}
                  {!filtered.length ? (
                    <p className={styles.empty}>
                      {tab === "inbox"
                        ? "Your Inbox is clear. Add a name and city above."
                        : tab === "review"
                          ? "Nothing needs review. Find a match from Inbox to start."
                          : "No live places match this search."}
                    </p>
                  ) : (
                    filtered.slice(0, limit).map((entry) => (
                      <button
                        className={`${styles.queueItem} ${selected === entry.id ? styles.selected : ""}`}
                        key={entry.id}
                        aria-pressed={selected === entry.id}
                        onClick={() => {
                          if (leaveDraft()) {
                            setSelected(entry.id);
                            setQuery(entry.input.name);
                            setMapsUrl("");
                          }
                        }}
                      >
                        <strong>{label(entry)}</strong>
                        <span>
                          {entry.live?.city ?? entry.input.city}
                          {entry.archived
                            ? " · Removed"
                            : entry.draft && entry.live
                              ? " · Draft changes"
                              : entry.lookupError
                                ? " · Needs attention"
                                : ""}
                        </span>
                      </button>
                    ))
                  )}
                  {filtered.length > limit ? (
                    <button onClick={() => setLimit((n) => n + 30)}>
                      Show more places
                    </button>
                  ) : null}
                </section>
                <section className={styles.detail} aria-label="Selected place">
                  {!active ? (
                    <div className={styles.empty}>
                      <h2>
                        {tab === "review"
                          ? "Review before publishing"
                          : tab === "live"
                            ? "Your published places"
                            : "Your next place"}
                      </h2>
                      <p>Select a place to see its details.</p>
                    </div>
                  ) : (
                    <>
                      {active.lookupError ? (
                        <p className={styles.warning} role="status">
                          {active.lookupError}
                        </p>
                      ) : null}
                      {active.draft && tab !== "live" ? (
                        <ReviewEditor
                          key={`${active.id}:${active.version}`}
                          entry={active}
                          categories={categories}
                          busy={busy}
                          onDirty={setDirty}
                          onAction={(a, x) => void act(a, x)}
                          onSave={(patch, confirm, publish) =>
                            void run(async () => {
                              const saved = await mutate(active, "save", {
                                patch,
                                confirmMatch: confirm,
                              });
                              if (publish) {
                                const published = await mutate(
                                  saved,
                                  "publish",
                                );
                                setTab("live");
                                await verify(published);
                              } else
                                setMessage(
                                  "Draft saved. Your live listing is unchanged.",
                                );
                            })
                          }
                        />
                      ) : (
                        <div className={styles.editor}>
                          <p className={styles.eyebrow}>
                            {active.archived
                              ? "Removed"
                              : active.live
                                ? "Published place"
                                : "Waiting for a match"}
                          </p>
                          <h2>{label(active)}</h2>
                          <p>{active.live?.address ?? active.input.city}</p>
                          {active.live ? (
                            <>
                              <p>
                                {active.live.category} ·{" "}
                                {active.live.status === "been"
                                  ? "Been"
                                  : active.live.status === "want_to_go"
                                    ? "Want to go"
                                    : "Saved"}
                                {active.live.loved ? " · Loved it" : ""}
                              </p>
                              {active.live.notes ? (
                                <p className={styles.source}>
                                  {Array.isArray(active.live.notes)
                                    ? active.live.notes.join("\n")
                                    : active.live.notes}
                                </p>
                              ) : null}
                              <div className={styles.actions}>
                                <button
                                  className={styles.primary}
                                  disabled={busy}
                                  onClick={() => void act("edit")}
                                >
                                  {active.draft
                                    ? "Continue draft"
                                    : "Edit draft"}
                                </button>
                                {!active.archived ? (
                                  <button
                                    disabled={busy}
                                    onClick={() => setRemoveOpen(true)}
                                  >
                                    Remove from live map
                                  </button>
                                ) : null}
                              </div>
                              {removeOpen ? (
                                <div className={styles.publishSummary}>
                                  <p>
                                    Remove {active.live.name} from the public
                                    map? Its history is kept, and you can undo
                                    removal.
                                  </p>
                                  <button
                                    disabled={busy}
                                    onClick={() => void act("remove")}
                                  >
                                    Confirm removal
                                  </button>
                                  <button onClick={() => setRemoveOpen(false)}>
                                    Cancel
                                  </button>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <button
                              className={styles.primary}
                              disabled={busy}
                              onClick={() =>
                                void act("lookup", { query: active.input.name })
                              }
                            >
                              Find a match
                            </button>
                          )}
                        </div>
                      )}
                      {active.publicVersion ? (
                        <div className={styles.delivery}>
                          <strong>
                            {receipts[active.id]?.confirmed &&
                            receipts[active.id]?.version ===
                              active.publicVersion
                              ? receipts[active.id].mode === "live"
                                ? "Live confirmed"
                                : "Local preview confirmed"
                              : "Published version saved · live check available"}
                          </strong>
                          <p>
                            {active.publicChangedAt
                              ? `Published ${new Date(active.publicChangedAt).toLocaleString()}`
                              : ""}
                          </p>
                          <div className={styles.actions}>
                            <button
                              disabled={busy}
                              onClick={() => void run(() => verify(active))}
                            >
                              Check public map
                            </button>
                            {receipts[active.id]?.publicUrl ? (
                              <a
                                href={receipts[active.id].publicUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open public map ↗
                              </a>
                            ) : null}
                            {active.history.at(-1)?.action !== "undo" &&
                            active.history.length ? (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void act("undo", {
                                    publicationId: active.history.at(-1)!.id,
                                  })
                                }
                              >
                                Undo last publication
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {tab !== "live" ? (
                        <details
                          className={styles.otherMatches}
                          open={Boolean(active.lookupError)}
                        >
                          <summary>
                            Search again or choose another match
                          </summary>
                          <form
                            className={styles.lookup}
                            aria-label="Find Maps match"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void act("lookup", {
                                query,
                                mapsUrl,
                                city: lookupCity,
                              });
                            }}
                          >
                            <label>
                              Search name
                              <input
                                value={query || active.input.name}
                                onChange={(e) => setQuery(e.target.value)}
                              />
                            </label>
                            <label>
                              City
                              <input
                                required
                                value={lookupCity || active.input.city}
                                onChange={(e) => setLookupCity(e.target.value)}
                              />
                            </label>
                            <label>
                              Google Maps link (optional)
                              <input
                                type="url"
                                value={mapsUrl}
                                onChange={(e) => setMapsUrl(e.target.value)}
                                placeholder="https://maps.google.com/…"
                              />
                            </label>
                            <button disabled={busy}>Search again</button>
                          </form>
                          {active.candidates.map((c) => (
                            <div
                              className={styles.candidate}
                              key={c.googlePlaceId}
                            >
                              <strong>{c.name}</strong>
                              <p>{c.address}</p>
                              <div className={styles.actions}>
                                <a
                                  href={c.googleMapsUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Check in Google Maps ↗
                                </a>
                                <button
                                  disabled={
                                    busy ||
                                    c.businessStatus === "CLOSED_PERMANENTLY"
                                  }
                                  onClick={() =>
                                    void act("select", {
                                      candidateId: c.googlePlaceId,
                                    })
                                  }
                                >
                                  {c.businessStatus === "CLOSED_PERMANENTLY"
                                    ? "Permanently closed"
                                    : "Use this result"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </details>
                      ) : null}
                    </>
                  )}
                </section>
              </div>
            </>
          )}
        </>
      )}
      <div className={styles.feedback} aria-live="polite">
        {message ? <p role="status">{message}</p> : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}{" "}
            <button disabled={busy} onClick={() => void run(refresh)}>
              Refresh saved state
            </button>
          </p>
        ) : null}
      </div>
    </main>
  );
}
