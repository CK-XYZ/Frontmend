import { AuditError, normalizePublicUrl } from "./url-policy.js";

function ipv4Parts(value) {
  if (typeof value !== "string" || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function blockedIpv4(parts) {
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function expandedIpv6(value) {
  if (typeof value !== "string") return null;
  let address = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  address = address.split("%")[0];
  const dotted = address.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (dotted) {
    const parts = ipv4Parts(dotted);
    if (!parts) return null;
    const replacement = `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
    address = `${address.slice(0, -dotted.length)}${replacement}`;
  }
  if ((address.match(/::/g) ?? []).length > 1) return null;
  const [leftValue, rightValue = ""] = address.split("::");
  const left = leftValue ? leftValue.split(":") : [];
  const right = rightValue ? rightValue.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((address.includes("::") && missing < 1) || (!address.includes("::") && missing !== 0)) return null;
  const parts = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function blockedIpv6(parts) {
  const allZeroPrefix = parts.slice(0, 6).every((part) => part === 0);
  if (allZeroPrefix) {
    const embedded = [(parts[6] >> 8) & 255, parts[6] & 255, (parts[7] >> 8) & 255, parts[7] & 255];
    if (parts[6] === 0 && (parts[7] === 0 || parts[7] === 1)) return true;
    return blockedIpv4(embedded);
  }
  const mappedIpv4 = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  if (mappedIpv4) {
    return blockedIpv4([(parts[6] >> 8) & 255, parts[6] & 255, (parts[7] >> 8) & 255, parts[7] & 255]);
  }
  return (parts[0] & 0xfe00) === 0xfc00
    || (parts[0] & 0xffc0) === 0xfe80
    || (parts[0] & 0xff00) === 0xff00
    || (parts[0] === 0x100 && parts.slice(1, 4).every((part) => part === 0))
    || (parts[0] === 0x2001 && parts[1] === 0x0db8);
}

export function isPublicResolvedAddress(value) {
  const address = typeof value === "string" ? value : value?.address;
  const ipv4 = ipv4Parts(address);
  if (ipv4) return !blockedIpv4(ipv4);
  const ipv6 = expandedIpv6(address);
  return Boolean(ipv6) && !blockedIpv6(ipv6);
}

export async function assertPublicResolvedDestination(url, resolveHostname) {
  const normalizedUrl = normalizePublicUrl(url);
  if (typeof resolveHostname !== "function") {
    return { url: normalizedUrl, hostname: new URL(normalizedUrl).hostname, addressCount: null };
  }
  const hostname = new URL(normalizedUrl).hostname;
  let resolved;
  try {
    resolved = await resolveHostname(hostname);
  } catch {
    throw new AuditError(
      "DESTINATION_RESOLUTION_FAILED",
      "The public destination could not be resolved safely.",
    );
  }
  const addresses = Array.isArray(resolved) ? resolved : [resolved];
  if (!addresses.length || addresses.some((address) => !isPublicResolvedAddress(address))) {
    throw new AuditError(
      "RESOLVED_DESTINATION_BLOCKED",
      "The destination resolved to a non-public network address.",
    );
  }
  return { url: normalizedUrl, hostname, addressCount: addresses.length };
}

export const publicDestinationBoundary = Object.freeze({
  production: "Cloudflare global fetch is configured to route as public-Internet traffic.",
  local: "Local development resolves and classifies every destination and redirect before fetch, but cannot pin the later connection to that DNS answer.",
});
