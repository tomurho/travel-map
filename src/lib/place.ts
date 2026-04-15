export type PlaceStatus = "been" | "want_to_go" | "location";
export type LovedFilter = "all" | "loved" | "unrated";

export interface Place {
  id: string;
  name: string;
  city: string;
  category: string;
  status: PlaceStatus;
  loved: boolean | null;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  tabelog: string;
  subway: string;
}

export interface PlaceFilterState {
  city: string | "all";
  status: PlaceStatus | "all";
  category: string | "all";
  area: string | "all";
  loved: LovedFilter;
}
