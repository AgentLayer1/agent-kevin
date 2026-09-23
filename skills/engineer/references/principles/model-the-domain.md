# Model the domain

**Apply when:** writing stateful logic, or code that branches a lot or repeats a shape assumption across files.

Encode the domain in a structure instead of scattering it through conditionals. Choosing the structure at write time is cheap. Recovering it later reads as a refactor and gets deferred.

Reach for:

- a state machine instead of scattered booleans, phases, or lifecycle checks;
- a typed model instead of loose parameters or repeated shape assumptions;
- a map, registry, lookup table, or discriminated union instead of branching spread across files;
- a reducer or command/event model instead of ad hoc mutation;
- a module organized around one body of domain knowledge, not around a load, validate, transform, save sequence (execution order is not ownership);
- the collection the access pattern calls for: a queue, cache, index, graph, or normalized table.

When none fits, write down what the code must never allow and how the data is read, then find the structure that encodes exactly that.

Don't force it. Boring code stays when the shape is already clear, local, and unlikely to grow. Distrust an abstraction that adds indirection without deleting branches, duplicated rules, invalid states, or lifecycle risk.

**Signs you skipped this:** a feature grows an if/else chain by one more branch, a second boolean has to stay in sync with the first, or phase-named modules repeat the same rules.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-model-the-domain` (MIT, Copyright (c) 2026 Lauren Tan).
