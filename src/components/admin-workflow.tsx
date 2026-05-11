"use client";

import { useState } from "react";

import { formatProviderAttemptSummary } from "@/lib/admin-ui";
import { formatDistance } from "@/lib/geo";
import {
  hasMaterialCanonicalAddressDifference,
  type Place,
  type PlaceVerifiedStatus,
} from "@/lib/place";
import {
  type AdminVerificationFilter,
  acceptCandidateCoordinates,
  applyAdminSelectedCandidate,
  getCompactVerificationLabel,
  getVerificationFilterBucket,
  markVerifiedToday,
  matchesVerificationFilter,
  useCanonicalAddress,
  validatePlaceVerification,
} from "@/lib/place-verification";

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
  googleMapsUrl?: string;
  verifiedStatus?: PlaceVerifiedStatus;
  lastChecked?: string;
  verificationNotes?: string;
  googleCategory: string;
  notes: string[];
};

type DraftStatus = "location" | "been" | "loved" | "want_to_go";

type DraftVerificationEdit = {
  googleMapsUrl: string;
  verifiedStatus: PlaceVerifiedStatus;
  lastChecked: string;
  verificationNotes: string;
};

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
  googleMapsUrl?: string;
  verifiedStatus?: PlaceVerifiedStatus;
  lastChecked?: string;
  verificationNotes?: string;
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
  productionPlaces: Place[];
};

type ProductionPlaceEdit = {
  address: string;
  googleMapsUrl: string;
  latitude: string;
  longitude: string;
  verifiedStatus: PlaceVerifiedStatus;
  lastChecked: string;
  verificationNotes: string;
};

type AdminCandidateSummary = {
  addressScore: number;
  businessStatus: string;
  candidateCoordinateSource?: Place["candidateCoordinateSource"];
  canonicalAddress: string;
  canonicalName: string;
  coordinateConfidence?: Place["coordinateConfidence"];
  coordinatePrecision?: Place["coordinatePrecision"];
  distanceDeltaMeters: number | null;
  googleMapsUrl: string;
  googlePlaceId: string;
  latitude: number | null;
  longitude: number | null;
  matchConfidence: number;
  nameScore: number;
  provider: Place["verificationSource"];
};

function formatOptionalValue(value: string | number | undefined | null) {
  if (value === undefined || value === null || value === "") {
    return "Not populated";
  }

  return String(value);
}

