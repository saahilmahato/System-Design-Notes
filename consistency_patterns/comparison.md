# Consistency Patterns — Comparison

← [Back to README](./README.md)

---

## At a Glance

| Property | Strong Consistency | Weak Consistency | Eventual Consistency |
|----------|:-----------------:|:----------------:|:-------------------:|
| **Definition** | All reads reflect latest write | Reads may never reflect recent writes | Reads will *eventually* reflect all writes |
| **Convergence Guarantee** | Immediate | ❌ None | ✅ Yes (async) |
| **Replication Mode** | Synchronous | Best-effort / none | Asynchronous |
| **Read Staleness** | Never stale | May always be stale | Temporarily stale |
| **Write Latency** | High | Lowest | Low |
| **Read Latency** | Medium–High | Lowest | Low |
| **Availability** | Lower | Highest | High |
| **Throughput** | Lower | Highest | High |
| **CAP Position** | CP | AP | AP |
| **Data Durability** | Highest | Lowest | High |
| **Complexity** | Low (simple to reason about) | Low (simple to implement) | Medium–High (conflict resolution) |

---

## Behaviour Under Load

```plantuml
@startuml
!theme plain
skinparam backgroundColor #FAFAFA

rectangle "Write Operation" as W #EBF5FB

rectangle "Strong Consistency" as SC #EBF5FB {
  rectangle "Write to Node A" as SCA
  rectangle "Sync → Node B" as SCB
  rectangle "Sync → Node C" as SCC
  rectangle "All ACK → Client Notified" as SCACK
  SCA --> SCB
  SCB --> SCC
  SCC --> SCACK
}

rectangle "Weak Consistency" as WC #FEF9E7 {
  rectangle "Write to Node A" as WCA
  rectangle "Client Notified ✅" as WCACK
  rectangle "Replicas? Best-effort 🤷" as WCR
  WCA --> WCACK
  WCA -[dashed]-> WCR
}

rectangle "Eventual Consistency" as EC #EAF7EC {
  rectangle "Write to Node A" as ECA
  rectangle "Client Notified ✅" as ECACK
  rectangle "Async → Node B (T+Δ)" as ECB
  rectangle "Async → Node C (T+2Δ)" as ECC
  rectangle "All converge ✅ (eventually)" as ECCONV
  ECA --> ECACK
  ECA -[dashed]-> ECB
  ECB -[dashed]-> ECC
  ECC --> ECCONV
}

W --> SC
W --> WC
W --> EC
@enduml
```

---

## Latency Profile

```plantuml
@startuml
!theme plain
skinparam backgroundColor #FAFAFA

rectangle "Latency (Write)" {
  rectangle "Weak:     ████░░░░░░  (lowest)" as wl #FEF9E7
  rectangle "Eventual: █████░░░░░  (low)" as el #EAF7EC
  rectangle "Strong:   ██████████  (highest)" as sl #EBF5FB
}
@enduml
```

| Operation | Strong | Eventual | Weak |
|-----------|--------|----------|------|
| **Write** | Slowest (waits for all replicas) | Fast (wait for quorum or 1 node) | Fastest (write and forget) |
| **Read** | Fast (any replica is fresh) | Fast (may be stale) | Fastest (always returns immediately) |
| **Failure Recovery** | Slowest (must re-sync before serving) | Moderate (background anti-entropy) | Instant (serve whatever is local) |

---

## Consistency vs. Availability Trade-off (CAP)

```plantuml
@startuml
!theme plain
skinparam backgroundColor #FAFAFA
skinparam rectangle {
  BorderColor #7F8C8D
}

rectangle "Network Partition Occurs" as NP #FDEDEC

rectangle "Strong Consistency\n(Choose Consistency)" as SC #EBF5FB {
  rectangle "Refuse to serve reads\nor writes until partition heals" as SC1
  rectangle "→ Availability suffers" as SC2
  SC1 --> SC2
}

rectangle "Weak / Eventual Consistency\n(Choose Availability)" as EC #EAF7EC {
  rectangle "Continue serving reads and writes\nfrom local node" as EC1
  rectangle "→ Consistency suffers (temporarily)" as EC2
  EC1 --> EC2
}

NP --> SC
NP --> EC
@enduml
```

---

## Real-World Examples Side by Side

| Domain | Strong Consistency | Eventual Consistency | Weak Consistency |
|--------|-------------------|---------------------|-----------------|
| **Finance** | Bank transfers, ledger balances | Balance history export | — |
| **E-Commerce** | Inventory reservation, payment | Product catalog, reviews | Live visitor count |
| **Social Media** | — | Post feeds, likes, follows | Live view count |
| **Gaming** | Leaderboard (official) | Player profile updates | Real-time position |
| **Infrastructure** | Distributed locks (etcd/ZooKeeper) | Service discovery (Consul) | Metrics dashboards |
| **Communication** | — | Message delivery (SMS/chat) | VoIP, live video packets |
| **Content** | — | DNS records, CDN purge | CDN edge cache |

