"""Provider connection plumbing for orchestration nodes.

- crypto: Fernet encrypt/decrypt of `provider_connections.config_encrypted`.
- provider_specs: per-provider plaintext config schema (with x-secret marks).
- resolver: per-run, tenant+app-scoped lookup that builds provider services.
- health: read-only "test connection" probes (one per provider).

Phase 10 commit 1 ships these without flipping node handlers off
`ctx.services.*`. Commit 2 wires the resolver into NodeContext.connections.
"""
