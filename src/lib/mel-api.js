const WFS_URL = "https://data.lillemetropole.fr/geoserver/dsp_ilevia/ows";
const WORKSPACE = "dsp_ilevia";

export class MelApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "MelApiError";
    this.status = options.status ?? null;
    this.cause = options.cause;
  }
}

export function extractRecords(json) {
  if (Array.isArray(json?.records)) return json.records;
  if (!Array.isArray(json?.features)) return [];
  return json.features
    .map((feature) => feature?.properties ?? feature)
    .filter((record) => record && typeof record === "object");
}

export function buildWfsUrl(layer, { count = 5000, cqlFilter } = {}) {
  const url = new URL(WFS_URL);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", `${WORKSPACE}:${layer}`);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("count", String(count));
  if (cqlFilter) url.searchParams.set("CQL_FILTER", cqlFilter);
  return url.toString();
}

export async function fetchWfsRecords(layer, options = {}) {
  const {
    count = 5000,
    cqlFilter,
    timeoutMs = 12000,
    fetchImpl = globalThis.fetch,
  } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(buildWfsUrl(layer, { count, cqlFilter }), {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new MelApiError(`MEL API HTTP ${response.status}`, { status: response.status });
    }
    return extractRecords(await response.json());
  } catch (error) {
    if (error instanceof MelApiError) throw error;
    const message = error?.name === "AbortError"
      ? "MEL API timeout"
      : "MEL API unavailable";
    throw new MelApiError(message, { cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeHex(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(normalized) ? `#${normalized.toUpperCase()}` : null;
}

export async function fetchLineColors(options = {}) {
  const records = await fetchWfsRecords("couleurs_lignes", { count: 3000, ...options });
  const colors = {};
  for (const record of records) {
    const mode = String(record?.mode_transport ?? "").toUpperCase();
    if (mode && mode !== "BUS") continue;
    const bg = normalizeHex(record?.couleur_fond_hexadecimal);
    const fg = normalizeHex(record?.couleur_texte_hexadecimal);
    if (!bg && !fg) continue;
    for (const code of [record?.code_ligne_public, record?.code_ligne].filter(Boolean)) {
      colors[String(code).trim().toUpperCase()] = { bg: bg ?? "", fg: fg ?? "" };
    }
  }
  return colors;
}
