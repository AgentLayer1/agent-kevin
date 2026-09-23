---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript Rules

The TypeScript form of the `engineer` skill's type system and boundary principles.

## Types

- Strict null checks. Never use `!` to suppress them. When a loose type forces `!`, `arr[0] as T`, or a "should never happen" throw, strengthen the input (`type NonEmpty<T> = [T, ...T[]]`) or return `T | undefined`.
- `unknown` over `any`. External data (`JSON.parse`, fetch bodies, `postMessage`, env, files, DB rows) is `unknown` until parsed.
- Discriminated unions over optional-field bags for state: `{ kind: 'loading' } | { kind: 'ready'; diff: Diff } | { kind: 'error'; message: string }`. One discriminant name per codebase.
- `interface` for object contracts. `type` for unions, tuples, and mapped types.
- Const objects over enums: `const Status = { Open: 'open', Done: 'done' } as const` with `type Status = (typeof Status)[keyof typeof Status]`.
- Brand primitives that must not swap: `type UserId = string & { readonly __brand: 'UserId' }`, minted by one parse function.
- Build types from legal parts: `[T, ...T[]]` for non-empty, `[T, T][]` for pairs, a start plus `durationMs` for a range. Keep plain `T[]` while every operation on it stays total.
- Derive before declaring: `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, `typeof`, and generated schema types come before a new hand-written interface.

## Narrowing and casts

- `satisfies` over `as` for literals, so the value is checked without widening. `as const` for literal types.
- Narrow in this order: a discriminant switch, `in`, `typeof` or `instanceof`, a user-defined guard, and `as` last, only after validation. A guard must verify what it claims; name it `isX` or `hasX`.
- Parse at the boundary with the schema library the repo already uses (`z.infer<typeof Schema>`, `safeParse` when failure is an expected branch). Don't add a schema dependency for one guard, and don't keep a schema, an interface, and a guard that can drift apart.
- Exhaustive switches end in `default: { const unhandled: never = shape; return unhandled; }`, so a new variant fails the build.

## Calls and runtime

- Object arguments over positional ones when two parameters share a type or there are more than two. Skip it on hot paths (render loops, parsers).
- Diagnostics go through the repo's structured logger with enough context to debug from an id. `console.log` is for CLI output, not diagnostics.
- Don't mock what you can run. Prefer the framework's real test primitives.

## References

- [TypeScript Best Practices](https://github.com/andredesousa/typescript-best-practices)
- Types, narrowing, and boundary rules adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack)'s `typescript-best-practices` (MIT, Copyright (c) 2026 Lauren Tan).
