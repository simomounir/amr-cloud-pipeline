import codes from "./country-codes.json";

const BY_NAME: Record<string, string> = codes;

/** ISO 3166 numeric id (the world-atlas feature id) for a country name as amrtools writes it. */
export function isoNumeric(name: string): string | null {
  return Object.hasOwn(BY_NAME, name) ? BY_NAME[name] : null;
}
