import { timingSafeEqual } from "node:crypto";

type AdminRequest = {
  headers: Pick<Headers, "get">;
};

export function isAdminAuthorized(
  request: AdminRequest,
  environment: { adminPassword?: string; nodeEnv?: string } = {
    adminPassword: process.env.ADMIN_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
  },
) {
  const configuredPassword = environment.adminPassword ?? "";

  if (!configuredPassword) {
    return environment.nodeEnv !== "production";
  }

  const suppliedPassword = request.headers.get("x-admin-password") ?? "";
  const configured = Buffer.from(configuredPassword);
  const supplied = Buffer.from(suppliedPassword);

  return (
    configured.length === supplied.length && timingSafeEqual(configured, supplied)
  );
}
