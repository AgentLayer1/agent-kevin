---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript Rules

- Strict null checks. Never use `!` to suppress them.
- `unknown` over `any` when type is genuinely unknown.
- Discriminated unions over optional fields for state modeling.
- Use `satisfies` for type-checked object literals without widening.
- Prefer `const` assertions for literal types.

## References

- [TypeScript Best Practices](https://github.com/andredesousa/typescript-best-practices)
