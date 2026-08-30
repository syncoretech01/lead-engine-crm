/**
 * One fetch bound for the three read models that list the same book.
 *
 * The contacts directory, the assigned-contacts cockpit and the SDR queue all
 * page their rows CLIENT-side, so each one fetches a bounded slice and hands the
 * whole thing to the browser. Three separate numbers meant a contact could be
 * visible in one surface and missing from another, and the queue's headline
 * metrics (Assigned / P1 / Overdue) are derived from its slice — so a smaller
 * bound there under-counts the very numbers a manager steers by.
 *
 * The ceiling is MEMORY, not the database. Every row is fetched, mapped, and
 * serialized into the RSC payload, and a /crm/contacts render pulls both the
 * contact list and the assigned book. Measured retained heap at 25,000 rows was
 * ~592 MB across the four object graphs, on a 1.8 GB instance whose web process
 * already sits near 800 MB after an import — an OOM, which is a worse failure
 * than the truncation the bound causes.
 *
 * 5,000 is ~2.4x the live workspace (2,116 contacts) at roughly 120 MB worst
 * case. Raising it further needs a smaller per-row payload or real server-side
 * pagination — which means making the shared DataTable controlled across the six
 * tables that use it — not a bigger number. Every model that uses this bound
 * reports `truncated` so hitting it is never silent.
 */
export const DIRECTORY_FETCH_LIMIT = 5_000;
