# Rules

## Structure

Language-agnostic common rules + language-specific extensions.

```
rules/
├── common/         # Universal principles
├── typescript/     # TS/JS specific, extends common
├── python/         # Python specific
├── web/            # Frontend specific
```

## Priority

Language-specific rules override common rules where they conflict.

## Usage

Rules are loaded by file path matching:
- TypeScript files → common/*.md + typescript/*.md
- Python files → common/*.md + python/*.md

## Installation

```bash
cp -r rules/common ~/.claude/rules/common
cp -r rules/typescript ~/.claude/rules/typescript
```
