"use client";

import { RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Scoped boundary so a CRM view failure shows an inline retry rather than
// blanking the whole app shell.
export default function CrmError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] max-w-lg flex-col items-start justify-center gap-4">
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load this CRM view</AlertTitle>
        <AlertDescription>
          {error.message || "Something went wrong. Try again, or head back to the CRM dashboard."}
        </AlertDescription>
      </Alert>
      <Button onClick={() => reset()} type="button">
        <RefreshCw aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
