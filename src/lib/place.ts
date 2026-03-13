export type PlaceStatus = "been" | "want_to_go" | "location";
export type LovedFilter = "all" | "loved" | "unrated";

export interface Place {
  id: string;
  name: string;
  category: string;
  status: PlaceStatus;
  loved: boolean | null;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
}

export interface PlaceFilterState {
  status: PlaceStatus | "all";
  category: string | "all";
  area: string | "all";
  loved: LovedFilter;
}
