import crypto from "node:crypto";

const AUTH_TOKEN_TTL_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_AUTH_SECRET = "talgarclean-beta-secret";
const DEFAULT_DISPATCHER_LOGIN = "dispatcher";
const DEFAULT_DISPATCHER_PASSWORD = "dispatcher123";

function getAuthSecret() {
  return String(process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET);
}

export function normalizePlateNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function normalizeDispatcherLogin(value) {
  return String(value || "").trim().toLowerCase();
}

export function getDispatcherCredentials() {
  return {
    login: normalizeDispatcherLogin(
      process.env.DISPATCHER_LOGIN || DEFAULT_DISPATCHER_LOGIN
    ),
    password: String(process.env.DISPATCHER_PASSWORD || DEFAULT_DISPATCHER_PASSWORD),
  };
}

export function hashPassword(password) {
  const normalizedPassword = String(password || "");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(normalizedPassword, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash) {
    return false;
  }

  const [algorithm, salt, expectedHash] = String(storedHash).split(":");

  if (algorithm !== "scrypt" || !salt || !expectedHash) {
    return false;
  }

  const actualHash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(expectedHash, "hex")
  );
}

function signValue(value) {
  return crypto
    .createHmac("sha256", getAuthSecret())
    .update(value)
    .digest("base64url");
}

export function issueAuthToken(session) {
  const payload = {
    ...session,
    exp: Date.now() + AUTH_TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);

  if (signature.length !== expectedSignature.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );

    if (!payload?.role || !payload?.login || payload.exp < Date.now()) {
      return null;
    }

    return {
      role: payload.role,
      login: payload.login,
      driverName: payload.driverName || null,
    };
  } catch {
    return null;
  }
}
