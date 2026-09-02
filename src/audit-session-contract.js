const PRODUCTION_COOKIE_NAME = "__Host-frontmend_session";
const LOCAL_COOKIE_NAME = "frontmend_session";
const SESSION_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AUDIT_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

function cookieEntries(header) {
  if (typeof header !== "string" || !header) return new Map();
  return new Map(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator < 1
          ? [part, ""]
          : [part.slice(0, separator), part.slice(separator + 1)];
      }),
  );
}

export function auditSessionTokenFromCookie(header, { secure = true } = {}) {
  const cookies = cookieEntries(header);
  const value = cookies.get(secure ? PRODUCTION_COOKIE_NAME : LOCAL_COOKIE_NAME);
  return SESSION_TOKEN_PATTERN.test(value ?? "") ? value : null;
}

export function createAuditSessionToken() {
  return crypto.randomUUID();
}

export async function hashAuditSessionToken(token) {
  if (!SESSION_TOKEN_PATTERN.test(token ?? "")) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createAuditSessionCookie(token, { secure = true } = {}) {
  if (!SESSION_TOKEN_PATTERN.test(token ?? "")) {
    throw new TypeError("A valid audit session token is required.");
  }
  const name = secure ? PRODUCTION_COOKIE_NAME : LOCAL_COOKIE_NAME;
  return [
    `${name}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${AUDIT_SESSION_MAX_AGE_SECONDS}`,
    secure ? "Secure" : null,
  ].filter(Boolean).join("; ");
}
