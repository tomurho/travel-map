"use client";

import { useEffect, useRef, useState } from "react";

import { formatProviderAttemptSummary } from "@/lib/admin-ui";
import { formatDistance } from "@/lib/geo";
import type { PlacePipelineStatus } from "@/lib/place-sheet-pipeline";
import {
  hasMaterialCanonicalAddressDifference,
  type Place,
  type PlaceStatus,
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
  name: string;
  city: string;
  category: string;
  status: PlaceStatus;
  loved: "true" | "false" | "null";
  district: string;
  address: string;
  googleMapsUrl: string;
  latitude: string;
  longitude: string;
  notes: string;
  verifiedStatus: PlaceVerifiedStatus;
  lastChecked: string;
  verificationNotes: string;
};

type ProductionSortMode = "name" | "city" | "status" | "verification";

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

type PipelineSyncResult = {
  changes?: Array<{
    action: "insert" | "update";
    id: string;
    name: string;
    rowNumber: number;
  }>;
  error?: string;
  inserted?: number;
  rowsRead?: number;
  skipped?: number;
  updated?: number;
  validationErrors?: Array<{
    errors: string[];
    id: string;
    rowNumber: number;
  }>;
  wrote?: boolean;
};

type PipelinePublishResult = {
  approvedRowsFound?: number;
  blankIdRowsSkipped?: number;
  duplicateIdsSkipped?: string[];
  duplicateRowsSkipped?: number;
  error?: string;
  mode?: "preview" | "write";
  publishedRows?: number;
  rowsSkipped?: number;
  rowsToPublish?: number;
  rowsToUpdate?: number;
  validationIssues?: number;
  verifiedRowsFound?: number;
  wouldPublishRows?: Array<{
    id: string;
    name: string;
  }>;
  wrote?: boolean;
};

type PipelineReviewResult = {
  apiCallsMade?: number;
  blankRawName?: number;
  duplicateReviewId?: string;
  duplicateReviewIds?: string[];
  duplicateReviewRows?: Array<{
    id: string;
    rowNumber: number;
  }>;
  enrichedRows?: number;
  reconciledRows?: number;
  error?: string;
  skippedRowDetails?: Array<{
    reason: string;
    rowNumber: number;
  }>;
  skippedRows?: number;
};

type PipelineStatusResponse = PlacePipelineStatus & { error?: string };

type ScreenshotExtractionResult = {
  cityHint: string;
  countryHint: string;
  fileName: string;
  id: string;
  ignored: boolean;
  previewUrl: string;
  rawName: string;
  rawText: string;
};

type ScreenshotIntakeSummary = {
  imagesProcessed?: number;
  rowsCreated?: number;
  rowsExtracted?: number;
  rowsSkipped?: number;
  rowsSubmitted?: number;
  results?: Array<{
    rawName: string;
    sourceScreenshot: string;
    status: "created" | "duplicate";
  }>;
};

const DEFAULT_PIPELINE_SHEET_ID =
  "1kVnvUBm-jxAR8zIxh8PyhFEDUgC8b1Y0Q3SObITMpJw";

const PIPELINE_ACTION_LABELS: Record<
  PlacePipelineStatus["recommendedAction"],
  string
