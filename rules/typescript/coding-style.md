---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript Coding Style

> Extends [common/coding-style.md](../common/coding-style.md)

## Types and Interfaces

- Use `interface` for object shapes
- Use `type` for unions, mapped types
- Prefer string literal unions over `enum`
- Avoid `any`, use `unknown` + narrow

```typescript
interface User {
  id: string
  email: string
}

type UserRole = 'admin' | 'member'
type UserWithRole = User & { role: UserRole }
```

## React Props

- Define props with named interface
- Type callback props explicitly
- Do not use `React.FC`

```typescript
interface UserCardProps {
  user: User
  onSelect: (id: string) => void
}

function UserCard({ user, onSelect }: UserCardProps) {
  return <button onClick={() => onSelect(user.id)}>{user.email}</button>
}
```

## Immutability

Use spread operator for updates:

```typescript
function updateUser(user: Readonly<User>, name: string): User {
  return { ...user, name }
}
```

## Error Handling

Use async/await with try-catch:

```typescript
async function loadUser(id: string): Promise<User> {
  try {
    return await api.getUser(id)
  } catch (error: unknown) {
    if (error instanceof Error) throw new Error(error.message)
    throw new Error('Unexpected error')
  }
}
```

## Console.log

- No console.log in production
- Use proper logging libraries
