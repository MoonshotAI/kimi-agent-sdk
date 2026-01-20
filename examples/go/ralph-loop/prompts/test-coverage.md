# Task: Improve Test Coverage

## Goal

Increase test coverage to at least 80%.

## Instructions

1. Run `go test -coverprofile=coverage.out ./...` to generate coverage report
2. Analyze coverage with `go tool cover -func=coverage.out` to find uncovered code
3. Identify the most impactful uncovered code paths
4. Write meaningful tests to cover them
5. Run tests to ensure they pass
6. Repeat until coverage goal is reached

## Constraints

- Each test must pass before proceeding
- Do not modify production code just to increase coverage
- Focus on meaningful test cases that validate actual behavior
- Prioritize testing critical code paths over trivial getters/setters
- Write table-driven tests where appropriate for better coverage
