# Private Initial Credentials Design

## Goal

Keep the approved initial usernames and passwords unchanged while making the public GitHub repository safe to publish. No plaintext initial password may appear in tracked source, README content, migrations, client bundles, or build-time metadata.

## Chosen approach

Store one secret JSON map in the Sites production environment under `INITIAL_ACCOUNT_PASSWORDS`. The map is keyed by initial username and holds the existing password for each of the eight bootstrap accounts.

This is preferred over a shared password because it preserves the approved per-account credentials, and over first-run random generation because it does not introduce a credential-recovery or one-time-display workflow.

## Runtime behavior

- Initial account definitions retain only non-secret identity fields: ID, display name, username, role, and team.
- When the account table is empty, bootstrap reads `INITIAL_ACCOUNT_PASSWORDS`, parses the JSON, and requires one valid 8–64 character password for every initial username.
- Missing, malformed, incomplete, or invalid secret configuration fails closed before any account is inserted.
- When the account table already contains data, bootstrap returns immediately and does not require or apply the secret. Existing passwords and administrator changes therefore remain untouched.
- Passwords continue to be hashed with the existing PBKDF2 settings before D1 insertion.

## Public repository and documentation

- README lists initial usernames and explains that passwords are distributed privately by the administrator; it does not show password values.
- Tracked source contains only the environment variable name and validation logic.
- Regression checks scan public-facing source, README, and migrations for the approved initial password values.

## Error handling

Runtime errors identify only that initial credential configuration is missing or invalid. They never include the environment value, a username-password pair, or parsed password content.

## Testing

- A bootstrap test proves accounts are seeded from an injected secret map and stored only as hashes.
- A bootstrap test proves missing or incomplete secrets fail before insertion.
- A bootstrap test proves an existing database skips secret parsing and remains unchanged.
- Render/source regression tests prove plaintext initial passwords are absent from README, bootstrap source, client code, and migrations.
- The complete unit, type, lint, build, and rendered-page suites run before publication.

## Rollout

1. Save the unchanged approved credential map as a secret Sites environment value.
2. Deploy the validated version so the new environment revision and bootstrap logic take effect together.
3. Initialize the empty public GitHub repository and publish the exact validated `main` snapshot.
4. Existing D1 account rows are preserved. If the table is still empty, the first authenticated API request seeds accounts from the private environment value.
