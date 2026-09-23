# Type system discipline

**Apply when:** designing types or a signature in any typed language. The repo's language rules (`.claude/rules/typescript.md`, `swift.md`) carry the syntax. This is the language-neutral rule.

The type checker is a proof assistant. A case the types let you ignore becomes a runtime failure the compiler could have stopped.

- **Make illegal states unrepresentable.** Model variants as sum types (discriminated unions, enums with payloads, sealed classes), not as a bag of optional fields. `{ completed: boolean; completedAt?: Date }` admits nonsense. `{ kind: 'open' } | { kind: 'done'; at: Date }` doesn't.
- **Build the type from legal parts.** A non-empty list is a head plus a rest. A valid time range is a start plus a duration.
- **Brand semantic primitives.** `UserId` and `OrderId` are both strings but must not swap. Validate once at creation and trust the type downstream.
- **External data is untyped until parsed.** JSON, RPC and IPC payloads, env vars, CLI args, config files, and database rows each get one parse function at the boundary that returns the domain type ([boundary discipline](boundary-discipline.md)).
- **Don't lie to the compiler.** Casts, force unwraps, and asserting helpers are latent crashes. Prove the fact (validate, narrow, refine the model) or treat the cast as a named hazard.
- **Exhaustiveness is the compiler's job.** Adding a variant must fail the build at every match that forgot it.
- **Derive from the authoritative schema.** When OpenAPI, protobuf, GraphQL, a migration, or a runtime schema defines the shape, derive the type from it instead of hand-rolling a parallel one.
- **Strengthen only where partiality shows up.** A `!`, a "should never happen" throw, or a defensive null check marks a type that is too weak. Push that fact into the type, then stop. `sum` takes a plain list. `first` of a list you promised is non-empty takes the non-empty type.

**The tests:**

- Could you write a comment explaining when this combination of fields is valid? Split it into a sum type.
- Do two arguments share a primitive but mean different things? Brand them.
- Where did this cast or force unwrap come from? Trace it to the boundary and parse there.
- If a variant is added next month, will the compiler show the next agent every place to handle it?

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-type-system-discipline` (MIT, Copyright (c) 2026 Lauren Tan).
