# Test behavior, not implementation

**Apply when:** writing, changing, reviewing, or deciding whether to keep a test.

A test calls the code the way its users do and asserts what they observe against a literal expected value.

**The check:** would the test still pass if every function it imports returned `undefined`? Then it can't fail for a defect. Rewrite the assertion or delete the test.

Five hollow shapes:

1. **Weak or no assertion:** `toBeDefined`, `toBeTruthy`, `not.toThrow`, `toBeInstanceOf`, `toBeGreaterThan(0)`.
2. **Mock or absence only:** `toHaveBeenCalled`, `toBeUndefined`, `toEqual([])`, `toHaveLength(0)`.
3. **Self-referential:** the expected value comes from the code under test, as in `expect(f(a)).toBe(f(a))`.
4. **Constant pin:** the assertion restates a hand-maintained constant, default, or prompt string. It catches nothing and blocks the next legitimate edit.
5. **Fixture asserts fixture:** the subject never runs inside the test body.

**The fix:** call the subject with one concrete input and assert the literal output or the observable effect, as in `expect(slugify("Hello, World!")).toBe("hello-world")`. For an absence, assert the presence on the other input in the same test. For a mock, assert the payload it received or the state afterwards, not that it was called. Don't mock what you can run.

**Which tests to write.** The repo's manual sets its test policy. Without one, the default is lean: unit tests on shared, low-level utilities where a bug would corrupt everything downstream, plus a regression test for a fixed bug when a cheap local test path exists. No integration or end-to-end suites unless the repo asks for them.

**Keep** tests of a relation across rows of a table and compile-time type tests. The same bar applies in Swift Testing (`#expect`, `#require`) and XCTest. Tests exist to catch real regressions. Coverage for its own sake gets deleted.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-test-behavior-not-implementation` (MIT, Copyright (c) 2026 Lauren Tan).
