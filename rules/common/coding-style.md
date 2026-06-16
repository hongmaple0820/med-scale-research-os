---
paths:
  - "**/*"
---
# Common Coding Style

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate existing ones.

## File Organization

MANY SMALL FILES > FEW LARGE FILES:
- 200-400 lines typical, 800 max
- Extract utilities from large modules
- Organize by feature/domain, not by type

## Error Handling

ALWAYS handle errors comprehensively:
- Handle errors explicitly at every level
- Provide user-friendly messages in UI
- Log detailed context on server
- Never silently swallow errors

## Input Validation

ALWAYS validate at system boundaries:
- Validate all user input before processing
- Fail fast with clear error messages
- Never trust external data

## Naming Conventions

- Variables/functions: camelCase
- Booleans: is, has, should, can prefixes
- Interfaces/types/components: PascalCase
- Constants: UPPER_SNAKE_CASE

## Code Smells

- Deep nesting (>4 levels) - use early returns
- Magic numbers - use named constants
- Long functions (>50 lines) - split

## Checklist

- [ ] Functions small (<50 lines)
- [ ] Files focused (<800 lines)
- [ ] No deep nesting
- [ ] Proper error handling
- [ ] No hardcoded values
