"use client";

import { SystemState } from "@/components/system-state";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SystemState kind="error" onRetry={reset} />;
}
