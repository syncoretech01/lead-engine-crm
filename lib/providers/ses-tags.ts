/**
 * SES message tag stamped on every send with the sending workspace id so
 * inbound bounce/complaint notifications can be attributed to the correct
 * tenant instead of matched by email across all workspaces (P2.1).
 *
 * Kept dependency-free (no AWS SDK import) so both the send adapter and the
 * inbound event parser can share it without pulling the SDK into the parser.
 */
export const SES_WORKSPACE_TAG_NAME = "syncore_workspace_id";
