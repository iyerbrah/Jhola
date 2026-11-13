"use server";

import { cookies, headers } from "next/headers";
import { clientIpFrom } from "@/lib/http";
import { ADMIN_COOKIE, adminKey, adminToken, checkKey, cookieOptions, KEY_MESSAGES } from "@/lib/admin";

export type UnlockState = { error: string | null };

/** Checks the admin key and, if it's right, sets the signed cookie. The page re-renders with the private parts. */
export async function unlock(_prev: UnlockState, form: FormData): Promise<UnlockState> {
  const result = await checkKey(String(form.get("key") ?? ""), clientIpFrom(await headers()));
  if (result !== "ok") return { error: KEY_MESSAGES[result] };
  (await cookies()).set(ADMIN_COOKIE, adminToken(adminKey()!), cookieOptions());
  return { error: null };
}

/** Hides the private parts again on this browser. */
export async function lock(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}
