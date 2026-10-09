# Chorus

A collaborative text editor for exploring an RGA sequence CRDT, with a network simulator and a view of pending operations and replica state.

**Live room** synchronizes tabs in the same browser through BroadcastChannel. **Split lab** runs two replicas on one page, where you can delay delivery, drop packets, and temporarily partition the simulated network. Cross-device collaboration is not implemented.

## Try it locally

```bash
npm ci
npm run dev
```

- In **Live room**, open the same room URL in two tabs on the same origin. Edit in either tab to see text and cursor updates.
- In **Split lab**, enable **Partition** and edit both panes. Select **Heal** to deliver queued operations and inspect whether the replicas agree.
- Adjust latency from 0 to 3,000 ms or increase packet loss. The operation timeline and pending-operation count show what is still in transit or waiting on a dependency.
- Use the stress control to generate concurrent edits. The convergence badge compares visible text and version vectors and checks that no operations remain buffered.

## Implementation

The editor uses [CodeMirror](https://codemirror.net/). The CRDT and synchronization code live in this repository:

| Component | What it does |
| --- | --- |
| [RgaDoc](src/crdt/doc.ts) | Stores characters in a doubly linked list, retains deleted characters as tombstones, and buffers operations whose dependencies have not arrived. |
| [Item IDs](src/crdt/id.ts) and [operations](src/crdt/ops.ts) | Identify characters by site and Lamport counter. A separate per-site sequence number orders operations for delivery and version tracking. |
| [Version vectors](src/crdt/version-vector.ts) and [replicas](src/session/replica.ts) | Track received operations and exchange missing operations during synchronization. |
| [Broadcast transport](src/transport/broadcast.ts) | Connects tabs that join the same room using BroadcastChannel. |
| [Editor binding](src/editor/binding.ts) | Applies CRDT changes to CodeMirror and maps editor positions to character IDs. |
| [Simulated network](src/sim/network.ts) | Models latency, jitter, loss, and partitions for the lab. |

Concurrent insertions after the same origin use a deterministic order based on the Lamport counter, then site ID. The visible-character index is an array cache; edits reindex the affected suffix. This helps append-heavy workloads, but it does not make arbitrary edits constant time.

Tombstones and the operation log are retained. Document size and edit history therefore affect memory use. The simulator is useful for observing particular delivery schedules; the badge reports the current replicas' agreement rather than proving correctness for every possible execution.

## Tests and benchmarks

```bash
npm test
npm run build
npm run bench
npm run bench -- 50000
```

[CRDT property tests](src/crdt/convergence.property.test.ts) generate edit sequences across 2–4 replicas, vary delivery order, and compare text and version vectors after synchronization. [Replica tests](src/session/replica.test.ts) cover simulated delay, loss, partitions, and gap repair.

The [benchmark script](scripts/bench.ts) measures local insertion, ordered and reversed remote delivery, concurrent edits, position lookups, and snapshot restoration. It also runs a two-replica simulation with latency and packet loss. Results depend on the workload and runtime; the script can be used to reproduce measurements on your machine.

## License

MIT
