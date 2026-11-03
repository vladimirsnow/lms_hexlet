import { createHash } from "node:crypto";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getPrisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env";

export { hashPassword, verifyPassword } from "@/lib/auth/password";

const env = getServerEnv();
const prisma = getPrisma();
const hashedTokenPrefix = "sha256$";
const appUrl = new URL(env.APP_URL);
const trustedOrigins = new Set([appUrl.origin]);

if (env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(appUrl.hostname)) {
  for (const hostname of ["localhost", "127.0.0.1"]) {
    trustedOrigins.add(`${appUrl.protocol}//${hostname}${appUrl.port ? `:${appUrl.port}` : ""}`);
  }
}

function hashSessionToken(token: string): string {
  if (token.startsWith(hashedTokenPrefix)) return token;
  return `${hashedTokenPrefix}${createHash("sha256").update(token).digest("hex")}`;
}

function hashTokenFilter(value: unknown, remember: (token: string) => void): unknown {
  if (typeof value === "string") {
    remember(value);
    return hashSessionToken(value);
  }
  if (Array.isArray(value)) return value.map((entry) => hashTokenFilter(entry, remember));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, hashTokenFilter(entry, remember)]),
    );
  }
  return value;
}

const tokenFilterOperands = new Set(["equals", "in", "not", "notIn"]);

function hashSessionQueryValue(value: unknown, remember: (token: string) => void): unknown {
  if (typeof value === "string") return hashTokenFilter(value, remember);
  if (Array.isArray(value)) return value.map((entry) => hashSessionQueryValue(entry, remember));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        tokenFilterOperands.has(key)
          ? key === "not" && entry && typeof entry === "object" && !Array.isArray(entry)
            ? hashSessionQueryValue(entry, remember)
            : hashTokenFilter(entry, remember)
          : entry,
      ]),
    );
  }
  return value;
}

function restoreSessionToken(result: unknown, rawTokens: Map<string, string>): unknown {
  if (Array.isArray(result)) return result.map((entry) => restoreSessionToken(entry, rawTokens));
  if (result && typeof result === "object") {
    const session = result as Record<string, unknown>;
    const tokenHash = session.tokenHash;
    if (typeof tokenHash === "string" && rawTokens.has(tokenHash)) {
      return { ...session, tokenHash: rawTokens.get(tokenHash) };
    }
  }
  return result;
}

const authPrisma = prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, args, query }) {
        if (model !== "Session") return query(args);

        const nextArgs = { ...args } as Record<string, unknown>;
        const rawTokens = new Map<string, string>();
        const remember = (token: string) => {
          if (!token.startsWith(hashedTokenPrefix)) rawTokens.set(hashSessionToken(token), token);
        };
        const data = nextArgs.data as Record<string, unknown> | undefined;
        if (data && typeof data.tokenHash === "string") {
          remember(data.tokenHash);
          data.tokenHash = hashSessionToken(data.tokenHash);
        }

        const where = nextArgs.where as Record<string, unknown> | undefined;
        if (where && "tokenHash" in where) {
          where.tokenHash = hashSessionQueryValue(where.tokenHash, remember);
        }

        const result = await query(nextArgs as typeof args);
        return restoreSessionToken(result, rawTokens) as typeof result;
      },
    },
  },
});

const database = prismaAdapter(authPrisma, {
  provider: "postgresql",
  transaction: true,
});

export const auth = betterAuth({
  appName: "Hexlet College LMS",
  baseURL: env.APP_URL,
  basePath: "/api/v1/auth",
  secret: env.AUTH_SECRET,
  database,
  trustedOrigins: [...trustedOrigins],
  telemetry: { enabled: false },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    autoSignIn: false,
    requireEmailVerification: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    password: {
      hash: hashPassword,
      verify: ({ hash: passwordHash, password }) => verifyPassword(passwordHash, password),
    },
  },
  user: {
    additionalFields: {
      normalizedEmail: { type: "string", required: true, input: false, returned: false },
      role: {
        type: "string",
        required: true,
        defaultValue: "STUDENT",
        input: false,
        returned: true,
      },
      status: {
        type: "string",
        required: true,
        defaultValue: "ACTIVE",
        input: false,
        returned: true,
      },
      firstName: { type: "string", required: true, input: false, returned: true },
      lastName: { type: "string", required: true, input: false, returned: true },
      middleName: { type: "string", required: false, input: false, returned: true },
      phone: { type: "string", required: false, input: false, returned: true },
      locale: { type: "string", required: true, defaultValue: "ru", input: false, returned: true },
      mustChangePassword: {
        type: "boolean",
        required: true,
        defaultValue: true,
        input: false,
        returned: true,
      },
      lastLoginAt: { type: "date", required: false, input: false, returned: false },
      passwordChangedAt: { type: "date", required: false, input: false, returned: false },
      deletedAt: { type: "date", required: false, input: false, returned: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 12,
    fields: { token: "tokenHash" },
  },
  verification: { storeInDatabase: true },
  plugins: [username({ displayUsername: true, immutableUsername: true })],
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "rateLimit",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 60, max: 6 },
      "/sign-in/username": { window: 60, max: 6 },
    },
  },
  disabledPaths: ["/sign-up/email"],
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
    },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path !== "/sign-in/email" && context.path !== "/sign-in/username") return;

      const body = context.body as Record<string, unknown>;
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
      const usernameValue =
        typeof body.username === "string" ? body.username.trim().toLowerCase() : undefined;
      const user = email
        ? await prisma.user.findUnique({
            where: { normalizedEmail: email },
            select: { status: true },
          })
        : usernameValue
          ? await prisma.user.findUnique({
              where: { username: usernameValue },
              select: { status: true },
            })
          : null;

      if (user && user.status !== "ACTIVE") {
        throw new APIError("UNAUTHORIZED", {
          code: "INVALID_EMAIL_OR_PASSWORD",
          message: "Неверный логин или пароль.",
        });
      }
      if (email) body.email = email;
      if (usernameValue) body.username = usernameValue;
    }),
  },
});
