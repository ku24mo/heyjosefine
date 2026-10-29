import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseConfigured, supabaseUrl } from "./env";

export async function updateSession(request: NextRequest) {
  // Dev without env vars: let requests through rather than 500ing everything.
  if (!supabaseConfigured) {
    return NextResponse.next({ request });
  }

  // Bio-link taps land on the link hub instead of straight into chat.
  // In-app browsers announce themselves in the UA — everyone else typing
  // the URL directly still gets the product.
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
  const fromSocial =
    ua.includes("instagram") || ua.includes("tiktok") || ua.includes("musical_ly");
  const path = request.nextUrl.pathname;
  // Cookie refresh rebuilds the response — keep the rewrite in one place.
  const makeResponse = () =>
    path === "/" && fromSocial
      ? NextResponse.rewrite(new URL("/links", request.url))
      : NextResponse.next({ request });
  let response = makeResponse();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = makeResponse();
        toSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Anonymous-first: guests ARE authenticated users — they belong in chat,
  // never bounced to /auth. Only a *claimed* session shouldn't see the login
  // form itself — /auth/callback must always run (it exchanges the code) and
  // /auth/reset must stay reachable (recovery lands with a live session).
  if (user && !user.is_anonymous && path === "/auth") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
