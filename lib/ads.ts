// Ads are read from the CDN only (the custom domain on the bucket). CDN_URL/ads/<id>/manifest.json lists the videos.

export type AdItem = { label: string; video: string; photo: string | null };
/** One video holding several products in a grid. items: which of the ad's items, left to right, top to bottom. */
export type GridPage = { video: string; cols: number; rows: number; tileW: number; tileH: number; pad: number; items: number[] };
export type Ad = { width: number; height: number; fps: number; frames: number; items: AdItem[]; grid: { full: GridPage[]; phone: GridPage[] } | null };

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// Only plain files inside the ad's own folder: no "..", no absolute or other-site links.
const FILE = /^(?:[A-Za-z0-9_-]+\/){0,3}[A-Za-z0-9_-]+\.([a-z0-9]{3,4})$/;
const MAX_ITEMS = 24;

/** CDN_URL as an origin, e.g. https://cdn.example.com. https only (http just for tests on this computer). */
export function cdnOrigin(): string {
  const url = new URL(process.env.CDN_URL ?? "");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("CDN_URL must start with https://");
  return url.origin;
}

function file(value: unknown, types: string[]): string | null {
  const m = typeof value === "string" && value.length <= 200 ? FILE.exec(value) : null;
  return m && types.includes(m[1]) ? m[0] : null;
}
const number = (v: unknown, min: number, max: number) => (typeof v === "number" && v >= min && v <= max ? v : null);

/** The combined videos, or null unless they hold every product exactly once. Nothing in it is trusted. */
function parseGrid(c: unknown, ids: string[], folder: string, aspect: number): Ad["grid"] {
  if (typeof c !== "object" || c === null || ids.some((x) => !x)) return null;
  const pages = (list: unknown): GridPage[] | null => {
    if (!Array.isArray(list) || !list.length || list.length > MAX_ITEMS) return null;
    const out: GridPage[] = [];
    for (const p of list as Record<string, unknown>[]) {
      if (typeof p !== "object" || p === null || !Array.isArray(p.items)) return null;
      const whole = (v: unknown, min: number, max: number) => (Number.isInteger(v) ? number(v, min, max) : null);
      const video = file(p.video, ["mp4"]), cols = whole(p.cols, 1, 8), rows = whole(p.rows, 1, 8), tileW = whole(p.tileW, 64, 4096), tileH = whole(p.tileH, 64, 4096);
      const pad = whole(p.pad, 0, 64), items = (p.items as unknown[]).map((id) => ids.indexOf(String(id)));
      if (!video || !cols || !rows || !tileW || !tileH || pad === null || !items.length || items.length > cols * rows || items.includes(-1)) return null;
      if (Math.abs(tileW / tileH - aspect) / aspect > 0.03) return null;
      out.push({ video: folder + video, cols, rows, tileW, tileH, pad, items });
    }
    const all = out.flatMap((p) => p.items);
    return all.length === ids.length && new Set(all).size === ids.length ? out : null;
  };
  const { full, phone } = c as Record<string, unknown>;
  const f = pages(full), p = pages(phone);
  return f && p && f.length === p.length && f.every((x, i) => x.items.join() === p[i].items.join()) ? { full: f, phone: p } : null;
}

/** The manifest as an ad, or null if it isn't one. Nothing in it is trusted. */
export function parseAd(m: unknown, folder: string): Ad | null {
  if (typeof m !== "object" || m === null) return null;
  const raw = m as Record<string, unknown>;
  const width = number(raw.width, 16, 8192), height = number(raw.height, 16, 8192);
  const fps = number(raw.fps, 1, 240), frames = number(raw.frames, 1, 1e6);
  if (!width || !height || !fps || !frames || !Array.isArray(raw.items)) return null;
  const items: AdItem[] = [], ids: string[] = [];
  for (const it of raw.items as Record<string, unknown>[]) {
    // Only the original and the final videos; raw remakes are in the folder too (show: false).
    if (typeof it !== "object" || it === null || it.show === false) continue;
    const pictures = ["png", "jpg", "jpeg", "webp"];
    const video = file(it.video, ["mp4"]), photo = file(it.photo, pictures) ?? file(it.still, pictures);
    if (!video || items.some((x) => x.video === folder + video)) continue;
    const label = typeof it.label === "string" ? it.label.trim().slice(0, 120) : "";
    items.push({ label: label || (it.kind === "original" || !items.length ? "Original" : `Variant ${items.length}`),
      video: folder + video, photo: photo && folder + photo });
    ids.push(typeof it.id === "string" ? it.id : "");
    if (items.length === MAX_ITEMS) break;
  }
  return items.length ? { width, height, fps, frames, items, grid: parseGrid(raw.combined, ids, folder, width / height) } : null;
}

const MAX_MANIFEST = 256 * 1024;
const lastGood = new Map<string, Ad>(); // shown while the CDN has a problem
const KEEP = 200;

async function readManifest(folder: string): Promise<Ad | null> {
  const res = await fetch(folder + "manifest.json", { next: { revalidate: 60 }, redirect: "error", signal: AbortSignal.timeout(6000) });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_MANIFEST) throw new Error("manifest.json is too large");
  return parseAd(JSON.parse(text), folder);
}

/** The ad, or null if there's no such ad. Cached for a minute, so changes show up within a minute. When the CDN has a
 * problem it's asked once more, then the last good copy is used; only without one does this throw (see app/error.tsx). */
export async function loadAd(id: string): Promise<Ad | null> {
  if (!ID.test(id)) return null;
  try {
    const folder = `${cdnOrigin()}/ads/${id}/`;
    const ad = await readManifest(folder).catch(() => readManifest(folder));
    lastGood.delete(id);
    if (ad) lastGood.set(id, ad);
    if (lastGood.size > KEEP) lastGood.delete(lastGood.keys().next().value!);
    return ad;
  } catch (e) {
    console.error(`ad ${id}: ${e instanceof Error ? e.message : "unknown error"}`); // for the server log only
    const old = lastGood.get(id);
    if (old) return old;
    throw new Error("The ad could not be loaded");
  }
}
