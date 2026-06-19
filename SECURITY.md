# Security Policy

## Status

Hauldr is **pre-alpha** and not yet recommended for production use. It is shared
publicly for development and review.

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting on this repository:

- Go to the **Security** tab → **Report a vulnerability**.

This opens a private channel with the maintainers. Please include:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept), and
- any affected versions or configurations you're aware of.

We'll acknowledge the report, investigate, and coordinate a fix and disclosure
timeline with you.

## Scope

Because Hauldr is self-hosted, its security posture depends heavily on
deployment. Reports are most useful when they concern Hauldr's own code and
defaults — for example:

- the management API and its authentication,
- claim injection and row-level-security handling,
- per-project isolation in the shared data plane,
- key and token handling.

Misconfiguration of a self-hosted deployment, or vulnerabilities in the upstream
components Hauldr assembles, should be reported to the relevant project — though
we're happy to help triage if you're unsure.