function getLatestVerificationNote(place: Pick<Place, "verificationNotes">) {
  return (
    place.verificationNotes
      ?.split("\n")
      .map((note) => note.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

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

const VERIFIED_STATUS_OPTIONS: PlaceVerifiedStatus[] = [
  "",
  "Yes",
  "Review",
  "No",
  "Closed/Moved",
];

const VERIFICATION_FILTER_OPTIONS: Array<{
  label: string;
  value: AdminVerificationFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Verified", value: "verified" },
  { label: "Needs Review", value: "review" },
  { label: "Unverified", value: "unverified" },
  { label: "Closed/Moved", value: "closed_moved" },
];

function getVerificationClass(status: PlaceVerifiedStatus | undefined) {
  if (status === "Yes") {
    return " is-verified";
  }

  if (status === "Review") {
    return " is-review";
  }

  if (status === "No") {
    return " is-unverified";
  }

  if (status === "Closed/Moved") {
    return " is-inactive";
  }

  return "";
}

export function AdminWorkflow({
  categoryOptions,
  cityOptions,
  productionPlaces: initialProductionPlaces,
}: AdminWorkflowProps) {
  const [cityHint, setCityHint] = useState("all");
  const [plainText, setPlainText] = useState("");
  const [placeUrl, setPlaceUrl] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [productionPlaces, setProductionPlaces] = useState(initialProductionPlaces);
  const [productionFilter, setProductionFilter] =
    useState<AdminVerificationFilter>("all");
  const [selectedProductionPlaceId, setSelectedProductionPlaceId] = useState<
    string | null
  >(
    initialProductionPlaces.find((place) =>
      ["", "No", "Review"].includes(place.verifiedStatus ?? ""),
    )?.id ??
      initialProductionPlaces[0]?.id ??
      null,
  );
  const [productionEdits, setProductionEdits] = useState<
    Record<string, ProductionPlaceEdit>
  >({});
  const [candidateOptionsByPlaceId, setCandidateOptionsByPlaceId] = useState<
    Record<string, AdminCandidateSummary[]>
  >({});
  const [providerAttemptsByPlaceId, setProviderAttemptsByPlaceId] = useState<
    Record<string, Array<{ detail: string; provider: string; status: string }>>
  >({});
  const [savingProductionPlaceId, setSavingProductionPlaceId] = useState<
    string | null
  >(null);
  const [resolvingProductionPlaceId, setResolvingProductionPlaceId] = useState<
    string | null
  >(null);
  const [productionMessage, setProductionMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ResolveResponse | null>(null);
  const [draftStatuses, setDraftStatuses] = useState<Record<string, DraftStatus>>({});
  const [draftCategories, setDraftCategories] = useState<Record<string, string>>({});
  const [draftVerificationEdits, setDraftVerificationEdits] = useState<
    Record<string, DraftVerificationEdit>
  >({});
  const [verifiedFilter, setVerifiedFilter] =
    useState<AdminVerificationFilter>("all");
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
  const stagedVerifiedMissingUrlCount = stagedPlaces.filter(
    (place) => place.verifiedStatus === "Yes" && !place.googleMapsUrl?.trim(),
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
  const visibleStagedPlaces = stagedPlaces.filter((place) =>
    matchesVerificationFilter(place.verifiedStatus, verifiedFilter),
  );
  const visibleProductionPlaces = productionPlaces.filter((place) =>
    matchesVerificationFilter(place.verifiedStatus, productionFilter),
  );
  const selectedProductionPlace =
    productionPlaces.find((place) => place.id === selectedProductionPlaceId) ??
    visibleProductionPlaces[0] ??
    null;
  const productionVerificationSummary = productionPlaces.reduce(
    (summary, place) => {
      const bucket = getVerificationFilterBucket(place.verifiedStatus);

      return {
        ...summary,
        [bucket]: (summary[bucket] ?? 0) + 1,
      };
    },
    {} as Record<Exclude<AdminVerificationFilter, "all">, number>,
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

  function getDraftVerificationEdit(
    draftKey: string,
    draft: ResolveDraft,
  ): DraftVerificationEdit {
    return (
      draftVerificationEdits[draftKey] ?? {
        googleMapsUrl: draft.googleMapsUrl ?? "",
        verifiedStatus: draft.verifiedStatus ?? "",
        lastChecked: draft.lastChecked ?? "",
        verificationNotes: draft.verificationNotes ?? "",
      }
    );
  }

  function setDraftVerificationField<K extends keyof DraftVerificationEdit>(
    draftKey: string,
    draft: ResolveDraft,
    field: K,
    value: DraftVerificationEdit[K],
  ) {
    const currentEdit = getDraftVerificationEdit(draftKey, draft);

    setDraftVerificationEdits((currentEdits) => ({
      ...currentEdits,
      [draftKey]: {
        ...currentEdit,
        [field]: value,
      },
    }));
  }

  function getProductionEdit(place: Place): ProductionPlaceEdit {
    return (
      productionEdits[place.id] ?? {
        address: place.address ?? "",
        googleMapsUrl: place.googleMapsUrl ?? "",
        latitude: String(place.latitude ?? ""),
        longitude: String(place.longitude ?? ""),
        verifiedStatus: place.verifiedStatus ?? "",
        lastChecked: place.lastChecked ?? "",
        verificationNotes: place.verificationNotes ?? "",
      }
    );
  }

  function setProductionEditField<K extends keyof ProductionPlaceEdit>(
    place: Place,
    field: K,
    value: ProductionPlaceEdit[K],
  ) {
    const currentEdit = getProductionEdit(place);

    setProductionEdits((currentEdits) => ({
      ...currentEdits,
      [place.id]: {
        ...currentEdit,
        [field]: value,
      },
    }));
  }

  function parseCoordinate(value: string) {
    const coordinate = Number(value);

    return Number.isFinite(coordinate) ? coordinate : null;
  }

  function getProductionPayload(place: Place) {
    const edit = getProductionEdit(place);

    return {
      address: edit.address,
      addressScore: place.addressScore,
      ambiguityScore: place.ambiguityScore,
      businessStatus: place.businessStatus,
      candidateCoordinateSource: place.candidateCoordinateSource,
      canonicalAddress: place.canonicalAddress,
      canonicalName: place.canonicalName,
      cityScore: place.cityScore,
      coordinateConfidence: place.coordinateConfidence,
      coordinatePrecision: place.coordinatePrecision,
      countryScore: place.countryScore,
      distanceDeltaMeters: place.distanceDeltaMeters,
      districtScore: place.districtScore,
      googleMapsUrl: edit.googleMapsUrl,
      googlePlaceId: place.googlePlaceId,
      latitude: parseCoordinate(edit.latitude),
      longitude: parseCoordinate(edit.longitude),
      matchConfidence: place.matchConfidence,
      nameScore: place.nameScore,
      samePlaceDecision: place.samePlaceDecision,
      samePlaceReason: place.samePlaceReason,
      verificationDecision: place.verificationDecision,
      verificationSource: place.verificationSource,
      verifiedLatitude: place.verifiedLatitude,
      verifiedLongitude: place.verifiedLongitude,
      verifiedStatus: edit.verifiedStatus,
      lastChecked: edit.lastChecked,
      verificationNotes: edit.verificationNotes,
    };
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
      setDraftVerificationEdits({});
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
    const verificationEdit = getDraftVerificationEdit(draftKey, draft);
    setStagingDraftKey(draftKey);
    setError(null);
    setStagedMessage(null);

    if (
      verificationEdit.verifiedStatus === "Yes" &&
      !verificationEdit.googleMapsUrl.trim()
    ) {
      setError("Google Maps URL is required when Verified? is set to Yes.");
      setStagingDraftKey(null);
      return;
    }

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
          googleMapsUrl: verificationEdit.googleMapsUrl,
          verifiedStatus: verificationEdit.verifiedStatus,
          lastChecked: verificationEdit.lastChecked,
          verificationNotes: verificationEdit.verificationNotes,
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

    if (stagedVerifiedMissingUrlCount > 0) {
      setError(
        `Add a Google Maps URL to ${stagedVerifiedMissingUrlCount} verified staged place${
          stagedVerifiedMissingUrlCount === 1 ? "" : "s"
        } before publishing.`,
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

  function markSelectedProductionPlaceVerified(place: Place) {
    const currentEdit = getProductionEdit(place);
    const nextEdit = markVerifiedToday({
      ...currentEdit,
      lastChecked: currentEdit.lastChecked,
      verifiedStatus: currentEdit.verifiedStatus,
    });

    setProductionEdits((currentEdits) => ({
      ...currentEdits,
      [place.id]: {
        ...currentEdit,
        lastChecked: nextEdit.lastChecked,
        verifiedStatus: nextEdit.verifiedStatus,
      },
    }));
    setProductionMessage(
      "Marked as verified for today. Save QA changes to write it to the dataset.",
    );
  }

  function acceptProductionCandidateCoordinates(place: Place) {
    const currentEdit = getProductionEdit(place);
    const currentLatitude = parseCoordinate(currentEdit.latitude);
    const currentLongitude = parseCoordinate(currentEdit.longitude);
    const acceptedPlace = acceptCandidateCoordinates({
      ...place,
      address: currentEdit.address,
      googleMapsUrl: currentEdit.googleMapsUrl,
      latitude: currentLatitude ?? place.latitude,
      longitude: currentLongitude ?? place.longitude,
      lastChecked: currentEdit.lastChecked,
      verificationNotes: currentEdit.verificationNotes,
      verifiedStatus: currentEdit.verifiedStatus,
    });

    setProductionPlaces((currentPlaces) =>
      currentPlaces.map((currentPlace) =>
        currentPlace.id === place.id ? { ...currentPlace, ...acceptedPlace } : currentPlace,
      ),
    );
    setProductionEdits((currentEdits) => ({
      ...currentEdits,
      [place.id]: {
        ...currentEdit,
        address: acceptedPlace.address,
        latitude: String(acceptedPlace.latitude ?? ""),
        longitude: String(acceptedPlace.longitude ?? ""),
        lastChecked: acceptedPlace.lastChecked ?? "",
        verifiedStatus: acceptedPlace.verifiedStatus ?? "",
        verificationNotes: acceptedPlace.verificationNotes ?? "",
      },
    }));
    setProductionMessage(
      "Accepted candidate coordinates. Save QA changes to write them to the dataset.",
    );
  }

  function useProductionCanonicalAddress(place: Place) {
    const currentEdit = getProductionEdit(place);
    const updatedPlace = useCanonicalAddress({
      ...place,
      address: currentEdit.address,
    });

    setProductionEdits((currentEdits) => ({
      ...currentEdits,
      [place.id]: {
        ...currentEdit,
        address: updatedPlace.address,
      },
    }));
    setProductionMessage(
      "Canonical address copied into the editable address field. Save QA changes to write it to the dataset.",
    );
  }

  function useProductionCandidate(
    place: Place,
    candidate: AdminCandidateSummary,
  ) {
    const currentEdit = getProductionEdit(place);
    const nextPlace = applyAdminSelectedCandidate(
      {
        ...place,
        googleMapsUrl: currentEdit.googleMapsUrl,
      },
      candidate,
      currentEdit.verificationNotes || place.verificationNotes,
    );

    setProductionPlaces((currentPlaces) =>
      currentPlaces.map((currentPlace) =>
        currentPlace.id === place.id ? nextPlace : currentPlace,
      ),
    );
    setProductionEdits((currentEdits) => ({
      ...currentEdits,
      [place.id]: {
        ...currentEdit,
        googleMapsUrl: nextPlace.googleMapsUrl ?? currentEdit.googleMapsUrl,
        latitude: currentEdit.latitude,
        longitude: currentEdit.longitude,
        verifiedStatus: "Review",
        verificationNotes: nextPlace.verificationNotes ?? "",
      },
    }));
    setProductionMessage(
      "Candidate selected. Accept coordinates to move the saved map pin.",
    );
  }

  async function resolveProductionCandidateCoordinates(place: Place) {
    const currentEdit = getProductionEdit(place);
    const googleMapsUrl = currentEdit.googleMapsUrl.trim();

    setResolvingProductionPlaceId(place.id);
    setError(null);
    setProductionMessage("Resolving candidate coordinates...");

    try {
      const response = await fetch(
        `/api/admin/places/${encodeURIComponent(place.id)}/resolve-google-url`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authHeaders() ?? {}),
          },
          body: JSON.stringify({
            googleMapsUrl,
            place: {
              address: currentEdit.address,
              googleMapsUrl,
              latitude: parseCoordinate(currentEdit.latitude) ?? undefined,
              longitude: parseCoordinate(currentEdit.longitude) ?? undefined,
            },
          }),
        },
      );
      const responsePayload = (await response.json()) as {
        error?: string;
        freeCounters?: {
          blockedByLiveDisabled: number;
          cacheHits: number;
          cacheMisses: number;
          freeGeocodingCalls: number;
        };
        candidateSummaries?: AdminCandidateSummary[];
        place?: Place;
        places?: Place[];
        providerAttempts?: Array<{
          detail: string;
          provider: string;
          status: string;
        }>;
      };

      if (!response.ok || !responsePayload.place || !responsePayload.places) {
        throw new Error(
          responsePayload.error ?? "Candidate coordinates could not be resolved.",
        );
      }

      setProductionPlaces(responsePayload.places);
      setCandidateOptionsByPlaceId((currentOptions) => ({
        ...currentOptions,
        [place.id]: responsePayload.candidateSummaries ?? [],
      }));
      setProviderAttemptsByPlaceId((currentAttempts) => ({
        ...currentAttempts,
        [place.id]: responsePayload.providerAttempts ?? [],
      }));
      setProductionEdits((currentEdits) => ({
        ...currentEdits,
        [place.id]: {
          address: responsePayload.place?.address ?? currentEdit.address,
          googleMapsUrl:
            responsePayload.place?.googleMapsUrl ?? currentEdit.googleMapsUrl,
          latitude: String(responsePayload.place?.latitude ?? ""),
          longitude: String(responsePayload.place?.longitude ?? ""),
          lastChecked: responsePayload.place?.lastChecked ?? "",
          verifiedStatus: responsePayload.place?.verifiedStatus ?? "",
          verificationNotes: responsePayload.place?.verificationNotes ?? "",
        },
      }));

      const resolvedPlace = responsePayload.place;
      const hasCandidateCoordinates =
        resolvedPlace.verifiedLatitude !== undefined &&
        resolvedPlace.verifiedLongitude !== undefined;
      const isReviewCandidate =
        resolvedPlace.verificationDecision === "candidate_only_review" ||
        resolvedPlace.verificationDecision === "ambiguous_multiple_candidates";

      const providerSummary = responsePayload.providerAttempts
        ?.map((attempt) => `${attempt.provider}: ${attempt.status} - ${attempt.detail}`)
        .join(" ");
      setProductionMessage(
        responsePayload.candidateSummaries &&
          responsePayload.candidateSummaries.length > 1
          ? `Multiple candidates were found. Choose the correct listing below.${
              providerSummary ? ` ${providerSummary}` : ""
            }`
          : hasCandidateCoordinates
          ? isReviewCandidate
            ? `Candidate found, but it still needs review before accepting coordinates.${
                providerSummary ? ` ${providerSummary}` : ""
              }`
            : `Candidate found. Review it, then accept candidate coordinates if it is the right pin.${
                providerSummary ? ` ${providerSummary}` : ""
              }`
          : `Candidate coordinates could not be resolved.${
              resolvedPlace.samePlaceReason
                ? ` ${resolvedPlace.samePlaceReason}`
                : getLatestVerificationNote(resolvedPlace)
                  ? ` ${getLatestVerificationNote(resolvedPlace)}`
                  : ""
            }${providerSummary ? ` ${providerSummary}` : ""}`,
      );
    } catch (resolveError) {
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : "Candidate coordinates could not be resolved.",
      );
      setProductionMessage(null);
    } finally {
      setResolvingProductionPlaceId(null);
    }
  }

  async function saveProductionPlace(place: Place) {
    const payload = getProductionPayload(place);
    const validationErrors = validatePlaceVerification(payload);

    if (validationErrors.length > 0) {
      setError(validationErrors.join(" "));
      return;
    }

    setSavingProductionPlaceId(place.id);
    setError(null);
    setProductionMessage(null);

    try {
      const response = await fetch(
        `/api/admin/places/${encodeURIComponent(place.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(authHeaders() ?? {}),
          },
          body: JSON.stringify(payload),
        },
      );
      const responsePayload = (await response.json()) as {
        error?: string;
        place?: Place;
        places?: Place[];
      };

      if (!response.ok || !responsePayload.place || !responsePayload.places) {
        throw new Error(responsePayload.error ?? "Could not save QA changes.");
      }

      setProductionPlaces(responsePayload.places);
      setProductionEdits((currentEdits) => {
        const nextEdits = { ...currentEdits };
        delete nextEdits[place.id];
        return nextEdits;
      });
      setProductionMessage(`Saved QA changes for ${responsePayload.place.name}.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save QA changes.",
      );
    } finally {
      setSavingProductionPlaceId(null);
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
        <section className="panel admin-verification-panel">
          <div className="admin-staged-header">
            <div>
              <h2>Map-pin verification</h2>
              <p>
                Review production places, open their Google Maps source, and mark
                map pins as verified after manual checks.
              </p>
            </div>
            <div className="admin-preview-chips">
              <span>
                <strong>{productionPlaces.length}</strong> places
              </span>
              <span className="is-verified">
                <strong>{productionVerificationSummary.verified ?? 0}</strong>{" "}
                verified
              </span>
              <span className="is-warning">
                <strong>{productionVerificationSummary.review ?? 0}</strong>{" "}
                review
              </span>
              <span>
                <strong>{productionVerificationSummary.unverified ?? 0}</strong>{" "}
                unverified
              </span>
              <span className="is-blocked">
                <strong>{productionVerificationSummary.closed_moved ?? 0}</strong>{" "}
                closed/moved
              </span>
            </div>
          </div>

          {productionMessage ? (
            <p className="admin-success">{productionMessage}</p>
          ) : null}

          <div className="admin-verification-filters" aria-label="QA filters">
            {VERIFICATION_FILTER_OPTIONS.map((option) => (
              <button
                className={productionFilter === option.value ? "is-active" : ""}
                key={option.value}
                onClick={() => setProductionFilter(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="admin-verification-workspace">
            <div className="admin-verification-list">
              {visibleProductionPlaces.map((place) => (
                <button
                  className={`admin-verification-row${
                    selectedProductionPlace?.id === place.id ? " is-active" : ""
                  }`}
                  key={place.id}
                  onClick={() => setSelectedProductionPlaceId(place.id)}
                  type="button"
                >
                  <span>
                    <strong>{place.name}</strong>
                    <small>
                      {place.city} - {place.category || "Uncategorized"} -{" "}
                      {place.district || "No area"}
                    </small>
                  </span>
                  <span
                    className={`admin-verification-badge${getVerificationClass(
                      place.verifiedStatus,
                    )}`}
                  >
                    {getCompactVerificationLabel(place.verifiedStatus)}
                  </span>
                </button>
              ))}
              {visibleProductionPlaces.length === 0 ? (
                <p className="admin-empty">No places match this QA filter.</p>
              ) : null}
            </div>

            {selectedProductionPlace ? (
              (() => {
                const edit = getProductionEdit(selectedProductionPlace);
                const canOpenGoogleMaps = edit.googleMapsUrl.trim().length > 0;
                const canResolveGoogleMapsUrl =
                  resolvingProductionPlaceId !== selectedProductionPlace.id;
                const hasCandidateMetadata =
                  selectedProductionPlace.googlePlaceId !== undefined ||
                  selectedProductionPlace.canonicalName !== undefined ||
                  selectedProductionPlace.canonicalAddress !== undefined ||
                  selectedProductionPlace.verifiedLatitude !== undefined ||
                  selectedProductionPlace.verifiedLongitude !== undefined;
                const candidateOptions =
                  candidateOptionsByPlaceId[selectedProductionPlace.id] ?? [];
                const providerAttempts =
                  providerAttemptsByPlaceId[selectedProductionPlace.id] ?? [];
                const hasUnsavedQaChanges =
                  productionEdits[selectedProductionPlace.id] !== undefined;
                const hasCandidateCoordinates =
                  selectedProductionPlace.verifiedLatitude !== undefined &&
                  selectedProductionPlace.verifiedLongitude !== undefined;
                const hasCanonicalAddressDifference =
                  hasMaterialCanonicalAddressDifference(selectedProductionPlace);

                return (
                  <div className="admin-verification-detail">
                    <div className="admin-draft-header">
                      <div>
                        <h3>{selectedProductionPlace.name}</h3>
                        <p className="admin-source">
                          {[
                            selectedProductionPlace.city,
                            selectedProductionPlace.category,
                            selectedProductionPlace.district,
                          ]
                            .filter(Boolean)
                            .join(" / ")}
                        </p>
                      </div>
                      <span
                        className={`admin-verification-badge${getVerificationClass(
                          edit.verifiedStatus,
                        )}`}
                      >
                        {getCompactVerificationLabel(edit.verifiedStatus)}
                      </span>
                    </div>

                    {hasUnsavedQaChanges ? (
                      <div className="admin-unsaved-banner">
                        Unsaved QA changes.
                      </div>
                    ) : null}

                    <div className="admin-qa-grid">
                      <section className="admin-qa-card">
                        <div className="admin-qa-card-header">
                          <h4>Current saved pin</h4>
                          <span>{edit.verifiedStatus || "No"}</span>
                        </div>
                        <div className="admin-draft-fields admin-qa-fields">
                          <label className="admin-field-full">
                            <span>Address</span>
                            <textarea
                              className="admin-draft-input admin-draft-textarea"
                              onChange={(event) =>
                                setProductionEditField(
                                  selectedProductionPlace,
                                  "address",
                                  event.target.value,
                                )
                              }
                              rows={2}
                              value={edit.address}
                            />
                          </label>
                          <label>
                            <span>Latitude</span>
                            <input
                              className="admin-draft-input"
                              inputMode="decimal"
                              onChange={(event) =>
                                setProductionEditField(
                                  selectedProductionPlace,
                                  "latitude",
                                  event.target.value,
                                )
                              }
                              value={edit.latitude}
                            />
                          </label>
                          <label>
                            <span>Longitude</span>
                            <input
                              className="admin-draft-input"
                              inputMode="decimal"
                              onChange={(event) =>
                                setProductionEditField(
                                  selectedProductionPlace,
                                  "longitude",
                                  event.target.value,
                                )
                              }
                              value={edit.longitude}
                            />
                          </label>
                          <label className="admin-field-full">
                            <span>Google Maps URL</span>
                            <input
                              className="admin-draft-input"
                              onChange={(event) =>
                                setProductionEditField(
                                  selectedProductionPlace,
                                  "googleMapsUrl",
                                  event.target.value,
                                )
                              }
                              placeholder="https://maps.google.com/..."
                              type="url"
                              value={edit.googleMapsUrl}
                            />
                            <small className="admin-field-helper">
                              Uses cache/free sources first. Google Places is only
                              used if live Google lookups are enabled.
                            </small>
                          </label>
                          <label>
                            <span>Verification status</span>
                            <select
                              className="admin-draft-input"
                              onChange={(event) =>
                                setProductionEditField(
                                  selectedProductionPlace,
                                  "verifiedStatus",
                                  event.target.value as PlaceVerifiedStatus,
                                )
                              }
                              value={edit.verifiedStatus}
                            >
                              {VERIFIED_STATUS_OPTIONS.map((status) => (
                                <option key={status || "blank"} value={status}>
                                  {status || "No"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Last checked</span>
                            <input
                              className="admin-draft-input"
                              onChange={(event) =>
                                setProductionEditField(
                                  selectedProductionPlace,
                                  "lastChecked",
                                  event.target.value,
                                )
                              }
                              type="date"
                              value={edit.lastChecked}
                            />
                          </label>
                          <label className="admin-field-full">
                            <span>Verification notes</span>
                            <textarea
                              className="admin-draft-input admin-draft-textarea"
                              onChange={(event) =>
                                setProductionEditField(
                                  selectedProductionPlace,
                                  "verificationNotes",
                                  event.target.value,
                                )
                              }
                              rows={3}
                              value={edit.verificationNotes}
                            />
                          </label>
                        </div>
                      </section>

                      <section className="admin-qa-card admin-resolved-card">
                        <div className="admin-qa-card-header">
                          <h4>Resolved candidate</h4>
                          <span>
                            {formatOptionalValue(
                              selectedProductionPlace.coordinateConfidence,
                            )}
                          </span>
                        </div>
                        {hasCandidateMetadata ? (
                          <div className="admin-candidate-summary">
                            <strong>
                              {formatOptionalValue(
                                selectedProductionPlace.canonicalName,
                              )}
                            </strong>
                            <p>
                              {formatOptionalValue(
                                selectedProductionPlace.canonicalAddress,
                              )}
                            </p>
                            <dl>
                              <div>
                                <dt>Candidate lat/lng</dt>
                                <dd>
                                  {formatOptionalValue(
                                    selectedProductionPlace.verifiedLatitude,
                                  )}
                                  ,{" "}
                                  {formatOptionalValue(
                                    selectedProductionPlace.verifiedLongitude,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Distance from current pin</dt>
                                <dd>
                                  {selectedProductionPlace.distanceDeltaMeters ===
                                  undefined
                                    ? "Not populated"
                                    : `${Math.round(
                                        selectedProductionPlace.distanceDeltaMeters,
                                      )}m`}
                                </dd>
                              </div>
                              <div>
                                <dt>Source</dt>
                                <dd>
                                  {formatOptionalValue(
                                    selectedProductionPlace.candidateCoordinateSource,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Business status</dt>
                                <dd>
                                  {formatOptionalValue(
                                    selectedProductionPlace.businessStatus,
                                  )}
                                </dd>
                              </div>
                            </dl>
                            {selectedProductionPlace.googleMapsUrl ? (
                              <a
                                href={selectedProductionPlace.googleMapsUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Open Google Maps
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <p className="admin-empty-state">
                            No candidate loaded yet. Click Resolve candidate
                            coordinates to try cache/free sources first. Google is
                            only used if enabled.
                          </p>
                        )}
                      </section>
                    </div>

                    {candidateOptions.length > 1 ? (
                      <div className="admin-candidate-options">
                        <h4>Multiple candidates found</h4>
                        <p className="admin-source">
                          Choose the correct listing below. This only loads
                          candidate metadata; it will not move the map pin.
                        </p>
                        {candidateOptions.map((candidate) => {
                          const isSelectedCandidate =
                            selectedProductionPlace.googlePlaceId ===
                            candidate.googlePlaceId;

                          return (
                            <article
                              className={`admin-candidate-option${
                                isSelectedCandidate ? " is-selected" : ""
                              }`}
                              key={`${candidate.provider}-${candidate.googlePlaceId}`}
                            >
                              <div>
                                {isSelectedCandidate ? (
                                  <span className="admin-selected-chip">
                                    Selected candidate
                                  </span>
                                ) : null}
                                <strong>
                                  {candidate.canonicalName || "Unnamed candidate"}
                                </strong>
                                <p>
                                  {candidate.canonicalAddress || "No address"}
                                </p>
                                {candidate.googleMapsUrl ? (
                                  <a
                                    href={candidate.googleMapsUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    Open Google Maps
                                  </a>
                                ) : null}
                              </div>
                              <dl className="admin-candidate-metrics">
                                <div>
                                  <dt>Lat/Lng</dt>
                                  <dd>
                                    {candidate.latitude ?? "Not populated"},{" "}
                                    {candidate.longitude ?? "Not populated"}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Status</dt>
                                  <dd>
                                    {formatOptionalValue(
                                      candidate.businessStatus,
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Confidence</dt>
                                  <dd>{candidate.matchConfidence}</dd>
                                </div>
                                <div>
                                  <dt>Name score</dt>
                                  <dd>{candidate.nameScore}</dd>
                                </div>
                                <div>
                                  <dt>Address score</dt>
                                  <dd>{candidate.addressScore}</dd>
                                </div>
                                <div>
                                  <dt>Distance</dt>
                                  <dd>
                                    {candidate.distanceDeltaMeters === null
                                      ? "Unknown"
                                      : `${Math.round(
                                          candidate.distanceDeltaMeters,
                                        )}m`}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Source</dt>
                                  <dd>{candidate.provider}</dd>
                                </div>
                              </dl>
                              <button
                                disabled={
                                  candidate.latitude === null ||
                                  candidate.longitude === null
                                }
                                onClick={() =>
                                  useProductionCandidate(
                                    selectedProductionPlace,
                                    candidate,
                                  )
                                }
                                type="button"
                              >
                                Use this candidate
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}

                    <details className="admin-technical-details">
                      <summary>Technical details</summary>
                      <p className="admin-provider-summary">
                        {formatProviderAttemptSummary(providerAttempts)}
                      </p>
                      {providerAttempts.length > 0 ? (
                        <details className="admin-provider-details">
                          <summary>Show provider details</summary>
                          <ul>
                            {providerAttempts.map((attempt, index) => (
                              <li key={`${attempt.provider}-${index}`}>
                                <strong>{attempt.provider}</strong>:{" "}
                                {attempt.status} - {attempt.detail}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      <dl className="admin-candidate-grid">
                        <div>
                          <dt>googlePlaceId</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.googlePlaceId)}</dd>
                        </div>
                        <div>
                          <dt>verificationDecision</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.verificationDecision)}</dd>
                        </div>
                        <div>
                          <dt>verificationSource</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.verificationSource)}</dd>
                        </div>
                        <div>
                          <dt>samePlaceDecision</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.samePlaceDecision)}</dd>
                        </div>
                        <div>
                          <dt>samePlaceReason</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.samePlaceReason)}</dd>
                        </div>
                        <div>
                          <dt>matchConfidence</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.matchConfidence)}</dd>
                        </div>
                        <div>
                          <dt>nameScore</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.nameScore)}</dd>
                        </div>
                        <div>
                          <dt>addressScore</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.addressScore)}</dd>
                        </div>
                        <div>
                          <dt>cityScore</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.cityScore)}</dd>
                        </div>
                        <div>
                          <dt>countryScore</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.countryScore)}</dd>
                        </div>
                        <div>
                          <dt>districtScore</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.districtScore)}</dd>
                        </div>
                        <div>
                          <dt>ambiguityScore</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.ambiguityScore)}</dd>
                        </div>
                        <div>
                          <dt>coordinatePrecision</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.coordinatePrecision)}</dd>
                        </div>
                        <div>
                          <dt>coordinateConfidence</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.coordinateConfidence)}</dd>
                        </div>
                        <div>
                          <dt>candidateCoordinateSource</dt>
                          <dd>{formatOptionalValue(selectedProductionPlace.candidateCoordinateSource)}</dd>
                        </div>
                      </dl>
                    </details>

                    <div className="admin-verification-actions">
                      <button
                        className="admin-primary-action"
                        disabled={!canResolveGoogleMapsUrl}
                        onClick={() =>
                          resolveProductionCandidateCoordinates(
                            selectedProductionPlace,
                          )
                        }
                        type="button"
                      >
                        {resolvingProductionPlaceId === selectedProductionPlace.id
                          ? "Resolving..."
                          : "Resolve candidate coordinates"}
                      </button>
                      <button
                        onClick={() =>
                          markSelectedProductionPlaceVerified(selectedProductionPlace)
                        }
                        type="button"
                      >
                        Mark Verified Today
                      </button>
                      <button
                        className="admin-primary-action"
                        disabled={
                          !hasCandidateCoordinates
                        }
                        onClick={() =>
                          acceptProductionCandidateCoordinates(
                            selectedProductionPlace,
                          )
                        }
                        type="button"
                      >
                        Accept candidate coordinates
                      </button>
                      <button
                        disabled={
                          !hasCandidateCoordinates
                        }
                        onClick={() =>
                          setProductionMessage(
                            "Candidate rejected for now. No dataset fields were changed.",
                          )
                        }
                        type="button"
                      >
                        Reject candidate
                      </button>
                      <button
                        disabled={!hasCanonicalAddressDifference}
                        onClick={() =>
                          useProductionCanonicalAddress(selectedProductionPlace)
                        }
                        type="button"
                      >
                        Use canonical address
                      </button>
                      {canOpenGoogleMaps ? (
                        <a
                          href={edit.googleMapsUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open Google Maps
                        </a>
                      ) : (
                        <span className="admin-disabled-action">
                          Add a Google Maps URL to open Maps.
                        </span>
                      )}
                      <button
                        className="admin-save-action"
                        disabled={savingProductionPlaceId === selectedProductionPlace.id}
                        onClick={() => saveProductionPlace(selectedProductionPlace)}
                        type="button"
                      >
                        {savingProductionPlaceId === selectedProductionPlace.id
                          ? "Saving..."
                          : "Save QA changes"}
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <p className="admin-empty">Choose a place to verify.</p>
            )}
          </div>
        </section>

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
                const verificationEdit = getDraftVerificationEdit(draftKey, draft);

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
                      <div className="admin-draft-badges">
                        <span className="badge admin-city-badge">{draft.city}</span>
                        <span
                          className={`admin-verification-badge${getVerificationClass(
                            verificationEdit.verifiedStatus,
                          )}`}
                        >
                          {getCompactVerificationLabel(
                            verificationEdit.verifiedStatus,
                          )}
                        </span>
                      </div>
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
                      <div>
                        <dt>Google Maps URL</dt>
                        <dd>
                          <input
                            aria-label={`Google Maps URL for ${draft.name}`}
                            className="admin-draft-input"
                            onChange={(event) =>
                              setDraftVerificationField(
                                draftKey,
                                draft,
                                "googleMapsUrl",
                                event.target.value,
                              )
                            }
                            placeholder="https://maps.google.com/..."
                            type="url"
                            value={verificationEdit.googleMapsUrl}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Verified?</dt>
                        <dd>
                          <select
                            aria-label={`Verified status for ${draft.name}`}
                            className="admin-draft-input"
                            onChange={(event) =>
                              setDraftVerificationField(
                                draftKey,
                                draft,
                                "verifiedStatus",
                                event.target.value as PlaceVerifiedStatus,
                              )
                            }
                            value={verificationEdit.verifiedStatus}
                          >
                            {VERIFIED_STATUS_OPTIONS.map((status) => (
                              <option key={status || "blank"} value={status}>
                                {status || "Not checked"}
                              </option>
                            ))}
                          </select>
                        </dd>
                      </div>
                      <div>
                        <dt>Last checked</dt>
                        <dd>
                          <input
                            aria-label={`Last checked for ${draft.name}`}
                            className="admin-draft-input"
                            onChange={(event) =>
                              setDraftVerificationField(
                                draftKey,
                                draft,
                                "lastChecked",
                                event.target.value,
                              )
                            }
                            type="date"
                            value={verificationEdit.lastChecked}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Verification notes</dt>
                        <dd>
                          <textarea
                            aria-label={`Verification notes for ${draft.name}`}
                            className="admin-draft-input admin-draft-textarea"
                            onChange={(event) =>
                              setDraftVerificationField(
                                draftKey,
                                draft,
                                "verificationNotes",
                                event.target.value,
                              )
                            }
                            placeholder="Optional QA notes"
                            rows={2}
                            value={verificationEdit.verificationNotes}
                          />
                        </dd>
                      </div>
                    </dl>

                    {draft.latitude === null || draft.longitude === null ? (
                      <div className="admin-duplicate-warning is-blocked">
                        <strong>Needs review: missing map coordinates</strong>
                        <small>
                          Latitude and longitude are required before this can be
                          approved into staging.
                        </small>
                      </div>
                    ) : null}

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
                  {stagedVerifiedMissingUrlCount > 0 ? (
                    <span className="is-blocked">
                      <strong>{stagedVerifiedMissingUrlCount}</strong> verified missing URL
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="admin-staged-filter">
                <label>
                  Verified?
                  <select
                    onChange={(event) =>
                      setVerifiedFilter(
                        event.target.value as AdminVerificationFilter,
                      )
                    }
                    value={verifiedFilter}
                  >
                    {VERIFICATION_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="admin-staged-list">
                {visibleStagedPlaces.map((place) => (
                  <article className="admin-staged-row" key={place.id}>
                    <div>
                      <strong>{place.name}</strong>
                      <span>
                        {place.city} - {place.category || "Uncategorized"} -{" "}
                        {getAdminStatusLabel(place)}
                      </span>
                      <span
                        className={`admin-verification-badge${getVerificationClass(
                          place.verifiedStatus,
                        )}`}
                      >
                        {getCompactVerificationLabel(place.verifiedStatus)}
                      </span>
                      {place.verifiedStatus === "Yes" && !place.googleMapsUrl ? (
                        <div className="admin-duplicate-warning is-blocked">
                          <strong>Verified place needs a Google Maps URL</strong>
                          <small>
                            Add or re-approve with a Google Maps URL before this is
                            treated as fully verified.
                          </small>
                        </div>
                      ) : null}
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
              {visibleStagedPlaces.length === 0 ? (
                <p className="admin-empty">
                  No staged places match that verification filter.
                </p>
              ) : null}
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
