import { lookup } from "node:dns/promises";

export async function resolveLocalHostname(hostname) {
  return lookup(hostname, { all: true, verbatim: true });
}
