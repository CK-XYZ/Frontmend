export class AuditError extends Error {
  /** @param {string} code @param {string} message @param {boolean} [recoverable] @param {unknown} [details] */
  constructor(code, message, recoverable = true, details = null) {
    super(message);
    this.name = "AuditError";
    this.code = code;
    this.recoverable = recoverable;
    this.details = details && typeof details === "object" ? details : null;
  }
}

/** @param {string} hostname */
function isPrivateIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** @param {unknown} value */
export function normalizePublicUrl(value) {
  if (typeof value !== "string") {
    throw new AuditError("INVALID_URL", "Enter a public website URL.");
  }

  const input = value.trim();
  if (!input || input.length > 2048) {
    throw new AuditError("INVALID_URL", "Enter a public website URL.");
  }

  const explicitScheme = input.match(/^([a-z][a-z\d+.-]*):\/\//i)?.[1]?.toLowerCase();
  if (explicitScheme && !["http", "https"].includes(explicitScheme)) {
    throw new AuditError("UNSUPPORTED_URL", "Use a public HTTP or HTTPS URL.");
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new AuditError("INVALID_URL", "That does not look like a valid website URL.");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new AuditError("UNSUPPORTED_URL", "Use a public HTTP or HTTPS URL without credentials.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const privateName =
    hostname === "localhost" ||
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home");
  const ipv6Literal = hostname.includes(":");

  if (!hostname || privateName || ipv6Literal || isPrivateIpv4(hostname)) {
    throw new AuditError(
      "PRIVATE_TARGET",
      "The public audit accepts internet-accessible hostnames only.",
    );
  }

  url.hash = "";
  return url.toString();
}
