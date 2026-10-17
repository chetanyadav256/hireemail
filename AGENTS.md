# Repository instructions

## Current scope

Planning is complete. The initial project setup is authorized in `client/` and `server/`, preserving the architecture's internal structure. Implement only the user-requested milestone; do not start authentication, uploads, AI, OAuth, or sending until requested. A later implementation request authorizes the requested milestone without an additional approval ceremony.

Read README.md, ARCHITECTURE.md, and PLAN.md before making changes. Keep contracts and documentation consistent with the final behavior. Explain material departures from the agreed architecture.

## Implementation conventions

- Use JavaScript/JSX and ES modules throughout; use JSDoc where types clarify a contract.
- Keep feature modules small. Routes validate and delegate; services enforce business rules; repositories own persistence; adapters wrap providers.
- Use shared request/response schemas, but always enforce validation on the server. Never accept client-controlled ownership, status, approval hashes, or storage keys.
- Scope every resource lookup and referenced object to the authenticated user. Return 404 for inaccessible resources.
- Use explicit field allowlists, stable error codes, optimistic concurrency, and bounded pagination.
- Keep secrets in server environment variables or secret-manager injection. Vite variables are public. Never commit credentials, uploads, real resumes, or real contact fixtures.

## Non-negotiable behavior

- No external outreach without explicit approval of the exact email version and a subsequent send request. Generation, imports, OAuth consent, and queue retries cannot supply approval.
- Revalidate approval, account identity, attachment integrity, suppression, duplicate controls, and quotas immediately before dispatch.
- Use one recipient and one approved PDF per send. Do not add CC/BCC, follow-up automation, tracking pixels, or inbox-reading scopes without an explicit scope change.
- Preserve immutable send snapshots and audit metadata. Never automatically resend an uncertain Gmail submission; do not claim exactly-once external delivery.
- Resume content and imported data are untrusted input. The LLM has no tools or send capability. Never invent qualifications, experience, achievements, or company facts.
- Enforce limits in shared durable storage; process-local counters and queue job IDs alone are insufficient.
- Never log tokens, passwords, raw resumes, contact lists, or complete email bodies.

## Verification and delivery

- Work in small milestones. Run checks relevant to the changes; report what ran and any remaining limits.
- Test ownership boundaries, malformed uploads, approval invalidation, concurrent send requests, and provider ambiguity when those paths change.
- Use synthetic fixtures and fake providers by default. Tests and CI must not send real outreach. Live smoke tests require an explicitly authorized test recipient and the normal review/approval flow.
- Apply production indexes through reviewed migrations; do not rely on Mongoose auto-indexing in production.
- Preserve user changes. Avoid unrelated refactors, speculative infrastructure, or unnecessary dependencies.
- Report implemented behavior, validation evidence, and known gaps without claiming production readiness before the release gates pass.
