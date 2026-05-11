type ProviderAttempt = {
  detail: string;
  provider: string;
  status: string;
};

export function formatProviderAttemptSummary(attempts: ProviderAttempt[]) {
  if (attempts.length === 0) {
    return "No provider attempts yet.";
  }

  return attempts
    .map((attempt) => `${attempt.provider}: ${attempt.status}`)
    .join(". ");
}
