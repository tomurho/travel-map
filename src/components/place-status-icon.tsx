import { placeStatusPaths, type PlaceStatus } from "@/lib/place-status";

export function PlaceStatusIcon({ status, size = 16, className }: {
  status: PlaceStatus;
  size?: number;
  className?: string;
}) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={className} style={{ flexShrink: 0 }}>
    {placeStatusPaths[status].map((path) => <path key={path} d={path} />)}
  </svg>;
}
