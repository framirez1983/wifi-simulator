# wifi-simulator fork — Development Rules

This repository is a conservative fork of:
https://github.com/nevva/wifi-simulator

The primary goal is:

"Same RF simulation, much better usability."

## General principles

- Keep the project simple.
- Preserve the existing vanilla HTML/CSS/JavaScript architecture.
- Do not introduce React, Vue, Angular, a backend, database, authentication system, build framework, or large dependencies unless explicitly requested.
- Prefer small, localized, reviewable changes.
- Do not perform broad refactors unless explicitly requested.
- One feature or narrowly scoped change at a time.

## RF engine protection

Do NOT modify RF calculations unless explicitly instructed.

This includes, but is not limited to:

- path loss formulas
- RSSI calculations
- SINR calculations
- ray tracing
- RF geometry
- material losses
- inter-floor losses
- auto-channel logic
- auto-placement logic
- 3D RF representation

Do not "improve", optimize, rewrite, correct, or modernize RF formulas on your own initiative.

For the same scene and RF parameters, UI-only changes must preserve the same RF result.

## Existing project compatibility

Existing saved projects must continue to load correctly.

- New fields must be optional whenever possible.
- Missing new fields must use backward-compatible defaults.
- Never silently change RF parameters in old projects.
- Existing APs without a preset identifier must behave as Generic / Custom while preserving their exact existing parameters.
- User-provided names and values are data and must not be translated or modified automatically.

## Internationalization

The application will support:

- Spanish (default)
- English
- Swedish

All new visible UI text must use the i18n system once that system exists.

Do not translate universal technical terms or units such as:

- RSSI
- SINR
- GHz
- dBm
- Ray tracing

Do not replace Swedish strings directly with Spanish. Visible application text should ultimately come from the centralized i18n structure.

## Access Point presets

AP presets are configuration helpers, not RF engine changes.

- Presets may populate existing AP controls.
- Users must remain free to modify populated values manually.
- Do not hardcode UniFi-specific behavior into RF calculations.
- Keep the preset structure extensible for additional manufacturers and models.

## Background floor plan

The application already supports floor-plan images and wall detection.

Do not introduce:

- OCR
- AI image analysis
- perspective correction
- image editing features

Changes should focus only on usability around the existing background-plan functionality.

## Working procedure

Before modifying code:

1. Inspect the relevant existing implementation.
2. Identify the smallest set of functions/sections that need modification.
3. Explain the intended changes before making broad structural changes.

After modifying code:

1. Review the diff.
2. Keep unrelated formatting changes out of the patch.
3. Verify that Docker can still build and start the application.
4. Summarize exactly what changed.
5. Mention any compatibility implications.

## Deployment environment

The working repository is:

/opt/wifi-simulator

Docker serves this same repository.

Do not edit files inside the running Docker container.
The Git working tree is the source of truth.

The local docker-compose.override.yml is specific to this LXC and intentionally excluded from Git.

## Git discipline

- Never force-push main.
- Never use destructive Git commands unless explicitly requested.
- Do not rewrite existing history.
- Prefer feature branches for functional changes.
- Keep commits small and focused.
- Never commit secrets, SSH keys, credentials, tokens, backups, or environment-specific private data.
