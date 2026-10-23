import { AdminWorkflow } from "@/components/admin-workflow";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_ADMIN !== "true") {
    notFound();
  }

  // The page is public HTML. Load private records only through the authenticated API.
  return <AdminWorkflow />;
}
