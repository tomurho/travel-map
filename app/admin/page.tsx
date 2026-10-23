import { AdminWorkflow } from "@/components/admin-workflow";
import { isAdminEnabled } from "@/lib/admin-auth";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  if (!isAdminEnabled()) {
    notFound();
  }

  // The page is public HTML. Load private records only through the authenticated API.
  return <AdminWorkflow />;
}
