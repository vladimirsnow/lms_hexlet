"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields, usernameClient } from "better-auth/client/plugins";
import type { auth } from "@/lib/auth";

export const authClient = createAuthClient({
  basePath: "/api/v1/auth",
  plugins: [usernameClient(), inferAdditionalFields<typeof auth>()],
});
