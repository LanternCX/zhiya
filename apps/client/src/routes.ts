import { matchRoutes, useMatches } from "react-router";
import type { View } from "./features/account/types";

export const accountPaths: Record<View, string> = {
  home: "/learn",
  login: "/login",
  register: "/register",
  reset: "/reset-password",
  profile: "/account/profile",
  security: "/account/security",
  password: "/account/security/password",
  email: "/account/security/email",
  delete: "/account/security/delete",
};

// The shared app shell owns page presentation so background learning sessions
// can stay mounted while the router changes the visible destination.
export const pageRoutes = [
  { id: "index", index: true },
  { id: "login", path: "login" },
  { id: "register", path: "register" },
  { id: "reset", path: "reset-password" },
  { id: "onboarding", path: "onboarding" },
  { id: "learning", path: "learn" },
  { id: "course", path: "courses/:courseId" },
  {
    id: "conversation",
    path: "courses/:courseId/conversations/:conversationId",
  },
  { id: "new-conversation", path: "courses/:courseId/conversations/new" },
  { id: "learning-profile", path: "learning-profile" },
  { id: "profile", path: "account/profile" },
  { id: "security", path: "account/security" },
  { id: "password", path: "account/security/password" },
  { id: "email", path: "account/security/email" },
  { id: "delete", path: "account/security/delete" },
  { id: "explore", path: "explore" },
  { id: "lab", path: "lab" },
  { id: "review", path: "review" },
  { id: "not-found", path: "*" },
].map((route) => ({ ...route, element: null }));

export function usePage() {
  const matches = useMatches();
  return matches[matches.length - 1].id;
}

export function isAuthPage(page: string) {
  return page === "login" || page === "register" || page === "reset";
}

export function returnPath(search: string) {
  const target = new URLSearchParams(search).get("returnTo");
  if (!target?.startsWith("/") || target.startsWith("//")) return "/learn";
  const matches = matchRoutes(pageRoutes, target);
  const page = matches?.at(-1)?.route.id;
  return page &&
    !isAuthPage(page) &&
    !["index", "not-found", "onboarding"].includes(page)
    ? target
    : "/learn";
}

export function coursePath(courseId: string) {
  return `/courses/${encodeURIComponent(courseId)}`;
}

export function conversationPath(courseId: string, conversationId: string) {
  return `${coursePath(courseId)}/conversations/${encodeURIComponent(conversationId)}`;
}
