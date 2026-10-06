# Project Lessons

Verified repository-specific obstacles and resolutions for future maintainers and Codex tasks. Read only entries relevant to the current task.

## PL-20260825-sub2api-dual-quota-windows — Preserve both 5h and 7d quota windows

- Status: verified
- Scope: Local Codex rate-limit normalization, Sub2API account usage, relay aggregation, and renderer mode selection
- Last verified: 2026-08-25
- Trigger: Add or diagnose 5-hour quota display while Sub2API `v0.1.163-personal` is serving OpenAI OAuth account usage.
- Symptom: Sub2API account management displays independent `5h` and `7d` percentages, while the widget labels a single selected value as 7 days and relay normalization reads only `usage.seven_day`.
- Root cause: `normalizeSnapshot` collapsed `primary`/`secondary` into one active window, and `normalizeAccountQuota` discarded `usage.five_hour`; a stale source comment incorrectly asserted that the 5-hour window had been removed.
- Do not repeat: Do not infer window identity from `primary` versus `secondary` alone, do not clear the normalized window objects, and do not treat a single unknown-duration window as both 5h and 7d.
- Resolution: Classify local Codex windows primarily by `windowDurationMins` (`300` for 5h and `10080` for 7d), preserve both normalized windows, map Sub2API `five_hour` and `seven_day` separately, and pass an explicit `5h`/`7d` selection into relay aggregation.
- Verification: The local Sub2API account page visibly showed separate 5h and 7d readings for all four accounts; `npm test` passed 19 tests including dual-window separation, single-window non-invention, and aggregation of all relay-account 5h balances.
- Applicability: Use for quota ingestion, caching, aggregation, UI labels, and tests whenever either local Codex or Sub2API exposes multiple rate-limit windows.
- Invalidate when: The upstream API removes or renames these windows, or reports authoritative window identifiers that replace duration-based classification.
- Related paths: `src/main/quota-service.js`, `src/main/sub2api-service.js`, `src/main/main.js`, `src/renderer/renderer.js`, `test/quota-service.test.js`, `test/sub2api-service.test.js`

## PL-20260812-dist-exe-lock — Stop the exact unpacked widget before rebuilding

- Status: verified
- Scope: Windows `electron-builder --dir` validation for this repository
- Last verified: 2026-08-12
- Trigger: Run `npm run build:dir` while `dist/win-unpacked/ChatGPT Quota Widget.exe` cannot be removed.
- Symptom: `remove ...\dist\win-unpacked\ChatGPT Quota Widget.exe: Access is denied.`
- Root cause: A running unpacked widget process holds the existing executable. A process-name wildcard check missed it during one probe; matching `Win32_Process.ExecutablePath` against the resolved executable path identified the main, GPU, utility, and renderer processes.
- Do not repeat: Do not repeatedly rerun the build, treat the failure as a source compilation error, or rely only on a process-name wildcard. `npm exec -- electron-builder --config.directories.output=...` also did not forward the output override in this environment.
- Resolution: Resolve `dist/win-unpacked/ChatGPT Quota Widget.exe`, stop only processes whose `ExecutablePath` exactly equals that path, confirm none remain, and rerun `npm run build:dir`. For non-destructive verification while the old app must remain open, invoke the installed CLI directly with `node .\node_modules\electron-builder\out\cli\cli.js --dir "-c.directories.output=<temporary-output>"`.
- Verification: After stopping the exact-path process tree, `npm run build:dir` packaged successfully to `dist\win-unpacked`; the alternate-output direct CLI also exited with code 0.
- Applicability: Use this to verify packaging when the old unpacked executable is locked or protected and replacing existing artifacts is not part of the task.
- Invalidate when: The repository build script uses unique/versioned output directories or the existing `dist` executable can be deterministically removed after its owning process is identified.
- Related paths: `package.json`, `dist/win-unpacked/`
