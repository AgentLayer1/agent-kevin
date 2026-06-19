---
paths:
  - "**/*.swift"
---

# Swift Rules

- Use value types (`struct`, `enum`) over `class` unless reference semantics are needed.
- Prefer `let` over `var`. Immutability by default.
- Use Swift concurrency (`async`/`await`, `Actor`) over GCD and completion handlers.
- Leverage `Codable` for serialization. Avoid manual JSON parsing.
- Use `Result` and typed throws over optional error returns.
- Prefer protocol-oriented design over deep class hierarchies.
- Use `@Observable` macro (Observation framework) over `ObservableObject`/`@Published` for new code.
- Guard clauses (`guard let`) for early exits over nested `if let`.
- No force unwraps (`!`) unless the value is guaranteed at compile time (e.g., static URLs).
- No `Any` or `AnyObject` without justification.

## References

- [Swift Skills & Best Practices](https://github.com/Dimillian/Skills)
