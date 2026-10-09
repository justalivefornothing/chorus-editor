# Chorus Editor

**A real-time multi-cursor collaborative code editor powered by a from-scratch RGA (Replicated Growable Array) sequence CRDT, featuring causal FIFO buffers, vector clocks, and interactive partition/latency simulation.**

Most collaborative text editors rely on opaque hosted services or obscure operational transformation (OT) algorithms. Chorus is built from first principles to make Conflict-Free Replicated Data Types (CRDTs) visually and mathematically transparent. Replicas synchronize across browser tabs and WebRTC peers while a live network lab lets you introduce artificial packet latency, reordering, and partition splits to witness mathematical convergence in real time.

---

## Distributed Systems Architecture

```
User Keystroke (Site A)
    │
    ▼ [Local Insert/Delete]
    │
    ▼ [RGA CRDT Engine]      Generates uniquely identified operation { id, refId, value }
    │
    ▼ [Broadcast Channel / WebRTC]
    │
    ▼ [Causal Buffer]        Holds out-of-order operations until causal dependencies arrive
    │
    ▼ [Tree Integration]     Deterministic tie-breaking (logical timestamp > site ID)
    │
    ▼ [CodeMirror Binding]   Incremental viewport decoration & multi-cursor positions
```

### 1. The RGA CRDT Model (`src/crdt/rga.ts`)
Chorus implements the **Replicated Growable Array (RGA)** algorithm:
- Every character is represented as a persistent node identified by a unique tuple: `OpID { siteId: string, seq: number }`.
- Insertions are defined relative to the character immediately to their left (`refId`).
- Deletions are processed as tombstones (`isDeleted = true`) to preserve the causal structure for concurrent edits without altering character IDs.
- Deterministic conflict resolution: when two sites insert concurrently after the same reference node, operations are ordered strictly by logical clock sequence numbers; ties are broken by lexicographical site ID comparison.

### 2. Causal FIFO Buffering (`src/crdt/buffer.ts`)
- Network transports (BroadcastChannel, WebSockets, or WebRTC datachannels) do not guarantee causal delivery.
- Replicas maintain a per-site **Causal Buffer** and local **Vector Clock**.
- If an operation arrives whose `refId` is not yet present in the local replica tree, it is deferred in the buffer until the prerequisite operations arrive, preventing tree corruption.

### 3. Incremental Index Maintenance
- Instead of rebuilding the visible string from scratch on every character insertion ($O(N)$), Chorus maintains an index tree over visible (non-tombstone) characters.
- Visible offsets are updated incrementally from the edit point, achieving $>500\times$ faster updates at large document sizes (tested up to 50,000 characters).

---

## Architectural Decision Records (ADRs)

### ADR 1: RGA vs. LSEQ / Logoot vs. Automerge
* **Context:** We needed a sequence CRDT capable of low-latency in-browser collaborative text editing.
* **Decision:** Selected RGA over fractional indexing approaches (LSEQ / Logoot) and full JSON document CRDTs (Automerge).
* **Rationale:** Fractional indexing suffers from boundary interleaving and precision overflow under adversarial concurrent typing patterns (e.g. alternating typing at the same cursor position). RGA's linked-tree structure guarantees deterministic convergence without tree balance degredation.

### ADR 2: Property-Based Verification with Fast-Check
* **Context:** Concurrency bugs in distributed CRDTs are notoriously subtle and difficult to catch with hand-crafted unit tests.
* **Decision:** Employ property-based generative testing (`fast-check`) across randomized execution traces.
* **Verification:** The test suite runs hundreds of randomized concurrent operations (arbitrary interleavings of insertions, deletions, and partitions across 2–5 virtual replicas) and verifies that:
  $$\forall \text{ Replicas } A, B: \quad \text{State}(A) \equiv \text{State}(B) \quad \text{after syncing}$$

---

## Live Simulation Lab

Chorus includes an interactive lab panel designed for distributed systems demonstration:
* **Latency Slider**: Inject 0 ms to 3,000 ms of artificial packet delay between peers.
* **Jitter & Packet Loss**: Simulate dropped or out-of-order network packets.
* **Network Partition Switch**: Sever communication between replicas to allow divergent local typing, then heal the partition to observe conflict-free convergence.

## Running Locally

```bash
npm install
npm test          # Runs 80+ unit and fast-check convergence tests
npm run dev       # Starts local collaborative editor studio
```

## License

MIT
