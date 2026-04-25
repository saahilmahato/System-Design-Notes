# Distributed Systems: CAP Theorem — Master Notes

> *"A distributed system is one in which the failure of a computer you didn't even know existed can render your own computer unusable."* — Leslie Lamport

---

## What Is This?

These notes provide a rigorous, end-to-end treatment of the **CAP Theorem** — from intuition and formal definitions through to mathematical proof, real-world system design trade-offs, and the extended **PACELC** model. They are structured for engineers who want both depth and practical applicability.

---

## Why CAP Matters

Modern systems scale **horizontally** — adding commodity nodes rather than upgrading a single machine. This creates distributed systems where nodes share state across an unreliable network. CAP Theorem is the foundational result that governs every design decision in this space. Getting it wrong early can doom a system before its first deployment.

---

## File Index

| File | Contents |
|---|---|
| [`01-consistency.md`](./01-consistency.md) | Definition of Consistency (linearizability), examples, and implications |
| [`02-availability.md`](./02-availability.md) | Definition of Availability, what it guarantees and what it does not |
| [`03-partition-tolerance.md`](./03-partition-tolerance.md) | Network partitions, why they are unavoidable, and what partition tolerance means |
| [`04-mathematical-proof.md`](./04-mathematical-proof.md) | Formal proof of CAP (Gilbert & Lynch), step by step |
| [`05-cp-vs-ap.md`](./05-cp-ap-systems.md) | Why P is non-negotiable; CP vs AP trade-off with real system examples |
| [`06-pacelc.md`](./06-pacelc.md) | PACELC — the extended model covering latency vs consistency even without partitions |

---

## The Core Idea in One Diagram

```
┌─────────────────────────────────────────────────────┐
│                   CAP Triangle                       │
│                                                      │
│              Consistency (C)                         │
│                   /\                                │
│                  /  \                               │
│                 / CA \   ← Does not exist in        │
│                /  (✗) \    distributed systems      │
│               /────────\                            │
│              /    CP    \                           │
│    CP ──────/────────────\────── AP                 │
│            /              \                         │
│           /       AP       \                        │
│          /──────────────────\                       │
│  Availability (A) ──────── Partition Tolerance (P)  │
└─────────────────────────────────────────────────────┘
```

> In any distributed system, **network partitions will occur**. Therefore the real choice is always between **CP** and **AP**.

---

## Quick Reference Table

| Property | Guarantee | Sacrificed When Partition Occurs |
|---|---|---|
| **Consistency** | Every read returns the most recent write | Stale reads may occur |
| **Availability** | Every request receives a non-error response | Requests may time out or error |
| **Partition Tolerance** | System operates despite message loss between nodes | — (must be chosen) |

| System Type | On Partition: Returns | On Partition: Accepts Writes | Examples |
|---|---|---|---|
| **CP** | Error or timeout | No (blocks) | ZooKeeper, HBase, etcd, Spanner |
| **AP** | Potentially stale data | Yes (reconciles later) | Cassandra, DynamoDB, CouchDB |

---

## Reading Order

For someone new to the topic:

1. Start with [`01-consistency.md`](./01-consistency.md) → [`02-availability.md`](./02-availability.md) → [`03-partition-tolerance.md`](./03-partition-tolerance.md)
2. Then [`04-mathematical-proof.md`](./04-mathematical-proof.md)
3. Then [`05-cp-ap-systems.md`](./05-cp-ap-systems.md)
4. Finally [`06-pacelc.md`](./06-pacelc.md)

For experienced engineers refreshing knowledge: start at [`04-mathematical-proof.md`](./04-mathematical-proof.md) or [`06-pacelc.md`](./06-pacelc.md).

---

## Key References

| Source | Link |
|---|---|
| Brewer's original PODC 2000 keynote | [PDF](http://www.cs.berkeley.edu/~brewer/cs262b-2004/PODC-keynote.pdf) |
| Gilbert & Lynch formal proof (2002) | [PDF](https://users.ece.cmu.edu/~adrian/731-sp04/readings/GL-cap.pdf) |
| Herlihy & Wing — Linearizability (1990) | [PDF](http://cs.brown.edu/~mph/HerlihyW90/p463-herlihy.pdf) |
| Abadi — PACELC (2012) | [Paper](https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf) |
| Fallacies of Distributed Computing | [Wikipedia](http://en.wikipedia.org/wiki/Fallacies_of_Distributed_Computing) |