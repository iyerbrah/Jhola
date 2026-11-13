import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminKey, tokenValid } from "@/lib/admin";

/** Has this visitor given the admin key (a valid signed cookie)? */
export async function isUnlocked(): Promise<boolean> {
  return tokenValid((await cookies()).get(ADMIN_COOKIE)?.value, adminKey());
}
