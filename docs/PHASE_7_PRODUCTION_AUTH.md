# Phase 7 Production Auth

Updated: 2026-06-16

## Goal

Replace demo session selection with real authenticated sessions, workspace membership, and role-scoped access.

## Implemented

- First-party login with hashed passwords.
- Signed `syncore_auth_session` cookie.
- Server-side session records with expiry and revocation.
- Logout flow that revokes the active session.
- Middleware protection for app pages and API routes.
- Public auth routes for login, invites, and password reset.
- User invites with hashed invite tokens and role assignment.
- Email verification state through invite acceptance.
- Password reset tokens with session revocation after reset.
- Developer-only user access page at `/access`.
- Role updates for workspace members.
- User deactivation with active-session revocation.
- Superadmin flag on auth accounts.
- Prisma models and normalized projection coverage for auth accounts, sessions, invites, and reset tokens.
- CI and test coverage for auth primitives and access workflows.

## Seeded Local Login

Seeded users are created with active auth accounts.

Default local password:

```text
Syncore!2026
```

Default owner/developer login:

```text
nora@syncore.tech
```

Other seeded users:

```text
ari@syncore.tech
mina@syncore.tech
leo@syncore.tech
rhea@syncore.tech
```

## Production Env

Required:

```bash
SYNCORE_AUTH_SECRET="strong-random-secret"
SYNCORE_STORAGE_DRIVER="prisma"
DATABASE_URL="postgresql://..."
```

Do not use these in production:

```bash
SYNCORE_SESSION_USER_ID
SYNCORE_SESSION_WORKSPACE_ID
syncore_user_id
syncore_workspace_id
```

Legacy demo session cookies are only honored when:

```bash
SYNCORE_ALLOW_DEMO_SESSION=true
```

Keep that disabled for production.

## Current Limitations

- Email delivery is still local/manual. Invite and reset links are generated in the app for now; later production email should use Amazon SES.
- MFA is modeled as an account flag but not enforced yet.
- SSO/SAML is not connected yet. Clerk or Auth0 can be added later if enterprise login is required.
- Tenant isolation hardening continues in Phase 8.

## Done Criteria Status

Production runtime no longer depends on demo env session selectors or demo user/workspace cookies. Access requires a signed auth session, backed by server-side auth records and workspace membership.
