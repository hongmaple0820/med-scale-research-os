---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# TypeScript Security

> Extends [common/security.md](../common/security.md)

## Secret Management

```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"

// ALWAYS: Environment variables
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
```

## Input Validation

Use Zod for schema validation:

```typescript
import { z } from 'zod'

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

type UserInput = z.infer<typeof userSchema>
const validated = userSchema.parse(input)
```

## TypeScript-Specific

- Enable strict mode
- Use `unknown` not `any`
- Narrow types before use
- No type assertions unless necessary
