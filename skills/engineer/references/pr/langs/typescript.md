# TypeScript and JavaScript addendum

For `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, and `.cjs` files. It names the language-level forms of defects the lanes describe in general terms. The repo's own conventions still decide style: a type rule below is a finding only when the repo's `AGENTS.md`, lint config, or neighboring code adopts it.

## Missing values and control flow

- Optional chaining (`a?.b.save()`) that silently skips a write or a side effect a caller relies on.
- `??` or `||` defaults that mask a required field; `||` that replaces a legitimate `0`, `''`, or `false`.
- A `switch` over a union or enum with no exhaustive check (`satisfies never` or an assertion), so a new member falls through silently.
- An ORM query whose `select` or `include` was narrowed so a field a downstream read needs is no longer loaded.

## Async

- A promise neither awaited nor returned (`void`-less fire-and-forget), including inside `forEach`, which never awaits its callback.
- `Promise.all` where one rejection should not abandon the rest (`Promise.allSettled`), or where an unbounded list needs a concurrency limit.
- An `async` function passed where the caller expects a synchronous callback (event emitters, array methods, middleware without `next` handling), so its rejection is unhandled.
- `await` inside a loop over independent items where the latency is user-visible.

## Types and escape hatches

- `any`, a non-null assertion (`!`), or an `as` cast that hides a modeling error instead of narrowing; `@ts-ignore` or `@ts-expect-error` without a reason.
- A string or number where a literal union or a const object (`const X = { A: 'a' } as const`) names the closed set.
- Boolean flags that must stay in sync where a discriminated union makes illegal states unrepresentable.
- `JSON.parse` or a network response typed by assertion rather than validated at the boundary.

## Objects and equality

- `in` or bracket lookup on a plain object used as a map: it walks the prototype chain, so `'toString'` or `'constructor'` passes. Use `Object.hasOwn` or a `Map`.
- Spreading or `Object.assign` from request input into a model (prototype pollution, mass assignment).
- `==` with mixed types; `NaN` comparisons; floating point for money.
- Mutating a parameter, a shared constant, or React state in place.

## Requests and validation

- A request DTO field without a validation decorator or schema entry, an `any`-typed body, or a validation pipe configured without `whitelist`/`forbidNonWhitelisted` where the repo uses them.
- A route handler that returns an ORM entity directly, leaking internal columns.

## Tests

- Weak matchers that pass on almost anything: `toBeDefined`, `toBeTruthy`, `not.toThrow`, `toHaveBeenCalled` with no argument check, `toEqual([])` as the only assertion.
- `jest.mock` or `vi.mock` of the module under test; a mock typed `as any` so it no longer follows the real interface.
- `.skip`, `.only`, or `it.todo` committed.

## Packages and builds

- A `postinstall` script, an `onlyBuiltDependencies` / `allowBuilds` change, or a new package added for one call.
- A server-only import (`fs`, a database client, secrets) pulled into a module bundled for the browser.
- A barrel re-export file added where the repo imports from the owning module.

## React and the browser

- An effect with missing or over-broad dependencies, or one that sets state it also depends on.
- A list keyed on index or an unstable value, so rows reuse the wrong state.
- `dangerouslySetInnerHTML` or `innerHTML` with content from a payload or user.
