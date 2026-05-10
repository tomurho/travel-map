import type {
  Place,
  VerificationDecisionKind,
  VerificationSource,
} from "@/lib/place";
import { formatDateForInput } from "@/lib/place-verification";

export type GoogleCandidate = {
  businessStatus?: string;
  formattedAddress?: string;
  googleMapsUri?: string;
  id: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  displayName?: {
    text?: string;
  };
};

export type ScoredGoogleCandidate = GoogleCandidate & {
  addressSimilarity: number;
  addressScore: number;
  ambiguityScore: number;
  cityDistrictScore: number;
  cityScore: number;
  countryScore: number;
  districtScore: number;
  distanceMeters: number | null;
  matchConfidence: number;
  nameSimilarity: number;
  nameScore: number;
};

export type CandidateDiagnostics = {
  candidate: ScoredGoogleCandidate;
  rejectionReasons: string[];
};

export type VerificationDecision =
  | {
      candidate: ScoredGoogleCandidate;
      kind: "high_confidence";
      place: Place;
      safeCoordinateUpdateApplied: boolean;
    }
  | {
      candidates: ScoredGoogleCandidate[];
      kind: "ambiguous";
      place: Place;
    }
  | {
      candidate: ScoredGoogleCandidate;
      kind: "closed_moved";
      place: Place;
    }
  | {
      kind: "no_match";
      place: Place;
    };

export type VerificationOptions = {
  applyAutoDecisions?: boolean;
  applySafeCoordinateUpdates?: boolean;
  candidateSource?: VerificationSource;
  today?: Date;
};

export type AutoDecisionSummary = {
  autoCorrectedLargeDelta: Array<{
    addressScore: number;
    candidateAddress: string;
    candidateName: string;
    cityScore: number;
    countryScore: number;
    distanceDeltaMeters: number;
    name: string;
    nameScore: number;
    newLatitude: number;
    newLongitude: number;
    oldLatitude: number;
    oldLongitude: number;
    samePlaceReason: string;
    source: VerificationSource | "";
    verificationDecision: VerificationDecisionKind;
  }>;
  correctedFromGoogleMapsUrlCount: number;
  correctedFromPlaceIdCount: number;
  correctedFromTextSearchCount: number;
  autoCorrectedLargeDeltaCount: number;
  autoVerifiedSmallDeltaCount: number;
  candidateOnlyReviewCount: number;
  closedMovedCount: number;
  noCandidateCount: number;
  rowsProcessed: number;
};

export class AutoDecisionSafetyGateError extends Error {
  constructor(
    message: string,
    public city: string,
    public largeDeltaCount: number,
    public cityRowCount: number,
  ) {
    super(message);
  }
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])(?=[\p{Script=Latin}\p{Number}])/gu,
      "$1 ",
    )
    .replace(
      /([\p{Script=Latin}\p{Number}])(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/gu,
      "$1 ",
    )
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTokens(value: string) {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 0),
  );
}

export function getTextSimilarity(firstValue: string, secondValue: string) {
  const firstNormalized = normalizeText(firstValue);
  const secondNormalized = normalizeText(secondValue);
  const firstTokens = getTokens(firstValue);
  const secondTokens = getTokens(secondValue);

  if (firstTokens.size === 0 || secondTokens.size === 0) {
    return 0;
  }

  if (firstNormalized === secondNormalized) {
    return 1;
  }

  const intersectionCount = Array.from(firstTokens).filter((token) =>
    secondTokens.has(token),
  ).length;
  const unionCount = new Set([...firstTokens, ...secondTokens]).size;
  const tokenSimilarity = intersectionCount / unionCount;
  const shorterTokenCount = Math.min(firstTokens.size, secondTokens.size);
  const longerTokenCount = Math.max(firstTokens.size, secondTokens.size);
  const shorterNormalized =
    firstNormalized.length <= secondNormalized.length
      ? firstNormalized
      : secondNormalized;
  const longerNormalized =
    firstNormalized.length > secondNormalized.length
      ? firstNormalized
      : secondNormalized;
  const containmentSimilarity =
    shorterNormalized.length >= 4 && longerNormalized.includes(shorterNormalized)
      ? Math.max(0.6, shorterTokenCount / longerTokenCount)
      : 0;
  const hasCompactCjkOrNumericContainment =
    shorterNormalized.length >= 2 &&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Number}]/u.test(
      shorterNormalized,
    ) &&
    longerNormalized.includes(shorterNormalized);
  const compactContainmentSimilarity = hasCompactCjkOrNumericContainment
    ? Math.max(0.75, shorterTokenCount / longerTokenCount)
    : 0;

  return Math.max(
    tokenSimilarity,
    containmentSimilarity,
    compactContainmentSimilarity,
  );
}

