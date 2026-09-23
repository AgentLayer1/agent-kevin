# Encode lessons in structure

**Apply when:** you catch yourself writing the same instruction twice, a correction recurs, or a review finding is the second of its kind.

Text is easy to miss. It needs the reader to notice, remember, and comply. A mechanism enforces the rule without anyone's cooperation.

Pick the strongest mechanism the situation allows, in this order:

1. A state that can't be represented, so the wrong thing doesn't compile.
2. A lint rule, test, or banned API that fails CI.
3. A canonical helper that the right way goes through.
4. A runtime check or a hook.
5. Text, made prominent, with an example of the failure. Use this only when the rule needs judgment.

Agents copy whatever the surrounding code already does, so a weaker guard becomes the next template. When the fix is structural, delete the instruction. The instruction was the symptom.

**Close the loop.** Route a one-off correction to feedback capture, a recurring fix to a test, lint, or skill, and a systemic one to the manual. Recording without routing doesn't persist, and neither does "noted going forward" without a write in the same turn.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-encode-lessons-in-structure` (MIT, Copyright (c) 2026 Lauren Tan).
