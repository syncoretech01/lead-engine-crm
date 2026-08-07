export type BackgroundCallWrapupResult =
  | { ok: true }
  | { ok: false; error: string };

type LaunchBackgroundCallWrapupOptions = {
  request: () => Promise<BackgroundCallWrapupResult>;
  onStarted: () => void;
  onSuccess: () => void;
  onFailure: (error: string) => void;
};

/**
 * Start the server request before advancing the cockpit, then settle it without
 * keeping the wrap-up component mounted. Returns false only when the request
 * could not even be launched synchronously.
 */
export function launchBackgroundCallWrapup(options: LaunchBackgroundCallWrapupOptions): boolean {
  let request: Promise<BackgroundCallWrapupResult>;
  try {
    request = options.request();
  } catch (error) {
    options.onFailure(backgroundCallWrapupError(error));
    return false;
  }

  void request.then(
    (result) => {
      if (result.ok) options.onSuccess();
      else options.onFailure(result.error);
    },
    (error) => options.onFailure(backgroundCallWrapupError(error))
  );

  // This is deliberately synchronous. Selecting the next lead must not wait for
  // the server round-trip above.
  options.onStarted();
  return true;
}

export function backgroundCallWrapupError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Could not save the wrap-up.";
}
