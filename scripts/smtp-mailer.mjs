import nodemailer from "nodemailer";

export function readSmtpConfig(source = process.env) {
  const host = source.SMTP_HOST?.trim();
  const from = source.SMTP_FROM?.trim();
  const user = source.SMTP_USER?.trim();
  const password = source.SMTP_PASSWORD;

  if (Boolean(host) !== Boolean(from)) {
    throw new Error("SMTP_HOST and SMTP_FROM must be configured together.");
  }
  if (Boolean(user) !== Boolean(password)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together.");
  }
  if ((user || password) && !host) {
    throw new Error("SMTP credentials require SMTP_HOST and SMTP_FROM.");
  }
  if (!host || !from) return null;

  const port = Number(source.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port.");
  }
  const requireTlsValue = source.SMTP_REQUIRE_TLS ?? "true";
  if (requireTlsValue !== "true" && requireTlsValue !== "false") {
    throw new Error("SMTP_REQUIRE_TLS must be true or false.");
  }

  return {
    host,
    from,
    port,
    secure: port === 465,
    requireTLS: port !== 465 && requireTlsValue === "true",
    ...(user && password ? { auth: { user, pass: password } } : {}),
  };
}

export function createSmtpTransport(source = process.env) {
  const config = readSmtpConfig(source);
  if (!config) return null;

  const { from, ...transportOptions } = config;
  return {
    from,
    transport: nodemailer.createTransport({
      ...transportOptions,
      pool: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      tls: { minVersion: "TLSv1.2" },
      maxConnections: 1,
      maxMessages: 100,
    }),
  };
}
