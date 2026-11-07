sample-erp, native build (no Docker)

Run sample-erp.exe. The first launch downloads a portable Postgres 17 (about 100 MB) into data/,
creates the database and opens http://localhost:8080. Ctrl+C stops everything.

  sample-erp.exe promote you@example.com    make an account SU (sign up in the web app first)

  services/      importer.exe, api.exe, billing/ (a trimmed Java runtime + billing.jar)
  config/        copy a *.env.example to *.env to set ports, API secrets or Stripe keys
  data/          the database and generated secrets; delete it to start over

Everything is on one port, 8080: the web app, /api and /billing. Only 127.0.0.1 is listened on, so
nothing is reachable from other machines (see ERP_BIND in config/launcher.env.example).
Built with `cargo xtask dist` from launcher/ in the repository; see launcher/README.md.
