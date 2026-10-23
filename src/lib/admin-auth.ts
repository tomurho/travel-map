import { timingSafeEqual } from "node:crypto";

type AdminRequest = {
  headers: Pick<Headers, "get">;
};

type AdminEnvironment = { adminPassword?: string; nodeEnv?: string; enableAdmin?: string };

export function isAdminEnabled(environment: AdminEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  enableAdmin: process.env.ENABLE_ADMIN,
}) {
  return environment.nodeEnv !== "production" || environment.enableAdmin === "true";
}

export function isAdminAuthorized(
  request: AdminRequest,
  environment: AdminEnvironment = {
    adminPassword: process.env.ADMIN_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
    enableAdmin: process.env.ENABLE_ADMIN,
  },
) {
  if (!isAdminEnabled(environment)) return false;

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