> = {
  fix_errors: "Fix the invalid Published rows before updating the app.",
  mark_ready: "Choose the New captures you want to process and mark them Ready.",
  process_ready: "Process the Ready Capture rows next.",
  publish_verified: "Preview and apply Publish for the verified changes.",
  up_to_date: "Nothing is waiting. The Sheet and travel map are up to date.",
  update_app: "Preview and apply the travel-map update next.",
  verify_candidates: "Review the Candidate rows and verify the correct places.",
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

const PLACE_STATUS_OPTIONS: Array<{ label: string; value: PlaceStatus }> = [
  { label: "Location", value: "location" },
  { label: "Been", value: "been" },
  { label: "Want to go", value: "want_to_go" },
];

const PRODUCTION_SORT_OPTIONS: Array<{ label: string; value: ProductionSortMode }> = [
  { label: "Name", value: "name" },
  { label: "City", value: "city" },
  { label: "Status", value: "status" },
  { label: "Verification", value: "verification" },
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

function getProductionStatusLabel(
  place: Pick<Place, "loved" | "status">,
) {
  if (place.loved) {
    return "Loved";
  }

  if (place.status === "been") {
    return "Been";
  }

  if (place.status === "want_to_go") {
    return "Want to go";
  }

  return "Location";
}

function formatNotesForEdit(notes: Place["notes"]) {
  if (Array.isArray(notes)) {
    return notes.join("\n");
  }

  return notes ?? "";
}

function parseNotesForPayload(notes: string) {
  return notes
    .split("\n")
    .map((note) => note.trim())
    .filter(Boolean);
}

function parseLovedForPayload(loved: ProductionPlaceEdit["loved"]) {
  if (loved === "true") {
    return true;
  }

  if (loved === "false") {
    return false;
  }

  return null;
}

function getLovedEditValue(loved: Place["loved"]) {
  if (loved === true) {
    return "true" as const;
  }

  if (loved === false) {
    return "false" as const;
  }

  return "null" as const;
}

function normalizeSearchValue(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function AdminWorkflow({
  categoryOptions,
  cityOptions,
  productionPlaces: initialProductionPlaces,
}: AdminWorkflowProps) {
  const capturePanelRef = useRef<HTMLDetailsElement | null>(null);
  const [cityHint, setCityHint] = useState("all");
  const [plainText, setPlainText] = useState("");
  const [placeUrl, setPlaceUrl] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [productionPlaces, setProductionPlaces] = useState(initialProductionPlaces);
  const [productionFilter, setProductionFilter] =
    useState<AdminVerificationFilter>("all");
  const [productionSearch, setProductionSearch] = useState("");
  const [productionCityFilter, setProductionCityFilter] = useState("all");
  const [productionCategoryFilter, setProductionCategoryFilter] = useState("all");
  const [productionStatusFilter, setProductionStatusFilter] = useState<
    PlaceStatus | "all"
  >("all");
  const [productionSort, setProductionSort] =
    useState<ProductionSortMode>("name");
  const [deleteProductionPlace, setDeleteProductionPlace] =
    useState<Place | null>(null);
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
  const [pipelineSheetId, setPipelineSheetId] = useState(
    DEFAULT_PIPELINE_SHEET_ID,
  );
  const [pipelineResult, setPipelineResult] = useState<PipelineSyncResult | null>(
    null,
  );
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [pipelinePublishResult, setPipelinePublishResult] =
    useState<PipelinePublishResult | null>(null);
  const [pipelinePublishMessage, setPipelinePublishMessage] = useState<
    string | null
  >(null);
  const [pipelineReviewResult, setPipelineReviewResult] =
    useState<PipelineReviewResult | null>(null);
  const [pipelineReviewMessage, setPipelineReviewMessage] = useState<string | null>(
    null,
  );
  const [pipelineStatus, setPipelineStatus] =
    useState<PlacePipelineStatus | null>(null);
  const [pipelineStatusError, setPipelineStatusError] = useState<string | null>(
    null,
  );
  const [isLoadingPipelineStatus, setIsLoadingPipelineStatus] = useState(false);
  const [pipelineMaxApiCalls, setPipelineMaxApiCalls] = useState("1");
  const [isReviewingNewPlaces, setIsReviewingNewPlaces] = useState(false);
  const [isSyncingPublished, setIsSyncingPublished] = useState(false);
  const [isPublishingApprovedPlaces, setIsPublishingApprovedPlaces] =
    useState(false);
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([]);
  const [screenshotResults, setScreenshotResults] = useState<
    ScreenshotExtractionResult[]
  >([]);
  const [screenshotMessage, setScreenshotMessage] = useState<string | null>(null);
  const [screenshotSummary, setScreenshotSummary] =
    useState<ScreenshotIntakeSummary | null>(null);
  const [isExtractingScreenshots, setIsExtractingScreenshots] = useState(false);
  const [isSendingScreenshotsToCapture, setIsSendingScreenshotsToCapture] =
    useState(false);
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

  useEffect(() => {
    void refreshPipelineStatus(DEFAULT_PIPELINE_SHEET_ID);
    // The initial status is intentionally loaded once for the default Sheet.
    // A changed Sheet ID is refreshed explicitly to avoid requests on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const productionCityOptions = Array.from(
    new Set(productionPlaces.map((place) => place.city).filter(Boolean)),
  ).sort((firstCity, secondCity) => firstCity.localeCompare(secondCity));
  const productionCategoryOptions = Array.from(
    new Set(productionPlaces.map((place) => place.category).filter(Boolean)),
  ).sort((firstCategory, secondCategory) =>
    firstCategory.localeCompare(secondCategory),
  );
  const visibleProductionPlaces = productionPlaces
    .filter((place) => {
      const searchValue = normalizeSearchValue(productionSearch);
      const searchableText = normalizeSearchValue(
        [
          place.name,
          place.city,
          place.category,
          place.district,
          place.address,
          place.notes,
          place.verificationNotes,
        ]
          .flat()
          .filter(Boolean)
          .join(" "),
      );

      return (
        matchesVerificationFilter(place.verifiedStatus, productionFilter) &&
        (productionCityFilter === "all" || place.city === productionCityFilter) &&
        (productionCategoryFilter === "all" ||
          place.category === productionCategoryFilter) &&
        (productionStatusFilter === "all" ||
          place.status === productionStatusFilter) &&
        (!searchValue || searchableText.includes(searchValue))
      );
    })
    .sort((firstPlace, secondPlace) => {
      if (productionSort === "city") {
        return (
          firstPlace.city.localeCompare(secondPlace.city) ||
          firstPlace.name.localeCompare(secondPlace.name)
        );
      }

      if (productionSort === "status") {
        return (
          getProductionStatusLabel(firstPlace).localeCompare(
            getProductionStatusLabel(secondPlace),
          ) || firstPlace.name.localeCompare(secondPlace.name)
        );
      }

      if (productionSort === "verification") {
        return (
          getCompactVerificationLabel(firstPlace.verifiedStatus).localeCompare(
            getCompactVerificationLabel(secondPlace.verifiedStatus),
          ) || firstPlace.name.localeCompare(secondPlace.name)
        );
      }

      return firstPlace.name.localeCompare(secondPlace.name);
    });
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
        name: place.name,
        city: place.city,
        category: place.category,
        status: place.status,
        loved: getLovedEditValue(place.loved),
        district: place.district,
        address: place.address ?? "",
        googleMapsUrl: place.googleMapsUrl ?? "",
        latitude: String(place.latitude ?? ""),
        longitude: String(place.longitude ?? ""),
        notes: formatNotesForEdit(place.notes),
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

  function selectProductionPlace(placeId: string) {
    if (
      selectedProductionPlace &&
      selectedProductionPlace.id !== placeId &&
      hasProductionEditChanges(selectedProductionPlace)
    ) {
      const shouldSwitch = window.confirm(
        "Switch places and discard unsaved editor changes?",
      );

      if (!shouldSwitch) {
        return;
      }

      setProductionEdits((currentEdits) => {
        const nextEdits = { ...currentEdits };
        delete nextEdits[selectedProductionPlace.id];
        return nextEdits;
      });
    }

    setSelectedProductionPlaceId(placeId);
  }

  function cancelProductionEdit(place: Place) {
    setProductionEdits((currentEdits) => {
      const nextEdits = { ...currentEdits };
      delete nextEdits[place.id];
      return nextEdits;
    });
    setProductionMessage(`Discarded unsaved changes for ${place.name}.`);
  }

  function startAddPlaceFlow() {
    setPlainText("");
    setPlaceUrl("");
    setFiles([]);
    setResult(null);
    setError(null);
    setStagedMessage(null);
    capturePanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function parseCoordinate(value: string) {
    const coordinate = Number(value);

    return Number.isFinite(coordinate) ? coordinate : null;
  }

  function hasProductionEditChanges(place: Place) {
    const edit = getProductionEdit(place);

    return (
      edit.name !== place.name ||
      edit.city !== place.city ||
      edit.category !== place.category ||
      edit.status !== place.status ||
      edit.loved !== getLovedEditValue(place.loved) ||
      edit.district !== place.district ||
      edit.address !== (place.address ?? "") ||
      edit.googleMapsUrl !== (place.googleMapsUrl ?? "") ||
      edit.latitude !== String(place.latitude ?? "") ||
      edit.longitude !== String(place.longitude ?? "") ||
      edit.notes !== formatNotesForEdit(place.notes) ||
      edit.verifiedStatus !== (place.verifiedStatus ?? "") ||
      edit.lastChecked !== (place.lastChecked ?? "") ||
      edit.verificationNotes !== (place.verificationNotes ?? "")
    );
  }

  function locationNeedsVerification(place: Place) {
    const edit = getProductionEdit(place);

    return (
      edit.address !== (place.address ?? "") ||
      edit.googleMapsUrl !== (place.googleMapsUrl ?? "") ||
      edit.latitude !== String(place.latitude ?? "") ||
      edit.longitude !== String(place.longitude ?? "") ||
      edit.verifiedStatus === "Review" ||
      edit.verifiedStatus === "No" ||
      edit.verifiedStatus === ""
    );
  }

  function getProductionPayload(place: Place) {
    const edit = getProductionEdit(place);

    return {
      name: edit.name,
      city: edit.city,
      category: edit.category,
      status: edit.status,
      loved: parseLovedForPayload(edit.loved),
      district: edit.district,
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
      notes: parseNotesForPayload(edit.notes),
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

  async function refreshPipelineStatus(
    sheetId = pipelineSheetId.trim(),
  ) {
    if (!sheetId) {
      setPipelineStatus(null);
      setPipelineStatusError("Add a Google Sheet ID to check pipeline status.");
      return;
    }

    setIsLoadingPipelineStatus(true);
    setPipelineStatusError(null);

    try {
      const response = await fetch(
        `/api/admin/place-pipeline/status?sheetId=${encodeURIComponent(sheetId)}`,
        { headers: authHeaders() },
      );
      const payload = (await response.json()) as PipelineStatusResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not read pipeline status.");
      }

      setPipelineStatus(payload);
    } catch (statusError) {
      setPipelineStatus(null);
      setPipelineStatusError(
        statusError instanceof Error
          ? statusError.message
          : "Could not read pipeline status.",
      );
    } finally {
      setIsLoadingPipelineStatus(false);
    }
  }

  async function syncPublishedToApp(write: boolean) {
    if (!pipelineSheetId.trim()) {
      setPipelineMessage(null);
      setPipelineResult(null);
      setError("Add a Google Sheet ID before syncing Published rows.");
      return;
    }

    if (write && pipelineResult?.wrote !== false) {
      setError("Preview the app update before applying it.");
      return;
    }

    if (write && pipelineResult?.validationErrors?.length) {
      setError("Resolve every validation error before updating the app.");
      return;
    }

    if (write && !window.confirm("Apply the previewed changes to the travel map?")) {
      return;
    }

    setIsSyncingPublished(true);
    setError(null);
    setPipelineMessage(null);
    if (!write) {
      setPipelineResult(null);
    }

    try {
      const response = await fetch("/api/admin/place-pipeline/sync-published", {
        body: JSON.stringify({
          confirmWrite: write,
          sheetId: pipelineSheetId.trim(),
          write,
        }),
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders() ?? {}),
        },
        method: "POST",
      });
      const payload = (await response.json()) as PipelineSyncResult;

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not sync Published rows.");
      }

      setPipelineResult(payload);
      setPipelineMessage(
        write
          ? "Published rows were written to the app dataset."
          : "Dry run complete. No app data was changed.",
      );
      if (write) {
        void refreshPipelineStatus();
      }
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Could not sync Published rows.",
      );
    } finally {
      setIsSyncingPublished(false);
    }
  }

  async function reviewNewPlaces() {
    if (!pipelineSheetId.trim()) {
      setPipelineReviewMessage(null);
      setPipelineReviewResult(null);
      setError("Add a Google Sheet ID before processing Ready rows.");
      return;
    }

    const maxApiCalls = Number(pipelineMaxApiCalls);

    if (!Number.isInteger(maxApiCalls) || maxApiCalls <= 0 || maxApiCalls > 10) {
      setPipelineReviewMessage(null);
      setPipelineReviewResult(null);
      setError("Max API calls must be an integer from 1 to 10.");
      return;
    }

    if (
      !window.confirm(
        `This will call Google Places for up to ${maxApiCalls} rows. Continue?`,
      )
    ) {
      return;
    }

    setIsReviewingNewPlaces(true);
    setError(null);
    setPipelineReviewMessage(null);
    setPipelineReviewResult(null);

    try {
      const response = await fetch("/api/admin/place-pipeline/review-new", {
        body: JSON.stringify({
          confirmLiveApi: true,
          maxApiCalls,
          sheetId: pipelineSheetId.trim(),
        }),
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders() ?? {}),
        },
        method: "POST",
      });
      const payload = (await response.json()) as PipelineReviewResult;

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not review new places.");
      }

      setPipelineReviewResult(payload);
      setPipelineReviewMessage(
        "Ready Capture rows were enriched. Review the new Candidate rows in the Review sheet.",
      );
      setPipelinePublishResult(null);
      setPipelineResult(null);
      void refreshPipelineStatus();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "Could not process Ready rows.",
      );
    } finally {
      setIsReviewingNewPlaces(false);
    }
  }

  async function publishApprovedPlaces(write: boolean) {
    if (!pipelineSheetId.trim()) {
      setPipelinePublishMessage(null);
      setPipelinePublishResult(null);
      setError("Add a Google Sheet ID before publishing verified Review rows.");
      return;
    }

    if (write && pipelinePublishResult?.mode !== "preview") {
      setError("Preview the Published changes before applying them.");
      return;
    }

    if (
      write &&
      !window.confirm("Apply the previewed changes to the Published sheet?")
    ) {
      return;
    }

    setIsPublishingApprovedPlaces(true);
    setError(null);
    setPipelinePublishMessage(null);
    if (!write) {
      setPipelinePublishResult(null);
    }

    try {
      const response = await fetch("/api/admin/place-pipeline/publish-approved", {
        body: JSON.stringify({
          confirmWrite: write,
          sheetId: pipelineSheetId.trim(),
          write,
        }),
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders() ?? {}),
        },
        method: "POST",
      });
      const payload = (await response.json()) as PipelinePublishResult;

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not publish verified Review rows.");
      }

      setPipelinePublishResult(payload);
      if (write) {
        setPipelineResult(null);
      }
      setPipelinePublishMessage(
        write
          ? "Previewed changes were applied to Published."
          : "Publish preview ready. Review the summary before applying changes.",
      );
      if (write) {
        void refreshPipelineStatus();
      }
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Could not publish verified Review rows.",
      );
    } finally {
      setIsPublishingApprovedPlaces(false);
    }
  }

  function setScreenshotSelection(nextFiles: File[]) {
    const limitedFiles = nextFiles.slice(0, 10);

    if (nextFiles.length > 10) {
      setError("Screenshot Intake supports up to 10 images per run.");
    } else {
      setError(null);
    }

    setScreenshotFiles(limitedFiles);
    setScreenshotResults([]);
    setScreenshotSummary(null);
    setScreenshotMessage(null);
  }

  function updateScreenshotResult(
    resultId: string,
    field: keyof Pick<
      ScreenshotExtractionResult,
      "cityHint" | "countryHint" | "rawName" | "rawText"
    >,
    value: string,
  ) {
    setScreenshotResults((currentResults) =>
      currentResults.map((result) =>
        result.id === resultId ? { ...result, [field]: value } : result,
      ),
    );
  }

  function toggleScreenshotResult(resultId: string) {
    setScreenshotResults((currentResults) =>
      currentResults.map((result) =>
        result.id === resultId
          ? { ...result, ignored: !result.ignored }
          : result,
      ),
    );
  }

  async function extractScreenshotPlaces() {
    if (screenshotFiles.length === 0) {
      setError("Select one or more screenshots before extracting places.");
      return;
    }

    setIsExtractingScreenshots(true);
    setError(null);
    setScreenshotMessage(null);
    setScreenshotSummary(null);
    setScreenshotResults([]);

    const formData = new FormData();

    for (const file of screenshotFiles) {
      formData.append("images", file);
    }

    try {
      const response = await fetch("/api/admin/screenshot-intake/extract", {
        body: formData,
        headers: authHeaders(),
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        imagesProcessed?: number;
        rows?: Array<{
          cityHint?: string;
          countryHint?: string;
          fileName?: string;
          rawName?: string;
          rawText?: string;
        }>;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not extract places.");
      }

      const previewUrlsByFileName = new Map(
        screenshotFiles.map((file) => [file.name, URL.createObjectURL(file)]),
      );
      const rows = (payload.rows ?? []).map((row) => ({
        cityHint: row.cityHint ?? "",
        countryHint: row.countryHint ?? "",
        fileName: row.fileName ?? "",
        id: globalThis.crypto.randomUUID(),
        ignored: false,
        previewUrl: previewUrlsByFileName.get(row.fileName ?? "") ?? "",
        rawName: row.rawName ?? "",
        rawText: row.rawText ?? "",
      }));

      setScreenshotResults(rows);
      setScreenshotSummary({
        imagesProcessed: payload.imagesProcessed ?? screenshotFiles.length,
        rowsExtracted: rows.length,
      });
      setScreenshotMessage(
        rows.length
          ? `Extracted ${rows.length} candidate row${rows.length === 1 ? "" : "s"}.`
          : "No clear place candidates were found.",
      );
    } catch (extractError) {
      setError(
        extractError instanceof Error
          ? extractError.message
          : "Could not extract places from screenshots.",
      );
    } finally {
      setIsExtractingScreenshots(false);
    }
  }

  async function sendScreenshotRowsToCapture() {
    if (!pipelineSheetId.trim()) {
      setError("Add a Google Sheet ID before sending rows to Capture.");
      return;
    }

    const rowsToSend = screenshotResults.filter(
      (result) => !result.ignored && result.rawName.trim(),
    );

    if (rowsToSend.length === 0) {
      setError("No non-ignored screenshot rows are ready for Capture.");
      return;
    }

    setIsSendingScreenshotsToCapture(true);
    setError(null);
    setScreenshotMessage(null);

    try {
      const response = await fetch(
        "/api/admin/screenshot-intake/send-to-capture",
        {
          body: JSON.stringify({
            rows: rowsToSend.map((row) => ({
              cityHint: row.cityHint,
              countryHint: row.countryHint,
              ignored: row.ignored,
              rawName: row.rawName,
              rawText: row.rawText,
              sourceScreenshot: row.fileName,
            })),
            sheetId: pipelineSheetId.trim(),
          }),
          headers: {
            "Content-Type": "application/json",
            ...(authHeaders() ?? {}),
          },
          method: "POST",
        },
      );
      const payload = (await response.json()) as ScreenshotIntakeSummary & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not send rows to Capture.");
      }

      setScreenshotSummary((currentSummary) => ({
        ...currentSummary,
        results: payload.results,
        rowsCreated: payload.rowsCreated ?? 0,
        rowsSkipped: payload.rowsSkipped ?? 0,
        rowsSubmitted: payload.rowsSubmitted ?? rowsToSend.length,
      }));
      setScreenshotMessage(
        `Created ${payload.rowsCreated ?? 0} Capture row${
          payload.rowsCreated === 1 ? "" : "s"
        } with intakeStatus = New; skipped ${payload.rowsSkipped ?? 0} duplicate or invalid row${
          payload.rowsSkipped === 1 ? "" : "s"
        }.`,
      );
      void refreshPipelineStatus();
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send rows to Capture.",
      );
    } finally {
      setIsSendingScreenshotsToCapture(false);
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
        ...currentEdit,
        address: responsePayload.place?.address ?? currentEdit.address,
        googleMapsUrl:
          responsePayload.place?.googleMapsUrl ?? currentEdit.googleMapsUrl,
          latitude: currentEdit.latitude,
          longitude: currentEdit.longitude,
          notes: formatNotesForEdit(responsePayload.place?.notes ?? parseNotesForPayload(currentEdit.notes)),
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

  async function confirmDeleteProductionPlace(place: Place) {
    setSavingProductionPlaceId(place.id);
    setError(null);
    setProductionMessage(null);

    try {
      const response = await fetch(
        `/api/admin/places/${encodeURIComponent(place.id)}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );
      const responsePayload = (await response.json()) as {
        error?: string;
        places?: Place[];
      };

      if (!response.ok || !responsePayload.places) {
        throw new Error(responsePayload.error ?? "Could not delete place.");
      }

      setProductionPlaces(responsePayload.places);
      setProductionEdits((currentEdits) => {
        const nextEdits = { ...currentEdits };
        delete nextEdits[place.id];
        return nextEdits;
      });
      setSelectedProductionPlaceId(responsePayload.places[0]?.id ?? null);
      setDeleteProductionPlace(null);
      setProductionMessage(`Deleted ${place.name}.`);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete place.",
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

  const screenshotIntakePanel = (
    <details
      className="panel admin-export-panel admin-secondary-panel admin-pipeline-panel admin-screenshot-intake-panel"
      open
    >
      <summary>Screenshot Intake</summary>
      <div className="admin-pipeline-header">
        <p>
          Extract places from screenshots and create Capture rows for manual
          review.
        </p>
      </div>
      <div className="admin-screenshot-intake-layout">
        <section
          className="admin-pipeline-settings admin-screenshot-upload-card"
          aria-label="Screenshot upload"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setScreenshotSelection(Array.from(event.dataTransfer.files));
          }}
        >
          <h3>Upload Screenshots</h3>
          <p>
            Google Maps, Instagram, article, and notes screenshots are all fine.
          </p>
          <input
            accept="image/*"
            className="admin-hidden-file-input"
            id="screenshot-intake-images"
            multiple
            onChange={(event) =>
              setScreenshotSelection(Array.from(event.target.files ?? []))
            }
            type="file"
          />
          <label
            className="admin-pipeline-action admin-screenshot-select-button"
            htmlFor="screenshot-intake-images"
          >
            Select Images
          </label>
          {screenshotFiles.length ? (
            <div className="admin-screenshot-file-list">
              <strong>
                Selected {screenshotFiles.length} image
                {screenshotFiles.length === 1 ? "" : "s"}
              </strong>
              <ul>
                {screenshotFiles.map((file) => (
                  <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="admin-empty">Drag images here or select up to 10.</p>
          )}
          <button
            className="admin-pipeline-action"
            disabled={isExtractingScreenshots || screenshotFiles.length === 0}
            onClick={extractScreenshotPlaces}
            type="button"
          >
            {isExtractingScreenshots ? "Extracting..." : "Extract Places"}
          </button>
        </section>

        <section
          className="admin-pipeline-results admin-screenshot-results"
          aria-label="Screenshot extraction results"
        >
          <div className="admin-screenshot-results-header">
            <h3>Extraction Results</h3>
            <button
              className="admin-pipeline-action"
              disabled={
                isSendingScreenshotsToCapture ||
                screenshotResults.filter((result) => !result.ignored).length === 0
              }
              onClick={sendScreenshotRowsToCapture}
              type="button"
            >
              {isSendingScreenshotsToCapture
                ? "Sending..."
                : `Send ${
                    screenshotResults.filter((result) => !result.ignored).length
                  } Rows To Capture`}
            </button>
          </div>
          {screenshotMessage ? (
            <p className="admin-success">{screenshotMessage}</p>
          ) : null}
          {screenshotResults.length ? (
            <div className="admin-screenshot-result-list">
              {screenshotResults.map((result) => (
                <article
                  className={`admin-screenshot-result-card${
                    result.ignored ? " is-ignored" : ""
                  }`}
                  key={result.id}
                >
                  {result.previewUrl ? (
                    <img alt="" src={result.previewUrl} />
                  ) : (
                    <div className="admin-screenshot-thumbnail-placeholder">
                      Image
                    </div>
                  )}
                  <div className="admin-screenshot-result-fields">
                    <label>
                      <span>Place Name</span>
                      <input
                        className="admin-draft-input"
                        onChange={(event) =>
                          updateScreenshotResult(
                            result.id,
                            "rawName",
                            event.target.value,
                          )
                        }
                        value={result.rawName}
                      />
                    </label>
                    <label>
                      <span>City</span>
                      <input
                        className="admin-draft-input"
                        onChange={(event) =>
                          updateScreenshotResult(
                            result.id,
                            "cityHint",
                            event.target.value,
                          )
                        }
                        value={result.cityHint}
                      />
                    </label>
                    <label>
                      <span>Country</span>
                      <input
                        className="admin-draft-input"
                        onChange={(event) =>
                          updateScreenshotResult(
                            result.id,
                            "countryHint",
                            event.target.value,
                          )
                        }
                        value={result.countryHint}
                      />
                    </label>
                    <label className="admin-screenshot-raw-text">
                      <span>Raw Extracted Text</span>
                      <textarea
                        className="admin-draft-input admin-draft-textarea"
                        onChange={(event) =>
                          updateScreenshotResult(
                            result.id,
                            "rawText",
                            event.target.value,
                          )
                        }
                        rows={3}
                        value={result.rawText}
                      />
                    </label>
                    <label className="admin-screenshot-ignore-toggle">
                      <input
                        checked={result.ignored}
                        onChange={() => toggleScreenshotResult(result.id)}
                        type="checkbox"
                      />
                      Ignore this row
                    </label>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty">
              Extracted candidates will appear here before anything is written
              to Capture.
            </p>
          )}
          {screenshotSummary ? (
            <div className="admin-export-result">
              <strong>Screenshot Intake summary</strong>
              <div className="admin-preview-chips">
                <span>
                  <strong>{screenshotSummary.imagesProcessed ?? 0}</strong>{" "}
                  images processed
                </span>
                <span>
                  <strong>{screenshotSummary.rowsExtracted ?? 0}</strong>{" "}
                  extracted
                </span>
                <span>
                  <strong>{screenshotSummary.rowsCreated ?? 0}</strong> created
                </span>
                <span>
                  <strong>{screenshotSummary.rowsSkipped ?? 0}</strong> skipped
                </span>
              </div>
              {screenshotSummary.results?.length ? (
                <ul className="admin-note-list">
                  {screenshotSummary.results.map((result, index) => (
                    <li key={`${result.sourceScreenshot}-${result.rawName}-${index}`}>
                      {result.sourceScreenshot || "Unknown screenshot"}: {result.rawName} — {result.status}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </details>
  );

  const googleSheetsPipelinePanel = (
    <details
      className="panel admin-export-panel admin-secondary-panel admin-pipeline-panel"
      open
    >
      <summary>Google Sheets Pipeline</summary>
      <div className="admin-pipeline-header">
        <p>
          Move each place from Capture to Review, then Published, then the local
          travel map.
        </p>
      </div>
      <div className="admin-pipeline-body">
        <section
          aria-labelledby="admin-resume-guide-title"
          className="admin-pipeline-guide"
        >
          <div className="admin-pipeline-guide-header">
            <div>
              <h3 id="admin-resume-guide-title">Coming back after a break?</h3>
              <p>
                Find the first row below that matches your Google Sheet, then
                continue from there. Use column headers; column letters may move.
              </p>
            </div>
            <div className="admin-pipeline-guide-actions">
              <button
                disabled={isLoadingPipelineStatus}
                onClick={() => refreshPipelineStatus()}
                type="button"
              >
                {isLoadingPipelineStatus ? "Checking…" : "Refresh status"}
              </button>
              <a
                href={`https://docs.google.com/spreadsheets/d/${pipelineSheetId.trim()}/edit`}
                rel="noreferrer"
                target="_blank"
              >
                Open Google Sheet ↗
              </a>
            </div>
          </div>
          {pipelineStatus ? (
            <div
              aria-live="polite"
              className={`admin-pipeline-next-action${
                pipelineStatus.recommendedAction === "fix_errors"
                  ? " is-warning"
                  : ""
              }`}
            >
              <span>Do this next</span>
              <strong>
                {PIPELINE_ACTION_LABELS[pipelineStatus.recommendedAction]}
              </strong>
              <small>
                Checked{" "}
                {new Date(pipelineStatus.fetchedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </small>
            </div>
          ) : pipelineStatusError ? (
            <p className="admin-pipeline-status-error" role="alert">
              Status unavailable: {pipelineStatusError}
            </p>
          ) : (
            <p className="admin-pipeline-status-loading" aria-live="polite">
              Checking the Google Sheet…
            </p>
          )}
          <ol className="admin-pipeline-resume-list">
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Capture</span>
                <strong>{pipelineStatus?.capture.new ?? "–"}</strong>
              </div>
              <code>intakeStatus = New</code>
              <p>Change it to <code>Ready</code> when you want Google lookup to run.</p>
            </li>
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Capture</span>
                <strong>{pipelineStatus?.capture.ready ?? "–"}</strong>
              </div>
              <code>intakeStatus = Ready</code>
              <p>Click <strong>Process Ready Rows</strong> below.</p>
            </li>
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Capture → Review</span>
                <strong>{pipelineStatus?.review.candidate ?? "–"}</strong>
              </div>
              <code>intakeStatus = Enriched</code>
              <code>reviewStatus = Candidate</code>
              <p>
                Lookup is complete, but the place is not verified. Check its
                Review row and Maps link, then change it to <code>Verified</code>
                only when correct.
              </p>
            </li>
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Review</span>
                <strong>{pipelineStatus?.readyToPublish ?? "–"}</strong>
              </div>
              <code>reviewStatus = Verified</code>
              <p>
                {pipelineStatus
                  ? `${pipelineStatus.readyToPublish} change${pipelineStatus.readyToPublish === 1 ? "" : "s"} waiting to publish.`
                  : "Preview, then apply Publish."}
              </p>
            </li>
            <li>
              <div className="admin-pipeline-resume-heading">
                <span>Published</span>
                <strong
                  className={
                    pipelineStatus?.validationErrors ? "is-warning" : undefined
                  }
                >
                  {pipelineStatus?.appChanges ?? "–"}
                </strong>
              </div>
              <code>verifiedStatus = Verified</code>
              <p>
                {pipelineStatus?.validationErrors
                  ? `${pipelineStatus.validationErrors} invalid row${pipelineStatus.validationErrors === 1 ? "" : "s"} must be fixed first.`
                  : "No status edit is needed; preview and apply the travel-map update."}
              </p>
            </li>
          </ol>
        </section>

        <details className="admin-pipeline-settings">
          <summary>Advanced settings</summary>
          <div className="admin-pipeline-settings-grid">
            <label>
              <span>Sheet ID</span>
              <input
                className="admin-draft-input"
                onChange={(event) => {
                  setPipelineSheetId(event.target.value);
                  setPipelineStatus(null);
                  setPipelineStatusError(null);
                  setPipelinePublishResult(null);
                  setPipelineResult(null);
                }}
                value={pipelineSheetId}
              />
            </label>
            <label className="admin-pipeline-max-calls">
              <span>Max API calls per run</span>
              <small>Used by Process Ready Rows.</small>
              <input
                className="admin-draft-input"
                max="10"
                min="1"
                onChange={(event) => setPipelineMaxApiCalls(event.target.value)}
                type="number"
                value={pipelineMaxApiCalls}
              />
            </label>
          </div>
        </details>

        <section className="admin-pipeline-workflow" aria-label="Pipeline workflow">
          <article className="admin-pipeline-step">
            <span className="admin-pipeline-step-number">1</span>
            <div>
              <h3>Enrich Ready Captures</h3>
              <dl className="admin-pipeline-step-guide">
                <div>
                  <dt>Before</dt>
                  <dd>In Capture, change each row you want processed from <code>New</code> to <code>Ready</code>.</dd>
                </div>
                <div>
                  <dt>What happens</dt>
                  <dd>
                    Google Places is called, a <code>Candidate</code> row is added
                    to Review, and Capture becomes <code>Enriched</code>. Enriched
                    means lookup complete—not verified.
                  </dd>
                </div>
                <div>
                  <dt>Your next action</dt>
                  <dd>Inspect the candidate in Review and change <code>reviewStatus</code> to <code>Verified</code> only if it is correct.</dd>
                </div>
              </dl>
            </div>
            <button
              className="admin-pipeline-action is-secondary"
              disabled={isReviewingNewPlaces}
              onClick={reviewNewPlaces}
              type="button"
            >
              {isReviewingNewPlaces ? "Processing..." : "Process Ready Rows"}
            </button>
          </article>

          <article className="admin-pipeline-step">
            <span className="admin-pipeline-step-number">2</span>
            <div>
              <h3>Publish Verified Reviews</h3>
              <dl className="admin-pipeline-step-guide">
                <div>
                  <dt>Before</dt>
                  <dd>Confirm the correct Review rows say <code>reviewStatus = Verified</code>.</dd>
                </div>
                <div>
                  <dt>What happens</dt>
                  <dd>Preview shows what will be added or corrected. Apply writes those rows to Published.</dd>
                </div>
                <div>
                  <dt>Your next action</dt>
                  <dd>Review the preview summary, then apply Publish. You do not need to edit Published status.</dd>
                </div>
              </dl>
            </div>
            <div className="admin-pipeline-step-actions">
            <button
              className="admin-pipeline-action is-secondary"
              disabled={isPublishingApprovedPlaces}
              onClick={() => publishApprovedPlaces(false)}
              type="button"
            >
              {isPublishingApprovedPlaces
                ? "Working..."
                : "Preview Publish"}
            </button>
            <button
              className="admin-pipeline-action is-primary"
              disabled={
                isPublishingApprovedPlaces ||
                pipelinePublishResult?.mode !== "preview" ||
                (pipelinePublishResult.rowsToPublish ?? 0) === 0 ||
                Boolean(pipelinePublishResult.validationIssues)
              }
              onClick={() => publishApprovedPlaces(true)}
              type="button"
            >
              Apply Publish
            </button>
            </div>
          </article>

          <article className="admin-pipeline-step">
            <span className="admin-pipeline-step-number">3</span>
            <div>
              <h3>Update Travel Map</h3>
              <dl className="admin-pipeline-step-guide">
                <div>
                  <dt>Before</dt>
                  <dd>Published rows should already say <code>verifiedStatus = Verified</code>. That is the correct final Sheet state.</dd>
                </div>
                <div>
                  <dt>What happens</dt>
                  <dd>Preview validates Published and lists app changes. Apply updates the local travel-map data.</dd>
                </div>
                <div>
                  <dt>Your next action</dt>
                  <dd>Open the Field Guide and confirm the new places look correct.</dd>
                </div>
              </dl>
            </div>
            <div className="admin-pipeline-step-actions">
            <button
              className="admin-pipeline-action is-secondary"
              disabled={isSyncingPublished}
              onClick={() => syncPublishedToApp(false)}
              type="button"
            >
              {isSyncingPublished ? "Working..." : "Preview Update"}
            </button>
            <button
              className="admin-pipeline-action is-primary"
              disabled={
                isSyncingPublished ||
                pipelineResult?.wrote !== false ||
                Boolean(pipelineResult.validationErrors?.length) ||
                (pipelineResult.changes?.length ?? 0) === 0
              }
              onClick={() => syncPublishedToApp(true)}
              type="button"
            >
              Apply Update
            </button>
            </div>
          </article>
        </section>
      </div>
      <section className="admin-pipeline-results" aria-label="Pipeline results">
        <h3>Result summary</h3>
        {pipelineReviewMessage ||
        pipelineMessage ||
        pipelinePublishMessage ||
        pipelineReviewResult ||
        pipelinePublishResult ||
        pipelineResult ? null : (
          <p className="admin-empty">
            Run a pipeline step to see the latest summary here.
          </p>
        )}
        {pipelineReviewMessage ? (
          <p className="admin-success">{pipelineReviewMessage}</p>
        ) : null}
        {pipelineReviewResult ? (
          <div className="admin-export-result">
          <strong>Review New Places summary</strong>
          <div className="admin-preview-chips">
                <span>
                  <strong>{pipelineReviewResult.enrichedRows ?? 0}</strong>{" "}
                  enriched
                </span>
                <span>
                  <strong>{pipelineReviewResult.reconciledRows ?? 0}</strong>{" "}
                  retries reconciled
                </span>
            <span>
              <strong>{pipelineReviewResult.skippedRows ?? 0}</strong> skipped
            </span>
            <span>
              <strong>{pipelineReviewResult.apiCallsMade ?? 0}</strong> API calls
            </span>
            <span
              className={
                pipelineReviewResult.blankRawName ? "is-warning" : undefined
              }
            >
              <strong>{pipelineReviewResult.blankRawName ?? 0}</strong>{" "}
              blankRawName
            </span>
          </div>
          {pipelineReviewResult.duplicateReviewRows?.length ? (
            <ul className="admin-note-list">
              {pipelineReviewResult.duplicateReviewRows
                .slice(0, 8)
                .map((row) => (
                  <li key={`duplicate-review-${row.rowNumber}-${row.id}`}>
                    Row {row.rowNumber}: skipped duplicate Review id {row.id}
                  </li>
                ))}
            </ul>
          ) : pipelineReviewResult.duplicateReviewIds?.length ? (
            <ul className="admin-note-list">
              {pipelineReviewResult.duplicateReviewIds
                .slice(0, 8)
                .map((id) => (
                  <li key={`duplicate-review-${id}`}>
                    Skipped duplicate Review id: {id}
                  </li>
                ))}
            </ul>
          ) : null}
          {pipelineReviewResult.skippedRowDetails?.length ? (
            <ul className="admin-note-list">
              {pipelineReviewResult.skippedRowDetails
                .slice(0, 8)
                .map((row) => (
                  <li key={`review-skip-${row.rowNumber}-${row.reason}`}>
                    Row {row.rowNumber}: {row.reason}
                  </li>
              ))}
            </ul>
          ) : null}
        </div>
        ) : null}
        {pipelineMessage ? (
          <p className="admin-success">{pipelineMessage}</p>
        ) : null}
        {pipelinePublishMessage ? (
          <p className="admin-success">{pipelinePublishMessage}</p>
        ) : null}
        {pipelinePublishResult ? (
          <div className="admin-export-result">
          <strong>
            {pipelinePublishResult.wrote
              ? "Publish complete"
              : "Verified Review preview"}
          </strong>
          <div className="admin-preview-chips">
            <span>
              <strong>
                {pipelinePublishResult.verifiedRowsFound ??
                  pipelinePublishResult.approvedRowsFound ??
                  0}
              </strong>{" "}
              verified
            </span>
                <span>
                  <strong>{pipelinePublishResult.rowsToPublish ?? 0}</strong>{" "}
                  publishable
                </span>
                <span>
                  <strong>{pipelinePublishResult.rowsToUpdate ?? 0}</strong>{" "}
                  corrections
                </span>
            <span>
              <strong>{pipelinePublishResult.rowsSkipped ?? 0}</strong> skipped
            </span>
            <span
              className={
                pipelinePublishResult.validationIssues ? "is-warning" : undefined
              }
            >
              <strong>{pipelinePublishResult.validationIssues ?? 0}</strong>{" "}
              validation issues
            </span>
          </div>
          {pipelinePublishResult.wouldPublishRows?.length ? (
            <ul className="admin-note-list">
              {pipelinePublishResult.wouldPublishRows
                .slice(0, 8)
                .map((row) => (
                  <li key={`publish-${row.id}`}>
                    {row.name || "Unnamed place"} ({row.id})
                  </li>
                ))}
            </ul>
          ) : null}
          {pipelinePublishResult.duplicateIdsSkipped?.length ? (
            <ul className="admin-note-list">
              {pipelinePublishResult.duplicateIdsSkipped
                .slice(0, 8)
                .map((id) => (
                  <li key={`duplicate-publish-${id}`}>
                    Skipped duplicate id: {id}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
        ) : null}
        {pipelineResult ? (
          <div className="admin-export-result">
          <strong>
            {pipelineResult.wrote ? "Write complete" : "Dry run summary"}
          </strong>
          <div className="admin-preview-chips">
            <span>
              <strong>{pipelineResult.rowsRead ?? 0}</strong> rows read
            </span>
            <span>
              <strong>{pipelineResult.inserted ?? 0}</strong> inserted
            </span>
            <span>
              <strong>{pipelineResult.updated ?? 0}</strong> updated
            </span>
            <span>
              <strong>{pipelineResult.skipped ?? 0}</strong> skipped
            </span>
            <span
              className={
                pipelineResult.validationErrors?.length ? "is-warning" : undefined
              }
            >
              <strong>{pipelineResult.validationErrors?.length ?? 0}</strong>{" "}
              validation errors
            </span>
          </div>
          {pipelineResult.changes?.length ? (
            <ul className="admin-note-list">
              {pipelineResult.changes.slice(0, 8).map((change) => (
                <li key={`${change.action}-${change.id}-${change.rowNumber}`}>
                  {change.action}: {change.name} ({change.id})
                </li>
            ))}
          </ul>
        ) : null}
      </div>
        ) : null}
      </section>
    </details>
  );

  return (
    <main className="shell admin-shell">
      <section className="hero panel admin-hero">
        <h1>Admin / Place Pipeline</h1>
        <p>
          Capture screenshot finds, enrich ready rows, publish approved places,
          and update the travel map dataset.
        </p>
      </section>

      <section className="admin-workflow-grid" aria-label="Current admin workflows">
        {screenshotIntakePanel}
        {googleSheetsPipelinePanel}
      </section>
    </main>
  );
}
