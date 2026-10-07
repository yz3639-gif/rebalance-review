# Contributing

Use the Node version in `.nvmrc`, `npm ci`, and `npm start`. Add a focused regression when fixing financial correctness, privacy, archive compatibility or a previously untested user path. Run `npm run typecheck`, `npm test`, the relevant independent Python checks and affected browser tests before proposing a change.

Do not commit personal holdings, supplier keys, licensed price files, account screenshots or machine-local paths. Synthetic fixtures must be labeled; economic conclusions require separate evidence. Preserve the original fixtures and numerical tolerances rather than changing expected values to hide a failure.

Report the problem, expected behavior, reproduction steps, tested environment and any permitted synthetic sample. Separate implemented behavior, locally tested behavior, public deployment and actual-user evidence. Check the exact upstream license before copying code and update notices/SBOM when dependencies change.

Maintain clean-ZIP reproducibility with `scripts/verify_archive.py --full`. Review and merge are separate from publishing a public site or sending messages to anyone.
