import "dotenv/config";
import { createSmtpTransport } from "./smtp-mailer.mjs";

let mailer;
try {
  mailer = createSmtpTransport(process.env);
  if (!mailer) {
    console.info("SMTP is not configured; verification skipped.");
  } else {
    await mailer.transport.verify();
    console.info("SMTP connection and authentication verified.");
  }
} catch (error) {
  console.error(
    `SMTP verification failed (${error instanceof Error ? error.name : "UnknownError"}).`,
  );
  process.exitCode = 1;
} finally {
  mailer?.transport.close();
}
