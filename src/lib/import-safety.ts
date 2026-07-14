export type ImportSafetyInput = {
  allowAmbiguousIds: boolean;
  allowLargeDrop: boolean;
  allowSkippedRows: boolean;
  ambiguousIdMatches: number;
  currentCount: number;
  nextCount: number;
  skippedRows: number;
};

export type ImportSafetyAssessment = {
  dropRatio: number;
  issues: string[];
};

export function assessImportSafety(
  input: ImportSafetyInput,
): ImportSafetyAssessment {
  const dropRatio =
    input.currentCount > 0
      ? Math.max(0, (input.currentCount - input.nextCount) / input.currentCount)
      : 0;
  const issues: string[] = [];

  if (input.nextCount === 0) {
    issues.push("Import produced zero places.");
  }

  if (input.skippedRows > 0 && !input.allowSkippedRows) {
    issues.push(
      `Import skipped ${input.skippedRows} row(s); pass --allow-skipped-rows only after reviewing them.`,
    );
  }

  if (input.ambiguousIdMatches > 0 && !input.allowAmbiguousIds) {
    issues.push(
      `Import has ${input.ambiguousIdMatches} ambiguous ID match(es); pass --allow-ambiguous-ids only after reviewing them.`,
    );
  }

  if (dropRatio > 0.2 && !input.allowLargeDrop) {
    issues.push(
      `Import would reduce the dataset by ${Math.round(
        dropRatio * 100,
      )}%; pass --allow-large-drop only if that replacement is intentional.`,
    );
  }

  return { dropRatio, issues };
}