export function getDistanceMeters(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
) {
  const earthRadiusMeters = 6371000;
  const firstLatitude = (first.latitude * Math.PI) / 180;
  const secondLatitude = (second.latitude * Math.PI) / 180;
  const latitudeDelta = ((second.latitude - first.latitude) * Math.PI) / 180;
  const longitudeDelta = ((second.longitude - first.longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function getDistanceScore(distanceMeters: number | null) {
  if (distanceMeters === null) {
    return 0.45;
  }

  if (distanceMeters <= 30) {
    return 1;
  }

  if (distanceMeters <= 50) {
    return 0.84;
  }

  if (distanceMeters <= 150) {
    return 0.62;
  }

  if (distanceMeters <= 500) {
    return 0.32;
  }

  return 0.08;
}

function getCityAliases(city: string) {
  const normalizedCity = normalizeText(city);
  const aliases = new Set([normalizedCity]);

  if (normalizedCity.includes("ho chi minh")) {
    aliases.add("ho chi minh");
    aliases.add("ho chi minh city");
  }

  if (normalizedCity.includes("taipei")) {
    aliases.add("taipei");
    aliases.add("taipei city");
  }

  if (
    ["tokyo", "kyoto", "osaka", "fukuoka", "sapporo", "kanazawa"].some(
      (cityName) => normalizedCity.includes(cityName),
    )
  ) {
    aliases.add("tokyo");
    aliases.add("kyoto");
    aliases.add("osaka");
  }

  if (normalizedCity.includes("seoul")) {
    aliases.add("seoul");
  }

  return Array.from(aliases);
}

function getCountryAliases(city: string) {
  const normalizedCity = normalizeText(city);

  if (normalizedCity.includes("ho chi minh")) {
    return ["vietnam", "viet nam"];
  }

  if (normalizedCity.includes("taipei")) {
    return ["taiwan"];
  }

  if (
    ["tokyo", "kyoto", "osaka", "fukuoka", "sapporo", "kanazawa"].some(
      (cityName) => normalizedCity.includes(cityName),
    )
  ) {
    return ["japan"];
  }

  if (normalizedCity.includes("seoul")) {
    return ["korea", "south korea"];
  }

  return [];
}

function getCityScore(place: Place, candidate: GoogleCandidate) {
  const candidateAddress = normalizeText(candidate.formattedAddress ?? "");

  return getCityAliases(place.city).some(
    (city) => city && candidateAddress.includes(city),
  )
    ? 1
    : 0;
}

function getDistrictScore(place: Place, candidate: GoogleCandidate) {
  const candidateAddress = normalizeText(candidate.formattedAddress ?? "");
  const district = normalizeText(place.district);

  return district && candidateAddress.includes(district) ? 1 : 0;
}

function getCountryScore(place: Place, candidate: GoogleCandidate, cityScore: number) {
  const candidateAddress = normalizeText(candidate.formattedAddress ?? "");
  const aliases = getCountryAliases(place.city);

  if (aliases.length === 0) {
    return 1;
  }

  if (aliases.some((country) => candidateAddress.includes(country))) {
    return 1;
  }

  // Region-biased Google results commonly omit country from formattedAddress.
  return cityScore === 1 ? 1 : 0;
}

export function scoreGoogleCandidate(
  place: Place,
  candidate: GoogleCandidate,
): ScoredGoogleCandidate {
  const candidateName = candidate.displayName?.text ?? "";
  const candidateAddress = candidate.formattedAddress ?? "";
  const nameSimilarity = getTextSimilarity(place.name, candidateName);
  const addressSimilarity = getTextSimilarity(place.address, candidateAddress);
  const distanceMeters = candidate.location
    ? getDistanceMeters(
        { latitude: place.latitude, longitude: place.longitude },
        {
          latitude: candidate.location.latitude,
          longitude: candidate.location.longitude,
        },
      )
    : null;
  const cityScore = getCityScore(place, candidate);
  const districtScore = getDistrictScore(place, candidate);
  const countryScore = getCountryScore(place, candidate, cityScore);
  const cityDistrictScore = Number(
    (cityScore * 0.5 + districtScore * 0.5).toFixed(3),
  );
  const matchConfidence = Number(
    (
      nameSimilarity * 0.38 +
      addressSimilarity * 0.34 +
      cityDistrictScore * 0.05 +
      countryScore * 0.05 +
      getDistanceScore(distanceMeters) * 0.18
    ).toFixed(3),
  );

  return {
    ...candidate,
    addressSimilarity,
    addressScore: Number(addressSimilarity.toFixed(3)),
    ambiguityScore: 1,
    cityDistrictScore,
    cityScore,
    countryScore,
    distanceMeters:
      distanceMeters === null ? null : Number(distanceMeters.toFixed(1)),
    districtScore,
    matchConfidence,
    nameSimilarity,
    nameScore: Number(nameSimilarity.toFixed(3)),
  };
}

export function isActiveBusiness(candidate: ScoredGoogleCandidate) {
  return !candidate.businessStatus || candidate.businessStatus === "OPERATIONAL";
}

export function isClosedOrMoved(candidate: ScoredGoogleCandidate) {
  return candidate.businessStatus === "CLOSED_PERMANENTLY";
}

function isCityCountryMatch(candidate: ScoredGoogleCandidate) {
  return candidate.cityScore === 1 && candidate.countryScore === 1;
}

function isRuleASmallDelta(candidate: ScoredGoogleCandidate) {
  return (
    isActiveBusiness(candidate) &&
    candidate.nameScore >= 0.75 &&
    candidate.addressScore >= 0.6 &&
    isCityCountryMatch(candidate) &&
    candidate.distanceMeters !== null &&
    candidate.distanceMeters <= 30
  );
}

function isReasonableSmallDeltaCandidate(candidate: ScoredGoogleCandidate) {
  const hasPlausibleEvidence =
    candidate.nameScore >= 0.25 ||
    candidate.addressScore >= 0.35 ||
    candidate.matchConfidence >= 0.45;

  return (
    isActiveBusiness(candidate) &&
    hasPlausibleEvidence &&
    isCityCountryMatch(candidate) &&
    candidate.distanceMeters !== null &&
    candidate.distanceMeters <= 30
  );
}

function isReasonableNearDeltaCandidate(candidate: ScoredGoogleCandidate) {
  const hasNearDeltaEvidence =
    candidate.nameScore >= 0.6 || candidate.addressScore >= 0.8;

  return (
    isActiveBusiness(candidate) &&
    hasNearDeltaEvidence &&
    isCityCountryMatch(candidate) &&
    candidate.distanceMeters !== null &&
    candidate.distanceMeters <= 100
  );
}

function isRuleBLargeDelta(candidate: ScoredGoogleCandidate) {
  return (
    isActiveBusiness(candidate) &&
    candidate.nameScore >= 0.85 &&
    candidate.addressScore >= 0.75 &&
    isCityCountryMatch(candidate)
  );
}

function isReviewCandidateWorthSaving(candidate: ScoredGoogleCandidate) {
  const hasUsableNameAndAddress =
    candidate.nameScore >= 0.5 && candidate.addressScore >= 0.35;
  const hasUsableNameAndNearbyDistance =
    candidate.nameScore >= 0.5 &&
    candidate.addressScore >= 0.25 &&
    candidate.distanceMeters !== null &&
    candidate.distanceMeters <= 500;
  const hasVeryNearbyAddressMatch =
    candidate.distanceMeters !== null &&
    candidate.distanceMeters <= 75 &&
    candidate.addressScore >= 0.35;

  return (
    isActiveBusiness(candidate) &&
    isCityCountryMatch(candidate) &&
    (isReasonableSmallDeltaCandidate(candidate) ||
      isReasonableNearDeltaCandidate(candidate) ||
      (candidate.matchConfidence >= 0.58 && hasUsableNameAndAddress) ||
      hasUsableNameAndAddress ||
      hasUsableNameAndNearbyDistance ||
      hasVeryNearbyAddressMatch)
  );
}

function isGenericPlaceName(name: string) {
  const normalizedName = normalizeText(name);
  const tokens = normalizedName.split(" ").filter(Boolean);
  const genericSingleTokenNames = new Set([
    "branch",
    "maru",
    "melt",
    "plants",
    "plant",
  ]);

  if (genericSingleTokenNames.has(normalizedName)) {
    return true;
  }

  if (tokens.length !== 1) {
    return false;
  }

  const [token] = tokens;

  return /^[a-z]+$/u.test(token) && token.length <= 5;
}

function isTrustedExistingGoogleIdentity(
  place: Place,
  candidateSource: VerificationSource,
) {
  if (candidateSource !== "place_id" && candidateSource !== "google_maps_url") {
    return false;
  }

  return (
    place.verifiedStatus === "Yes" &&
    place.samePlaceDecision === "Yes" &&
    Boolean(place.samePlaceReason?.trim()) &&
    (place.verificationSource === "place_id" ||
      place.verificationSource === "google_maps_url")
  );
}

function isStrongIdentityCandidate(
  place: Place,
  candidate: ScoredGoogleCandidate,
) {
  if (!isActiveBusiness(candidate) || !isCityCountryMatch(candidate)) {
    return false;
  }

  if (
    candidate.distanceMeters !== null &&
    candidate.distanceMeters > 1000 &&
    candidate.addressScore < 0.5
  ) {
    return false;
  }

  if (isGenericPlaceName(place.name)) {
    return (
      candidate.nameScore >= 0.85 &&
      (candidate.addressScore >= 0.75 || candidate.districtScore === 1)
    );
  }

  return (
    (candidate.nameScore >= 0.85 && candidate.addressScore >= 0.5) ||
    (candidate.nameScore >= 0.75 && candidate.addressScore >= 0.35) ||
    (candidate.nameScore >= 0.6 && candidate.addressScore >= 0.8) ||
    (candidate.nameScore >= 0.5 && candidate.addressScore >= 0.75) ||
    (candidate.nameScore >= 0.5 &&
      candidate.addressScore >= 0.7 &&
      candidate.distanceMeters !== null &&
      candidate.distanceMeters <= 500) ||
    (candidate.distanceMeters !== null &&
      candidate.distanceMeters <= 100 &&
      candidate.nameScore >= 0.75)
  );
}

function isIdentityResolvedSamePlace(
  place: Place,
  candidate: ScoredGoogleCandidate,
  candidateSource: VerificationSource,
) {
  if (isTrustedExistingGoogleIdentity(place, candidateSource)) {
    return isActiveBusiness(candidate) && isCityCountryMatch(candidate);
  }

  return (
    candidateSource !== "text_search" &&
    isStrongIdentityCandidate(place, candidate)
  );
}

function isIdentityResolvedSameClosedPlace(candidate: ScoredGoogleCandidate) {
  const hasUsableName = candidate.nameScore >= 0.55;
  const hasUsableAddressOrNearby =
    candidate.addressScore >= 0.25 ||
    candidate.districtScore === 1 ||
    (candidate.distanceMeters !== null && candidate.distanceMeters <= 150);

  return isCityCountryMatch(candidate) && hasUsableName && hasUsableAddressOrNearby;
}

export function isStrongCandidate(candidate: ScoredGoogleCandidate) {
  const hasStrongNameAndUsableAddress =
    candidate.nameScore >= 0.82 && candidate.addressScore >= 0.35;
  const hasGoodNameAndStrongAddress =
    candidate.nameScore >= 0.72 && candidate.addressScore >= 0.58;

  return (
    candidate.nameScore >= 0.42 &&
    isCityCountryMatch(candidate) &&
    (candidate.matchConfidence >= 0.72 ||
      hasStrongNameAndUsableAddress ||
      hasGoodNameAndStrongAddress) &&
    (candidate.addressScore >= 0.35 ||
      (candidate.distanceMeters !== null && candidate.distanceMeters <= 75))
  );
}

export function getCandidateRejectionReasons(candidate: ScoredGoogleCandidate) {
  const reasons: string[] = [];

  if (!isActiveBusiness(candidate)) {
    reasons.push(`businessStatus is ${candidate.businessStatus}`);
  }

  if (!isCityCountryMatch(candidate)) {
    reasons.push(
      `city/country mismatch: cityScore ${candidate.cityScore}, countryScore ${candidate.countryScore}`,
    );
  }

  if (
    candidate.matchConfidence < 0.72 &&
    !isStrongCandidate(candidate) &&
    !isReasonableSmallDeltaCandidate(candidate) &&
    !isReasonableNearDeltaCandidate(candidate)
  ) {
    reasons.push(`matchConfidence ${candidate.matchConfidence} is below 0.72`);
  }

  if (candidate.nameScore < 0.42) {
    reasons.push(`nameScore ${candidate.nameScore} is below 0.42`);
  }

  if (
    candidate.addressScore < 0.35 &&
    (candidate.distanceMeters === null || candidate.distanceMeters > 75)
  ) {
    const distanceText =
      candidate.distanceMeters === null
        ? "unknown distance"
        : `${Math.round(candidate.distanceMeters)}m`;

    reasons.push(
      `addressScore ${candidate.addressScore} is below 0.35 and distance is ${distanceText}`,
    );
  }

  return reasons;
}

export function getCandidateDiagnostics(
  place: Place,
  candidates: GoogleCandidate[],
): CandidateDiagnostics[] {
  return candidates
    .filter((candidate) => candidate.id)
    .map((candidate) => scoreGoogleCandidate(place, candidate))
    .sort(
      (firstCandidate, secondCandidate) =>
        secondCandidate.matchConfidence - firstCandidate.matchConfidence,
    )
    .map((candidate) => ({
      candidate,
      rejectionReasons: getCandidateRejectionReasons(candidate),
    }));
}

function appendNote(place: Place, note: string) {
  const currentNotes = place.verificationNotes?.trim();
  return currentNotes ? `${currentNotes}\n${note}` : note;
}

function getCandidateSummary(candidate: ScoredGoogleCandidate) {
  const distanceText =
    candidate.distanceMeters === null
      ? "unknown distance"
      : `${Math.round(candidate.distanceMeters)}m`;

  return `${candidate.displayName?.text ?? "Unnamed"} | ${
    candidate.formattedAddress ?? "No address"
  } | ${distanceText} | confidence ${candidate.matchConfidence}`;
}

function getSamePlaceReason(candidate: ScoredGoogleCandidate) {
  const distanceText =
    candidate.distanceMeters === null
      ? "unknown distance"
      : `${Math.round(candidate.distanceMeters)}m`;

  return `Google candidate matched with nameScore ${candidate.nameScore}, addressScore ${candidate.addressScore}, cityScore ${candidate.cityScore}, countryScore ${candidate.countryScore}, and distance ${distanceText}.`;
}

function applyCandidateFields(
  place: Place,
  candidate: ScoredGoogleCandidate,
  today: Date,
) {
  return {
    ...place,
    addressScore: candidate.addressScore,
    ambiguityScore: candidate.ambiguityScore,
    businessStatus: candidate.businessStatus ?? "",
    canonicalAddress: candidate.formattedAddress ?? "",
    canonicalName: candidate.displayName?.text ?? "",
    cityScore: candidate.cityScore,
    countryScore: candidate.countryScore,
    distanceDeltaMeters: candidate.distanceMeters ?? undefined,
    districtScore: candidate.districtScore,
    googleMapsUrl: place.googleMapsUrl || candidate.googleMapsUri || "",
    googlePlaceId: candidate.id,
    lastChecked: formatDateForInput(today),
    matchConfidence: candidate.matchConfidence,
    nameScore: candidate.nameScore,
    verifiedLatitude: candidate.location?.latitude,
    verifiedLongitude: candidate.location?.longitude,
  };
}

function applyDecisionFields(
  place: Place,
  fields: {
    samePlaceDecision: Place["samePlaceDecision"];
    samePlaceReason: string;
    verificationDecision: VerificationDecisionKind;
    verificationSource?: VerificationSource;
  },
) {
  return {
    ...place,
    samePlaceDecision: fields.samePlaceDecision,
    samePlaceReason: fields.samePlaceReason,
    verificationDecision: fields.verificationDecision,
    verificationSource: fields.verificationSource,
  };
}

function isReviewVerificationDecision(
  verificationDecision: Place["verificationDecision"],
) {
  return (
    verificationDecision === "candidate_only_review" ||
    verificationDecision === "ambiguous_multiple_candidates" ||
    verificationDecision === "no_candidate_found"
  );
}

function isClosedVerificationDecision(
  verificationDecision: Place["verificationDecision"],
) {
  return verificationDecision === "closed_or_moved";
}

function isVerifiedVerificationDecision(
  verificationDecision: Place["verificationDecision"],
) {
  return (
    verificationDecision === "auto_verified_small_delta" ||
    verificationDecision === "auto_corrected_large_delta" ||
    verificationDecision === "auto_corrected_from_google_url" ||
    verificationDecision === "auto_corrected_from_place_id" ||
    verificationDecision === "auto_corrected_from_text_search" ||
    verificationDecision === "manually_verified"
  );
}

function copyCandidateCoordinates(place: Place, candidate: ScoredGoogleCandidate) {
  if (!candidate.location) {
    return place;
  }

  return {
    ...place,
    latitude: candidate.location.latitude,
    longitude: candidate.location.longitude,
  };
}

function applyAutoDecisionIfRequested(
  place: Place,
  candidate: ScoredGoogleCandidate,
  verificationDecision: VerificationDecisionKind,
  options: VerificationOptions,
  today: Date,
): Place {
  if (
    options.applyAutoDecisions !== true ||
    !candidate.location ||
    ![
      "auto_verified_small_delta",
      "auto_corrected_large_delta",
      "auto_corrected_from_google_url",
      "auto_corrected_from_place_id",
      "auto_corrected_from_text_search",
    ].includes(verificationDecision)
  ) {
    return place;
  }

  const note =
    verificationDecision === "auto_corrected_from_google_url" ||
    verificationDecision === "auto_corrected_from_place_id"
      ? "Auto-corrected coordinates from resolved Google Maps listing."
      : verificationDecision === "auto_corrected_large_delta" ||
          verificationDecision === "auto_corrected_from_text_search"
        ? "Auto-corrected stored coordinates based on strong Google Places name/address match."
        : "Auto-verified stored coordinates based on strong Google Places name/address match.";

  return {
    ...copyCandidateCoordinates(place, candidate),
    lastChecked: formatDateForInput(today),
    verifiedStatus: "Yes" as const,
    verificationNotes: appendNote(place, note),
  };
}

export function verifyPlaceFromCandidates(
  place: Place,
  candidates: GoogleCandidate[],
  options: VerificationOptions = {},
): VerificationDecision {
  const today = options.today ?? new Date();
  const candidateSource = options.candidateSource ?? "text_search";
  const isIdentityResolvedSource =
    candidateSource === "place_id" || candidateSource === "google_maps_url";
  const scoredCandidates = candidates
    .filter((candidate) => candidate.id)
    .map((candidate) => scoreGoogleCandidate(place, candidate))
    .sort(
      (firstCandidate, secondCandidate) =>
        secondCandidate.matchConfidence - firstCandidate.matchConfidence,
    );

  if (scoredCandidates.length === 0) {
    return {
      kind: "no_match",
      place: {
        ...applyDecisionFields(place, {
          samePlaceDecision: "Unsure",
          samePlaceReason: "Google Places returned no candidate.",
          verificationDecision: "no_candidate_found",
          verificationSource: candidateSource,
        }),
        lastChecked: formatDateForInput(today),
        verifiedStatus: "Review",
        verificationNotes: appendNote(
          place,
          "Google Places verification found no candidate match.",
        ),
      },
    };
  }

  const closedCandidate = scoredCandidates.find(isClosedOrMoved);

  if (
    closedCandidate &&
    (isStrongCandidate(closedCandidate) ||
      (isIdentityResolvedSource &&
        isIdentityResolvedSameClosedPlace(closedCandidate)))
  ) {
    return {
      candidate: closedCandidate,
      kind: "closed_moved",
      place: {
        ...applyDecisionFields(applyCandidateFields(place, closedCandidate, today), {
          samePlaceDecision: "Yes",
          samePlaceReason: getSamePlaceReason(closedCandidate),
          verificationDecision: "closed_or_moved",
          verificationSource: candidateSource,
        }),
        verifiedStatus: "Closed/Moved",
        verificationNotes: appendNote(
          place,
          "Google Places reports this business as closed or moved.",
        ),
      },
    };
  }

  const plausibleCandidates = scoredCandidates.filter(
    (candidate) =>
      candidate.matchConfidence >= 0.58 ||
      isStrongCandidate(candidate) ||
      isReasonableSmallDeltaCandidate(candidate) ||
      isReasonableNearDeltaCandidate(candidate),
  );

  if (!isIdentityResolvedSource && plausibleCandidates.length > 1) {
    const candidatesWithAmbiguity = plausibleCandidates.map((candidate) => ({
      ...candidate,
      ambiguityScore: 0,
    }));

    return {
      candidates: candidatesWithAmbiguity.slice(0, 5),
      kind: "ambiguous",
      place: {
        ...applyDecisionFields(place, {
          samePlaceDecision: "Unsure",
          samePlaceReason: "Multiple plausible Google Places candidates were returned.",
          verificationDecision: "ambiguous_multiple_candidates",
          verificationSource: candidateSource,
        }),
        ambiguityScore: 0,
        lastChecked: formatDateForInput(today),
        verifiedStatus: "Review",
        verificationNotes: appendNote(
          place,
          `Multiple Google Places candidates need review: ${candidatesWithAmbiguity
            .slice(0, 5)
            .map(getCandidateSummary)
            .join("; ")}`,
        ),
      },
    };
  }

  const candidate = isIdentityResolvedSource
    ? scoredCandidates.find(isActiveBusiness)
    : (plausibleCandidates.find(
        (plausibleCandidate) =>
          isActiveBusiness(plausibleCandidate) &&
          isStrongCandidate(plausibleCandidate),
      ) ?? scoredCandidates.find(isReviewCandidateWorthSaving));

  if (!candidate) {
    return {
      kind: "no_match",
      place: {
        ...applyDecisionFields(place, {
          samePlaceDecision: "Unsure",
          samePlaceReason:
            "Google Places candidates were too weak, ambiguous, or mismatched for automatic verification.",
          verificationDecision: "candidate_only_review",
          verificationSource: candidateSource,
        }),
        lastChecked: formatDateForInput(today),
        verifiedStatus: "Review",
        verificationNotes: appendNote(
          place,
          "Google Places verification did not find a high-confidence active match.",
        ),
      },
    };
  }

  let verificationDecision: VerificationDecisionKind = "candidate_only_review";
  let samePlaceDecision: Place["samePlaceDecision"] = "Unsure";
  let samePlaceReason = getSamePlaceReason(candidate);

  if (!isCityCountryMatch(candidate)) {
    samePlaceReason =
      "Candidate did not match the expected city/country, so coordinates were not auto-corrected.";
  } else if (
    isIdentityResolvedSource &&
    isIdentityResolvedSamePlace(place, candidate, candidateSource)
  ) {
    verificationDecision =
      candidateSource === "place_id"
        ? "auto_corrected_from_place_id"
        : "auto_corrected_from_google_url";
    samePlaceDecision = "Yes";
    samePlaceReason = `${getSamePlaceReason(candidate)} The candidate came from ${
      candidateSource === "place_id" ? "Google Place ID" : "Google Maps URL"
    }, so stored coordinates are treated as derived data.`;
  } else if (isIdentityResolvedSource) {
    samePlaceReason = isTrustedExistingGoogleIdentity(place, candidateSource)
      ? "Resolved Google listing did not match the expected city/country, so coordinates were not auto-corrected."
      : "Resolved Google listing did not have strong enough row name/address/city evidence for this untrusted machine-derived Google identity, so coordinates were not auto-corrected.";
  } else if (isReasonableSmallDeltaCandidate(candidate)) {
    verificationDecision = "auto_verified_small_delta";
    samePlaceDecision = "Yes";
    samePlaceReason = `${getSamePlaceReason(candidate)} Distance is under 30m with a reasonable name and city match, so imperfect address/name formatting did not block verification.`;
  } else if (isReasonableNearDeltaCandidate(candidate)) {
    verificationDecision = "auto_verified_small_delta";
    samePlaceDecision = "Yes";
    samePlaceReason = `${getSamePlaceReason(candidate)} Distance is under 100m with strong name or address evidence, so this is safe for personal-map verification.`;
  } else if (isRuleASmallDelta(candidate)) {
    verificationDecision = "auto_verified_small_delta";
    samePlaceDecision = "Yes";
  } else if (isRuleBLargeDelta(candidate)) {
    verificationDecision =
      candidate.distanceMeters !== null && candidate.distanceMeters <= 30
        ? "auto_verified_small_delta"
        : "auto_corrected_from_text_search";
    samePlaceDecision = "Yes";
  }

  let nextPlace: Place = applyDecisionFields(
    applyCandidateFields(place, candidate, today),
    {
      samePlaceDecision,
      samePlaceReason,
      verificationDecision,
      verificationSource: candidateSource,
    },
  );

  nextPlace = applyAutoDecisionIfRequested(
    nextPlace,
    candidate,
    verificationDecision,
    options,
    today,
  );

  if (samePlaceDecision !== "Yes" && isReviewVerificationDecision(verificationDecision)) {
    nextPlace = {
      ...nextPlace,
      verifiedStatus: "Review",
      verificationNotes: appendNote(
        nextPlace,
        place.verifiedStatus === "Yes"
          ? "Previously verified row now needs review under the stricter Google identity policy. Existing coordinates were preserved."
          : "Candidate metadata captured, but same-place decision remained unsure.",
      ),
    };
  }

  if (isClosedVerificationDecision(verificationDecision)) {
    nextPlace = {
      ...nextPlace,
      verifiedStatus: "Closed/Moved",
    };
  }

  const canSafelyApplyCoordinates =
    options.applyAutoDecisions !== true &&
    options.applySafeCoordinateUpdates === true &&
    candidate.location &&
    isRuleASmallDelta(candidate);

  if (canSafelyApplyCoordinates && candidate.location) {
    nextPlace = {
      ...copyCandidateCoordinates(nextPlace, candidate),
      verificationNotes: appendNote(
        nextPlace,
        "Safe Google Places candidate coordinates were applied automatically.",
      ),
    };
  }

  return {
    candidate,
    kind: "high_confidence",
    place: nextPlace,
    safeCoordinateUpdateApplied:
      nextPlace.latitude !== place.latitude || nextPlace.longitude !== place.longitude,
  };
}

export function summarizeAutoDecisions(places: Place[]): AutoDecisionSummary {
  const initialSummary: AutoDecisionSummary = {
    autoCorrectedLargeDelta: [],
    autoCorrectedLargeDeltaCount: 0,
    autoVerifiedSmallDeltaCount: 0,
    candidateOnlyReviewCount: 0,
    correctedFromGoogleMapsUrlCount: 0,
    correctedFromPlaceIdCount: 0,
    correctedFromTextSearchCount: 0,
    closedMovedCount: 0,
    noCandidateCount: 0,
    rowsProcessed: 0,
  };

  return places.reduce(
    (summary, place) => {
      const nextSummary = {
        ...summary,
        rowsProcessed: summary.rowsProcessed + 1,
      };

      if (place.verificationDecision === "auto_verified_small_delta") {
        nextSummary.autoVerifiedSmallDeltaCount += 1;
      } else if (
        place.verificationDecision === "auto_corrected_large_delta" ||
        place.verificationDecision === "auto_corrected_from_google_url" ||
        place.verificationDecision === "auto_corrected_from_place_id" ||
        place.verificationDecision === "auto_corrected_from_text_search"
      ) {
        const isLargeDelta =
          typeof place.distanceDeltaMeters === "number" &&
          place.distanceDeltaMeters > 30;

        if (place.verificationDecision === "auto_corrected_from_google_url") {
          nextSummary.correctedFromGoogleMapsUrlCount += 1;
        } else if (place.verificationDecision === "auto_corrected_from_place_id") {
          nextSummary.correctedFromPlaceIdCount += 1;
        } else if (
          place.verificationDecision === "auto_corrected_from_text_search"
        ) {
          nextSummary.correctedFromTextSearchCount += 1;
        } else {
          nextSummary.correctedFromTextSearchCount += 1;
        }

        if (isLargeDelta) {
          nextSummary.autoCorrectedLargeDeltaCount += 1;
        }

        if (
          typeof place.verifiedLatitude === "number" &&
          typeof place.verifiedLongitude === "number" &&
          typeof place.distanceDeltaMeters === "number" &&
          isLargeDelta
        ) {
          nextSummary.autoCorrectedLargeDelta.push({
            addressScore: place.addressScore ?? 0,
            candidateAddress: place.canonicalAddress ?? "",
            candidateName: place.canonicalName ?? "",
            cityScore: place.cityScore ?? 0,
            countryScore: place.countryScore ?? 0,
            distanceDeltaMeters: place.distanceDeltaMeters,
            name: place.name,
            nameScore: place.nameScore ?? 0,
            newLatitude: place.verifiedLatitude,
            newLongitude: place.verifiedLongitude,
            oldLatitude: place.latitude,
            oldLongitude: place.longitude,
            samePlaceReason: place.samePlaceReason ?? "",
            source: place.verificationSource ?? "",
            verificationDecision: place.verificationDecision,
          });
        }
      } else if (place.verificationDecision === "closed_or_moved") {
        nextSummary.closedMovedCount += 1;
      } else if (place.verificationDecision === "no_candidate_found") {
        nextSummary.noCandidateCount += 1;
      } else if (
        place.verificationDecision === "candidate_only_review" ||
        place.verificationDecision === "ambiguous_multiple_candidates"
      ) {
        nextSummary.candidateOnlyReviewCount += 1;
      }

      return nextSummary;
    },
    initialSummary,
  );
}

export function assertAutoDecisionSafetyGate(
  places: Place[],
  options: { force?: boolean } = {},
) {
  if (options.force) {
    return;
  }

  const placesByCity = places.reduce((cityMap, place) => {
    cityMap.set(place.city, [...(cityMap.get(place.city) ?? []), place]);
    return cityMap;
  }, new Map<string, Place[]>());

  for (const [city, cityPlaces] of placesByCity) {
    const largeDeltaCount = cityPlaces.filter(
      (place) =>
        (place.verificationDecision === "auto_corrected_large_delta" ||
          place.verificationDecision === "auto_corrected_from_google_url" ||
          place.verificationDecision === "auto_corrected_from_place_id" ||
          place.verificationDecision === "auto_corrected_from_text_search") &&
        typeof place.distanceDeltaMeters === "number" &&
        place.distanceDeltaMeters > 30,
    ).length;

    if (largeDeltaCount / Math.max(1, cityPlaces.length) > 0.4) {
      throw new AutoDecisionSafetyGateError(
        `Safety gate stopped write: ${largeDeltaCount}/${cityPlaces.length} ${city} rows would be large-delta auto-corrections. Re-run with --force if this is intentional.`,
        city,
        largeDeltaCount,
        cityPlaces.length,
      );
    }
  }
}

export function assertCoordinateAuditFields(
  originalPlacesById: Map<string, Place>,
  processedPlaces: Place[],
) {
  const coordinatesMatchCandidate = (place: Place) =>
    typeof place.latitude === "number" &&
    typeof place.longitude === "number" &&
    typeof place.verifiedLatitude === "number" &&
    typeof place.verifiedLongitude === "number" &&
    Math.abs(place.latitude - place.verifiedLatitude) < 0.0000001 &&
    Math.abs(place.longitude - place.verifiedLongitude) < 0.0000001;
  const invalidVerifiedStatusRows = processedPlaces.filter((place) => {
    if (place.verifiedStatus !== "Yes") {
      return false;
    }

    return !isVerifiedVerificationDecision(place.verificationDecision);
  });
  const invalidReviewDecisionRows = processedPlaces.filter(
    (place) =>
      place.verifiedStatus === "Yes" &&
      (isReviewVerificationDecision(place.verificationDecision) ||
        isClosedVerificationDecision(place.verificationDecision)),
  );

  if (invalidVerifiedStatusRows.length > 0) {
    throw new Error(
      `Refusing to write: ${invalidVerifiedStatusRows.length} verified row${
        invalidVerifiedStatusRows.length === 1 ? "" : "s"
      } have unsupported verificationDecision values: ${invalidVerifiedStatusRows
        .map((place) => place.name)
        .join(", ")}`,
    );
  }

  if (invalidReviewDecisionRows.length > 0) {
    throw new Error(
      `Refusing to write: ${invalidReviewDecisionRows.length} row${
        invalidReviewDecisionRows.length === 1 ? "" : "s"
      } have verifiedStatus=Yes with a review/closed verificationDecision: ${invalidReviewDecisionRows
        .map((place) => place.name)
        .join(", ")}`,
    );
  }

  const coordinateAuditFailures = processedPlaces.filter((place) => {
    const originalPlace = originalPlacesById.get(place.id);

    if (!originalPlace) {
      return false;
    }

    const coordinatesChanged =
      originalPlace.latitude !== place.latitude ||
      originalPlace.longitude !== place.longitude;
    const acceptedGoogleCandidateCoordinates =
      place.verifiedStatus === "Yes" &&
      Boolean(place.googlePlaceId || place.googleMapsUrl) &&
      coordinatesMatchCandidate(place);

    return (
      (coordinatesChanged || acceptedGoogleCandidateCoordinates) &&
      (!place.verificationDecision ||
        !place.verificationSource ||
        !place.samePlaceReason)
    );
  });

  if (coordinateAuditFailures.length > 0) {
    throw new Error(
      `Refusing to write: ${coordinateAuditFailures.length} coordinate change${
        coordinateAuditFailures.length === 1 ? "" : "s"
      } are missing verificationDecision, verificationSource, or samePlaceReason: ${coordinateAuditFailures
        .map((place) => place.name)
        .join(", ")}`,
    );
  }
}
