/** Shared client/server shape. Image IDs distinguish files with the same name. */
export type ExtractedScreenshotRow = {
  cityHint: string;
  countryHint: string;
  fileName: string;
  rawName: string;
  rawText: string;
};

export type ScreenshotImageOutcome = {
  imageId: string;
  fileName: string;
} & ({ status: "success"; rows: ExtractedScreenshotRow[] } | {
  status: "error"; error: string; code?: string; stage?: string;
});

export type ScreenshotDraft = ExtractedScreenshotRow & {
  id: string;
  imageId: string;
  ignored: boolean;
};

/** A successful image is immutable during retry; manual corrections win. */
export function retainScreenshotDrafts(
  drafts: ScreenshotDraft[],
  outcomes: ScreenshotImageOutcome[],
  createId: () => string,
) {
  const existingImages = new Set(drafts.map((draft) => draft.imageId));
  return [...drafts, ...outcomes.flatMap((outcome) =>
    outcome.status === "success" && !existingImages.has(outcome.imageId)
      ? outcome.rows.map((row) => ({ ...row, imageId: outcome.imageId, id: createId(), ignored: false }))
      : [],
  )];
}
