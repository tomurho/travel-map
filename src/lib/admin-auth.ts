import { createHmac, timingSafeEqual } from "node:crypto";

type AdminRequest = {
  headers: Pick<Headers, "get">;
};

type AdminEnvironment = {
  adminPassword?: string;
  nodeEnv?: string;
  enableAdmin?: string;
  vercel?: string;
};

export function isAdminEnabled(
  environment: AdminEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    enableAdmin: process.env.ENABLE_ADMIN,
    vercel: process.env.VERCEL,
  },
) {
  // Hosted deployments never provide Admin, even if an old flag is enabled.
  if (environment.vercel === "1" || environment.enableAdmin === "false")
    return false;
  return (
    environment.nodeEnv !== "production" || environment.enableAdmin === "true"
  );
}

export function isAdminAuthorized(
  request: AdminRequest,
  environment: AdminEnvironment = {
    adminPassword: process.env.ADMIN_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
    enableAdmin: process.env.ENABLE_ADMIN,
    vercel: process.env.VERCEL,
  },
) {
  if (!isAdminEnabled(environment)) return false;

  const configuredPassword = environment.adminPassword ?? "";

  if (!configuredPassword) {
    return environment.nodeEnv !== "production";
  }

  const session = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("travel_admin="))
    ?.slice("travel_admin=".length);
  if (session) {
    const [expiry, signature] = session.split(".");
    if (
      /^\d+$/.test(expiry ?? "") &&
      Number(expiry) > Date.now() &&
      Number(expiry) < Date.now() + 9 * 60 * 60 * 1000 &&
      /^[a-f0-9]{64}$/.test(signature ?? "")
    ) {
      const expected = createHmac("sha256", configuredPassword)
        .update(`catalogue-session:${expiry}`)
        .digest("hex");
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
        return true;
    }
  }
  const suppliedPassword = request.headers.get("x-admin-password") ?? "";
  const configured = Buffer.from(configuredPassword);
  const supplied = Buffer.from(suppliedPassword);

  return (
    configured.length === supplied.length &&
    timingSafeEqual(configured, supplied)
  );
}
