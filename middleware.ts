import { NextRequest, NextResponse } from "next/server";
import { cdnOrigin } from "@/lib/ads";

// Content-Security-Policy with a fresh nonce per request: only this site's own scripts run, and media comes only from the
// CDN. Ads are made to be embedded anywhere, so any site may frame /ad pages; set FRAME_ANCESTORS (e.g.
// "https://shop.example.com https://www.example.com") to allow only those. Other pages can't be framed.
// Only well-formed sites are used. A setting with nothing usable in it blocks embedding instead of allowing everyone.
function frameAncestors(): string {
  const set = process.env.FRAME_ANCESTORS?.trim();
  if (!set) return "*";
  return set.split(/[\s,]+/).filter((x) => /^(https?:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?\/?|'self')$/i.test(x)).join(" ") || "'none'";
}

export function middleware(req: NextRequest) {
  const dev = process.env.NODE_ENV === "development";
  const nonce = btoa(crypto.randomUUID());
  const embeddable = req.nextUrl.pathname.startsWith("/ad/");
  let cdn = "";
  try { cdn = cdnOrigin(); } catch { /* not set up: the page shows its error */ }
  const csp = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // sizes are set with style attributes
    `img-src 'self' ${cdn}`,
    `media-src ${cdn || "'none'"}`,
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "font-src 'self'", "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
    `frame-ancestors ${embeddable ? frameAncestors() : "'none'"}`,
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("Content-Security-Policy", csp); // Next.js reads the nonce from here
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = { matcher: ["/((?!_next/static|icon.svg|robots.txt).*)"] };
