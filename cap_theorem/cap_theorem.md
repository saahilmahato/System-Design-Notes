# CAP Theorem

## What Is It?

The **CAP Theorem** (Brewer's Theorem) states that any distributed system providing shared read/write storage can guarantee **at most two** of the following three properties simultaneously:

| Property | Definition |
|---|---|
| **C — Consistency** | Every read returns the most recent write (or an error). All nodes see the same data at the same time — equivalent to a single-machine register. |
| **A — Availability** | Every request to a non-failing node receives a response (not an error/timeout). No guarantee it's the latest data. |
| **P — Partition Tolerance** | The system continues to operate even when the network drops or delays messages between nodes. |

> **Origin:** Eric Brewer proposed it as a conjecture at PODC 2000. Gilbert & Lynch (MIT) formally proved it in 2002.

---

## Why Does It Matter?

- Networks are **not reliable**. Partitions (message loss between nodes) are inevitable in any distributed system.
- Therefore, **P is not optional** — every distributed system must tolerate partitions.
- This reduces the real choice to: **CP or AP** during a partition event.

> "You cannot build a network that is both 100% available and 100% consistent once you distribute it across machines."

---

## The Three Properties — Deep Dive

### Consistency (Linearizability)

- Formally called **linearizable** or **atomic** consistency.
- The system behaves as if there is a single copy of data.
- After a successful write of value `X`, any subsequent read from **any** node must return `X`.
- Rules out **eventual consistency** — a delayed write becoming visible is a consistency violation.

**Invalid history under strong consistency:**
```
Client A: set(10)
Client B: set(5)
Client A: get() → 10   ✓
Client B: get() → 5    ✗  (B should also see 10 as the last write)
```

### Availability

- **Every** request to a functioning node must return a valid response — not an error, not a timeout.
- No fixed time bound required, but the response must eventually come.
- Strong in scope (100% of requests), weak in timing (unbounded latency allowed).
- A system that returns errors to maintain consistency is **not** available under CAP's definition.

### Partition Tolerance

- A **partition** = the network fails to deliver messages between some nodes (messages are lost, not merely delayed).
- If messages are only delayed, it is **not** a partition.
- A **total partition** = all messages between two groups of nodes are lost — the most common real-world failure.
- Since no network guarantees 100% message delivery, partition tolerance must be assumed.

---

## Why CA Is a Myth in Distributed Systems

The "choose 2 of 3" framing is misleading. The reality:

```
Partitions are inevitable → you must tolerate them → choice is only C or A
```

- A **CA system** (consistent + available, no partition tolerance) is essentially a single-node system — a traditional RDBMS on one machine. Once you distribute data, you must handle partitions.
- Describing a distributed system as "CA" reflects a misunderstanding.
- Better framing:

```
Possibility of Partitions ⟹ NOT (C AND A simultaneously)
```

---

## CP vs AP — The Real Tradeoff

| | CP System | AP System |
|---|---|---|
| **On partition** | Rejects requests or returns errors to stay consistent | Returns possibly stale data, stays available |
| **Guarantee** | Strong consistency | High availability |
| **Risk** | Downtime during partition | Stale/conflicting reads |
| **Examples** | ZooKeeper, HBase, Etcd, Spanner | Cassandra, DynamoDB, CouchDB |
| **Use when** | Correctness is non-negotiable (banking, inventory, locks) | Uptime is non-negotiable (shopping carts, social feeds) |

---

## Consistency Is a Spectrum

CAP defines a binary — but in practice, consistency is relaxed into levels:

| Level | Description | Example |
|---|---|---|
| **Linearizability** | Global single-copy illusion | Spanner, Etcd |
| **Sequential Consistency** | All nodes see same order, not necessarily real-time | Older Zookeeper reads |
| **Causal Consistency** | Causally related ops seen in order | MongoDB (causal sessions) |
| **Eventual Consistency** | All replicas converge given no new writes | DynamoDB, Cassandra |
| **Read-your-writes** | A client always sees its own writes | Common in session-scoped systems |

---

## When Does CAP Actually Bite You?

CAP only forces a tradeoff **during a partition event**. During normal operation, a system can be both consistent and available. The danger: distributed systems run for years and handle millions of requests — the chance of hitting a partition is near-certain over time.

**Two key scenarios:**

1. **Write on one side of a partition** → the other side doesn't know → reads from the other side return stale data.
   - CP system: blocks or errors the read.
   - AP system: returns the stale data.

2. **Node goes down** → remaining nodes must decide: accept writes without the downed node (risk inconsistency on recovery) or reject writes (sacrifice availability).

---

## CAP vs FLP

| | CAP | FLP |
|---|---|---|
| **Authors** | Brewer, Gilbert, Lynch | Fischer, Lynch, Patterson |
| **Topic** | Read-write storage in distributed systems | Consensus (agreement) in distributed systems |
| **Failure model** | Network partitions (message loss) | One potentially failed node, no message loss |
| **Result** | Can't have C + A + P | Consensus is unsolvable in async networks with one failure |
| **Relationship** | Different problems, different models; not directly related |

---

## Practical Intuition (The "Remembrance Inc" Analogy)

Imagine a phone-based memory service run by two people (you and your wife):

- **Consistency problem:** Customer calls you, updates get stored only with your wife. Next call routes to you → you return stale data.
- **Fix (sync updates):** Before completing any write, both of you sync. Now consistent, but if one is unreachable → unavailable.
- **Fix (async email sync):** Write locally, email the other for sync. Now consistent + available — but if the other person ignores emails (network partition) → system breaks. **You can't have all three.**

---

## Common Misconceptions

| Misconception | Reality |
|---|---|
| "I can pick CA" | Not in a distributed system. Partitions happen. You must pick CP or AP. |
| "Partition tolerance means fault tolerance" | Partition tolerance is specifically about **network message loss**, not node crashes. |
| "A failed node = a partitioned node" | No. A failed node is excused from responding. A partitioned node can still run but can't communicate. |
| "A slow node = a partitioned one" | No. Slow nodes eventually deliver messages. But in async networks, you can't tell them apart — which is why CAP is hard. |
| "I've beaten CAP" | No. You've designed a system that is less affected by it. That's engineering, not a theorem bypass. |
| "CAP means I must sacrifice something always" | No. Only during a partition event. Normal operation can satisfy both C and A. |

---

## Key Takeaways for Engineers

- **Assume partitions will happen.** Design your system knowing you'll have to choose C or A under failure.
- **Know your consistency requirement.** Financial transactions need linearizability. User profile updates can tolerate eventual consistency.
- **Know your availability requirement.** E-commerce checkout tolerating slight staleness > returning errors to users.
- **Document your tradeoff explicitly.** "This service is AP: it may return stale data for up to 30 seconds after a write."
- **Tune for the common case.** CAP applies during partitions, which are rare but inevitable. Normal performance and latency are separate concerns.

---

## References

- Brewer, E. (2000). *Towards Robust Distributed Systems*. PODC Keynote. [PDF](http://www.cs.berkeley.edu/~brewer/cs262b-2004/PODC-keynote.pdf)
- Gilbert, S. & Lynch, N. (2002). *Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services*. [PDF](https://users.ece.cmu.edu/~adrian/731-sp04/readings/GL-cap.pdf)
- Herlihy, M. & Wing, J. (1990). *Linearizability: A Correctness Condition for Concurrent Objects*. [PDF](http://cs.brown.edu/~mph/HerlihyW90/p463-herlihy.pdf)
- Fischer, Lynch, Patterson. *Impossibility of Distributed Consensus with One Faulty Process* (FLP). [Overview](http://the-paper-trail.org/blog/a-brief-tour-of-flp-impossibility/)