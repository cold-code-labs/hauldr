# Contributing to Hauldr

Thanks for your interest in Hauldr. It's developed in the open and contributions
are welcome.

> **Status: pre-alpha.** The architecture is settled but the implementation is
> early and moving fast. Before investing in a large change, please open an issue
> to discuss it — the surface may shift under you otherwise.

## Ways to contribute

- **Report bugs** and unexpected behavior via issues.
- **Propose features or design changes** by opening an issue first — especially
  anything touching the architecture (auth, RLS, the pooler, tenancy).
- **Improve documentation.** Docs live in [`docs/`](docs/) and are maintained in
  English.
- **Submit code** via pull requests, ideally tied to an existing issue.

## Before you start a big change

The foundational decisions are recorded in [`docs/`](docs/) and the
[roadmap](docs/roadmap.md). A few are deliberate and unlikely to change:

- Auth is GoTrue, one per project, always.
- Row-level security is always on.
- Schema is SQL-first; the typed layer sits on top.
- Heavy things are shared; light things are per-project and optional.

If a contribution argues against one of these, that's a discussion to have in an
issue before any code.

## Pull request guidelines

- Keep PRs focused — one logical change per PR.
- Match the style and structure of the surrounding code.
- Update the relevant docs in the same PR when behavior changes.
- Write a clear description: what changed, why, and how you verified it.
- Link the issue the PR addresses.

## Code of conduct

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE), the same license as the project.
