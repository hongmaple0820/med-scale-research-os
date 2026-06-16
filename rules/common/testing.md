---
paths:
  - "**/*"
---
# Testing Requirements

## Minimum Coverage: 80%

Test Types (ALL required):
1. Unit Tests - Individual functions
2. Integration Tests - API/database
3. E2E Tests - Critical flows

## TDD Workflow

1. Write test first (RED)
2. Run test - must FAIL
3. Write minimal implementation (GREEN)
4. Run test - must PASS
5. Refactor (IMPROVE)

## Test Structure (AAA)

- Arrange: Set up test data
- Act: Execute the function
- Assert: Verify the result

## Test Naming

Use descriptive names:
- returns empty array when no matches
- throws error when input invalid
- falls back to default when unavailable

## Checklist

- [ ] Coverage >= 80%
- [ ] Edge cases covered
- [ ] Error paths tested
- [ ] No skipped tests
