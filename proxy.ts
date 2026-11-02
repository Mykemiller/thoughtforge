/**
 * Access gate for /ask and /api/ask (TH-32 §6, TF-DEC-05: audience is the owner only).
 * Next 16 "proxy" file (the pack named middleware.ts; Next 16 deprecates that convention
 * in favour of proxy.ts with the same request/response API).
 *
 *  - cookie tf_access == sha256hex(TF_ACCESS_KEY)      -> allow
 *  - ?key=<TF_ACCESS_KEY>                               -> set the cookie (httpOnly, secure,
 *                                                          sameSite lax, 90 days) and redirect
 *                                                          to the same path without the query
 *  - otherwise                                          -> /ask renders locked (x-tf-locked: 1) with a
 *                                                          magic-word form; a wrong ?key= redirects to
 *                                                          /ask?denied=1 so the page can say so;
 *                                                          /api/ask answers 401
 *  - TF_ACCESS_KEY unset (local dev)                    -> allow everything, warn once
 */
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, cookieMatchesKey, isGatedPath, queryKeyMatches, sha256Hex } from "@/src/lib/access";

let warned = false;

export async function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (!isGatedPath(pathname)) return NextResponse.next();

  const key = process.env.TF_ACCESS_KEY;
  if (!key) {
    if (!warned) {
      warned = true;
      console.warn("[tf-access] TF_ACCESS_KEY is not set: /ask and /api/ask are open. Set it before deploying.");
    }
    return NextResponse.next();
  }

  const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
  if (await cookieMatchesKey(cookie, key)) return NextResponse.next();

  const presented = searchParams.get("key");
  if (presented && (await queryKeyMatches(presented, key))) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("key");
    const res = NextResponse.redirect(url);
    res.cookies.set({
      name: ACCESS_COOKIE,
      value: await sha256Hex(key),
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ACCESS_COOKIE_MAX_AGE,
    });
    return res;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Ask the Panel is private." }, { status: 401 });
  }
  if (presented) {
    // Wrong magic word: redirect so the guess never stays in the address bar; ?denied=1 lets the page say so.
    const clean = req.nextUrl.clone();
    clean.searchParams.delete("key");
    clean.searchParams.set("denied", "1");
    return NextResponse.redirect(clean);
  }
  const headers = new Headers(req.headers);
  headers.set("x-tf-locked", "1");
  return NextResponse.rewrite(req.nextUrl, { request: { headers } });
}

export const config = {
  matcher: ["/ask", "/ask/:path*", "/api/ask", "/api/ask/:path*"],
};
