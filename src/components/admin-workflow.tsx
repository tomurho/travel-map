"use client";

import { useEffect, useState } from "react";
import { AdminPipeline } from "@/components/admin-pipeline";
import { AdminScreenshotIntake } from "@/components/admin-screenshot-intake";
import type { Place } from "@/lib/place";

export function AdminWorkflow() {
  const [adminPassword, setAdminPassword] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [hasLoadedAdminData, setHasLoadedAdminData] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sheetId, setSheetId] = useState("1kVnvUBm-jxAR8zIxh8PyhFEDUgC8b1Y0Q3SObITMpJw");
  async function loadAdminData() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/places", {
        headers: adminPassword ? { "x-admin-password": adminPassword } : undefined,
        cache: "no-store", signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json() as { error?: string; places?: Place[] };
      if (!response.ok || !Array.isArray(payload.places)) throw new Error(response.status === 401 ? "Enter the admin password, then select Load admin data." : payload.error ?? "Could not load admin data.");
      setCategoryOptions(Array.from(new Set(payload.places.map((place) => place.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)));
      setHasLoadedAdminData(true);
      setRefreshKey((current) => current + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load admin data.");
    } finally { setIsLoading(false); }
  }
  useEffect(() => {
    void loadAdminData();
    // Try unprotected localhost once. Protected access stays behind Load admin data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <main className="shell admin-shell">
    <section className="hero panel admin-hero">
      <div className="admin-hero-copy"><h1>Places admin</h1><p>Review captures, check matches, and update your Field Guide.</p></div>
      <details className="admin-access-settings" open={!hasLoadedAdminData}>
        <summary>{hasLoadedAdminData ? "Access settings" : "Load admin data"}</summary>
        <form className="admin-credential" onSubmit={(event) => { event.preventDefault(); void loadAdminData(); }}>
          <label><span>Admin password</span><input className="admin-draft-input" type="password" autoComplete="off" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /></label>
          <small>Required when access is protected. Kept for this page session.</small>
          <button className="admin-pipeline-action is-primary" type="submit" disabled={isLoading}>{isLoading ? "Loading…" : "Load admin data"}</button>
        </form>
      </details>
    </section>
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    {hasLoadedAdminData ? <section className="admin-workflow-grid" aria-label="Current admin workflows">
      <AdminPipeline adminPassword={adminPassword} categoryOptions={categoryOptions} refreshKey={refreshKey} onSheetIdChange={setSheetId} />
      <AdminScreenshotIntake adminPassword={adminPassword} sheetId={sheetId} onSubmitted={() => setRefreshKey((current) => current + 1)} />
    </section> : <p role="status">{isLoading ? "Loading admin data…" : "Load admin data to open the workflows."}</p>}
  </main>;
}
