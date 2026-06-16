---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# TypeScript Testing

> Extends [common/testing.md](../common/testing.md)

## Framework

Use Vitest or Jest for unit tests.

## Test Structure

```typescript
describe('UserService', () => {
  describe('getUser', () => {
    it('returns user when found', async () => {
      // Arrange
      const mockApi = { getUser: vi.fn().mockResolvedValue({ id: '1', name: 'Test' }) }
      
      // Act
      const result = await service.getUser('1')
      
      // Assert
      expect(result).toEqual({ id: '1', name: 'Test' })
    })

    it('throws when not found', async () => {
      // Arrange
      const mockApi = { getUser: vi.fn().mockRejectedValue(new Error('Not found')) }
      
      // Act & Assert
      await expect(service.getUser('999')).rejects.toThrow('Not found')
    })
  })
})
```

## E2E Testing

Use Playwright for critical flows.

## Type Safety

- No `any` in tests
- Mock with typed interfaces
- Use `vi.fn<T>()` for typed mocks
