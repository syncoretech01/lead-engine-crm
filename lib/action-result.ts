import { unstable_rethrow } from "next/navigation";

/**
 * Result shape server actions return so a client <ActionForm> can surface a
 * toast. Actions adopt this signature incrementally — only when their screen is
 * touched. Existing void actions and plain <form action> keep working.
 */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/**
 * Wraps an action body so thrown errors become `{ ok: false }` instead of a
 * 500. Framework control-flow errors (redirect(), notFound()) are re-thrown via
 * unstable_rethrow so navigation still works.
 */
export async function asActionResult(
  run: () => Promise<void>,
  success?: string
): Promise<ActionResult> {
  try {
    await run();
    return { ok: true, message: success };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Something went wrong."
    };
  }
}
