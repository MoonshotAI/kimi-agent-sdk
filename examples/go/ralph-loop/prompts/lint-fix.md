# Task: Fix Linting Errors

## Goal

Fix all linting errors reported by golangci-lint.

## Instructions

1. Run `golangci-lint run ./...` to see all linting errors
2. Focus on one error at a time
3. Fix the error with minimal changes
4. Re-run the linter to verify the fix
5. Continue until no errors remain

## Constraints

- Fix errors without changing intended behavior
- Keep changes minimal and focused
- If a lint rule seems incorrect for the codebase, note it but still fix it
- Ensure tests still pass after each fix
- Do not disable linters with nolint comments unless absolutely necessary
