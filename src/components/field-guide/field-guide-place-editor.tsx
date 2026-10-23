"use client";

import { useMemo, useState } from "react";
import { findCanonicalCategory } from "@/lib/place-category";
import type { Place } from "@/lib/place";
import { getEditorialState, getStoredEditorialStatus, type EditorialState } from "@/lib/field-guide-editor-state";
import styles from "./field-guide.module.css";

const statusOptions: Array<{ label: string; value: EditorialState }> = [
  { label: "Saved", value: "saved" },
  { label: "Want to go", value: "want_to_go" },
  { label: "Been", value: "been" },
  { label: "Loved", value: "loved" },
];

export function FieldGuidePlaceEditor({
  adminPassword,
  categories,
  onAdminPasswordChange,
  onCancel,
  onSaved,
  place,
}: {
  adminPassword: string;
  categories: string[];
  onAdminPasswordChange: (password: string) => void;
  onCancel: () => void;
  onSaved: (place: Place) => void;
  place: Place;
}) {
  const [originalPlace, setOriginalPlace] = useState(place);
  const [category, setCategory] = useState(place.category);
  const [editorialState, setEditorialState] = useState(() =>
    getEditorialState(place),
  );
  const [statusChanged, setStatusChanged] = useState(false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
      const storedStatus = getStoredEditorialStatus(editorialState, originalPlace, statusChanged);
      const response = await fetch(
        `/api/admin/places/${encodeURIComponent(place.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(adminPassword ? { "x-admin-password": adminPassword } : {}),
          },
          body: JSON.stringify({
            editMode: "field-guide-inline",
            expectedRecordVersion: originalPlace.recordVersion,
            category: canonicalCategory,
            ...storedStatus,
          }),
        },
      );
      const payload = (await response.json()) as { error?: string; place?: Place };

      if (response.status === 401) {
        setShowPassword(true);
        throw new Error("Enter the admin password and try again. Your edits are still here.");
      }

      if (!response.ok || !payload.place) {
        throw new Error(payload.error ?? "Could not save this place.");
      }

      setOriginalPlace(payload.place);
      setStatusChanged(false);
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
                onChange={() => { setEditorialState(option.value); setStatusChanged(true); }}
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

      {showPassword ? (
        <label className={styles.editorCategory}>
          <span>Admin password</span>
          <input
            autoComplete="current-password"
            autoFocus
            onChange={(event) => {
              onAdminPasswordChange(event.target.value);
              setError("");
            }}
            type="password"
            value={adminPassword}
          />
        </label>
      ) : null}

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
