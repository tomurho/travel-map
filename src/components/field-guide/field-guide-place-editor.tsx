"use client";

import { useMemo, useState } from "react";
import { findCanonicalCategory } from "@/lib/place-category";
import type { Place, PlaceStatus } from "@/lib/place";
import styles from "./field-guide.module.css";

type EditorialState = "saved" | "want_to_go" | "been" | "loved";

const statusOptions: Array<{ label: string; value: EditorialState }> = [
  { label: "Saved", value: "saved" },
  { label: "Want to go", value: "want_to_go" },
  { label: "Been", value: "been" },
  { label: "Loved", value: "loved" },
];

function getEditorialState(place: Place): EditorialState {
  if (place.loved) return "loved";
  if (place.status === "want_to_go") return "want_to_go";
  if (place.status === "been") return "been";
  return "saved";
}

function getStoredStatus(state: EditorialState): {
  loved: boolean | null;
  status: PlaceStatus;
} {
  if (state === "loved") return { loved: true, status: "been" };
  if (state === "been") return { loved: false, status: "been" };
  if (state === "want_to_go") return { loved: null, status: "want_to_go" };
  return { loved: null, status: "location" };
}

export function FieldGuidePlaceEditor({
  categories,
  onCancel,
  onSaved,
  place,
}: {
  categories: string[];
  onCancel: () => void;
  onSaved: (place: Place) => void;
  place: Place;
}) {
  const [category, setCategory] = useState(place.category);
  const [editorialState, setEditorialState] = useState(() =>
    getEditorialState(place),
  );
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const categoryListId = `field-guide-categories-${place.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const canonicalCategory = useMemo(
    () => findCanonicalCategory(category, categories),
    [categories, category],
  );

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canonicalCategory) {
      setError("Choose an existing category from the suggestions.");
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      const storedStatus = getStoredStatus(editorialState);
      const response = await fetch(
        `/api/admin/places/${encodeURIComponent(place.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            editMode: "field-guide-inline",
            name: place.name,
            category: canonicalCategory,
            district: place.district,
            ...storedStatus,
          }),
        },
      );
      const payload = (await response.json()) as { error?: string; place?: Place };

      if (!response.ok || !payload.place) {
        throw new Error(payload.error ?? "Could not save this place.");
      }

      onSaved(payload.place);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save this place.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className={styles.inlineEditor} onSubmit={save}>
      <fieldset className={styles.editorStatus}>
        <legend>Status</legend>
        <div>
          {statusOptions.map((option) => (
            <label key={option.value}>
              <input
                checked={editorialState === option.value}
                name={`status-${place.id}`}
                onChange={() => setEditorialState(option.value)}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className={styles.editorCategory}>
        <span>Category</span>
        <input
          aria-describedby={error ? `edit-error-${place.id}` : undefined}
          autoComplete="off"
          list={categoryListId}
          onChange={(event) => {
            setCategory(event.target.value);
            setError("");
          }}
          value={category}
        />
        <datalist id={categoryListId}>
          {categories.map((option) => <option key={option} value={option} />)}
        </datalist>
      </label>

      {error ? (
        <p className={styles.editorError} id={`edit-error-${place.id}`} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.editorActions}>
        <button disabled={isSaving} onClick={onCancel} type="button">Cancel</button>
        <button disabled={isSaving || !canonicalCategory} type="submit">
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
