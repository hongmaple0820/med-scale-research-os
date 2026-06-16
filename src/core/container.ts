// SCALE Engine — Dependency Injection
// 极简 DI：避免循环依赖，方便测试时替换实现

export type Token<T> = symbol & { __type__?: T }

export function createToken<T>(name: string): Token<T> {
  return Symbol(name) as Token<T>
}

export class Container {
  private instances = new Map<symbol, unknown>()
  private factories = new Map<symbol, () => unknown>()

  register<T>(token: Token<T>, factory: () => T): void {
    this.factories.set(token, factory)
  }

  registerInstance<T>(token: Token<T>, instance: T): void {
    this.instances.set(token, instance)
  }

  resolve<T>(token: Token<T>): T {
    if (this.instances.has(token)) return this.instances.get(token) as T
    const factory = this.factories.get(token)
    if (!factory) throw new Error(`No registration for token: ${token.toString()}`)
    const instance = factory() as T
    this.instances.set(token, instance)
    return instance
  }

  has(token: symbol): boolean {
    return this.instances.has(token) || this.factories.has(token)
  }

  reset(): void {
    this.instances.clear()
  }
}

export const container = new Container()