---

## Decision Flowchart

```plantuml
@startuml
!theme plain
skinparam backgroundColor #FAFAFA
skinparam decision {
  BackgroundColor #FEF9E7
  BorderColor #E67E22
}
skinparam activity {
  BackgroundColor #EBF5FB
  BorderColor #2980B9
}

start

:New system component / data type;

if (Is data loss completely\nunacceptable?) then (YES)
  if (Must reads always\nreturn fresh data?) then (YES)
    :Use **Strong Consistency**\n\nExamples: Payments, Inventory\nReservations, Medical Records;
    stop
  else (NO)
    :Consider tuned quorum\nor Strong + caching layer;
    stop
  endif
else (NO)
  if (Must data *eventually*\nconverge on all nodes?) then (YES)
    :Use **Eventual Consistency**\n\nExamples: Social feeds, DNS\nShopping carts, Collaborative docs;
    stop
  else (NO)
    if (Is data ephemeral\nor time-bound?) then (YES)
      :Use **Weak Consistency**\n\nExamples: Game state, VoIP\nLive metrics, Video streams;
      stop
    else (NO)
      :Re-evaluate requirements —\nWeak consistency with no\nconvergence is risky for\npersistent data;
      stop
    endif
  endif
endif
@enduml
```

---

## Conflict Resolution Strategies

When multiple writes occur concurrently, different patterns handle them differently:

| Pattern | Conflict Handling | Strategy | Risk |
|---------|------------------|----------|------|
| **Strong** | Prevented via locking | Serialization / 2PC | Deadlocks, reduced throughput |
| **Eventual** | Detected and resolved | LWW, Vector Clocks, CRDTs | Merge errors, data anomalies |
| **Weak** | Often ignored | Last-write-wins or dropped | Data loss |

### Conflict Resolution in Practice

```plantuml
@startuml
!theme plain
skinparam backgroundColor #FAFAFA
skinparam sequence {
  ArrowColor #2C3E50
  ParticipantBackgroundColor #EAF7EC
  ParticipantBorderColor #27AE60
}

actor "User A" as UA
actor "User B" as UB
participant "Node 1" as N1
participant "Node 2" as N2
participant "Merge Logic" as ML

UA -> N1 : Write X=10 (T=100)
UB -> N2 : Write X=20 (T=101)

N1 -[dashed]-> N2 : Async sync (X=10, T=100)
N2 -[dashed]-> N1 : Async sync (X=20, T=101)

N1 -> ML : Conflict: X=10 vs X=20
N2 -> ML : Conflict: X=10 vs X=20

ML --> N1 : Resolved: X=20 (LWW: T=101 wins)
ML --> N2 : Resolved: X=20 (LWW: T=101 wins)

note over N1, N2 : All nodes converge on X=20 ✅
@enduml
```

---

## Technology Mapping

```plantuml
@startuml
!theme plain
skinparam backgroundColor #FAFAFA
skinparam rectangle {
  BorderColor #7F8C8D
}

rectangle "Strong Consistency" #EBF5FB {
  rectangle "PostgreSQL\nMySQL\nCockroachDB\nGoogle Spanner\nZooKeeper\netcd\nHBase" as SC_TECH
}

rectangle "Eventual Consistency" #EAF7EC {
  rectangle "Amazon DynamoDB\nApache Cassandra\nAmazon S3\nCouchDB\nRiak\nApache Kafka\nDNS" as EC_TECH
}

rectangle "Weak Consistency" #FEF9E7 {
  rectangle "Memcached\nCDN Edge Caches\nRedis (no-persist)\nWebRTC\nUDP-based systems\nPrometheus" as WC_TECH
}
@enduml
```

---

## Summary Table

| | Strong | Eventual | Weak |
|--|--------|----------|------|
| **Guarantee** | Immediate consistency | Convergence over time | No guarantee |
| **Suitable for** | Finance, booking, locks | Social, DNS, carts | Gaming, VoIP, metrics |
| **Main Risk** | Lower availability | Temporary stale reads | Data loss / divergence |
| **Scaling Difficulty** | Hardest | Moderate | Easiest |
| **Conflict Possible?** | No (prevented) | Yes (resolved) | Yes (ignored) |
| **Best Technologies** | PostgreSQL, Spanner, etcd | Cassandra, DynamoDB, S3 | Memcached, CDN, UDP |

---

← [Eventual Consistency](./eventual-consistency.md) | [Back to README](./README.md)
