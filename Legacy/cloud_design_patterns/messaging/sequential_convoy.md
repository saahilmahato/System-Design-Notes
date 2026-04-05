# Cloud Design Patterns — Messaging: Sequential Convoy

---

## 1. Overview

The **Sequential Convoy** pattern ensures that a set of related messages are processed **in a defined order** without blocking unrelated messages. It is a solution to the problem of ordered processing in distributed messaging systems where multiple consumers exist and strict FIFO ordering is needed only within a specific group (a "convoy").

> **Core Idea:** Group messages by a correlation key (e.g., `order_id`, `user_id`) and ensure all messages within a group are processed sequentially, while messages across different groups are processed concurrently.

---

## 2. Problem Statement

Standard message queues with multiple consumers (competing consumers pattern) process messages concurrently — great for throughput, but it destroys ordering guarantees.

**Example failure scenario:**
```
Queue: [OrderCreated(#1), PaymentReceived(#1), OrderShipped(#1)]
Consumer A picks: PaymentReceived(#1)
Consumer B picks: OrderCreated(#1)
Consumer C picks: OrderShipped(#1)

→ OrderShipped processed before OrderCreated — BROKEN STATE
```

**When ordering matters:**
- Financial transactions for the same account
- State machine transitions for the same entity
- Event sourcing replay
- Inventory updates for the same SKU
- User session events

---

## 3. How It Works

### 3.1 Core Mechanism

```
Producers
   │
   ▼
┌─────────────────────────────────────────────────┐
│            Message Broker / Queue               │
│                                                 │
│  [msg-A1] [msg-B1] [msg-A2] [msg-C1] [msg-A3]  │
│       ↑ tagged with partition/correlation key   │
└─────────────────────────────────────────────────┘
         │              │              │
   Partition A    Partition B    Partition C
         │              │              │
   Consumer-1     Consumer-2     Consumer-3
   (ordered)      (ordered)      (ordered)
```

### 3.2 Step-by-Step Flow

1. **Producer tags messages** with a correlation/partition key (e.g., `order_id`, `account_id`).
2. **Broker routes messages** with the same key to the same partition or queue.
3. **Single consumer per partition** processes messages in arrival order.
4. **Consumers work in parallel** across different partitions — no cross-group blocking.
5. **Acknowledgement is sequential** — next message is not consumed until current is ACK'd.

### 3.3 Sequencing Strategies

| Strategy | Mechanism | Used By |
|---|---|---|
| **Partition-based** | Route by key hash to fixed partition | Kafka, Kinesis |
| **Session-based** | Message session groups in queue | Azure Service Bus |
| **Exclusive consumer lock** | Only one consumer holds a key-lock at a time | Custom implementations |
| **Sorted queue per entity** | One queue per entity/tenant | High-isolation systems |

---

## 4. Implementation Patterns

### 4.1 Kafka — Partition Key Routing

```python
# Producer: always send with the same key for ordered processing
producer.send(
    topic="order-events",
    key=b"order-123",          # same key → same partition
    value=serialize(event)
)

# Consumer: each partition consumed by exactly one consumer in a group
consumer = KafkaConsumer(
    "order-events",
    group_id="order-processor",
    enable_auto_commit=False
)

for msg in consumer:
    process_in_order(msg)      # guaranteed sequential within partition
    consumer.commit()
```

### 4.2 Azure Service Bus — Message Sessions

```python
# Producer: set session_id as the convoy key
message = ServiceBusMessage(
    body=payload,
    session_id="user-456"      # all messages for user-456 form a session
)
sender.send_messages(message)

# Consumer: accept a specific session — exclusive lock
with sb_client.get_queue_receiver(
    queue_name="user-events",
    session_id="user-456"
) as session_receiver:
    for msg in session_receiver:
        process(msg)
        session_receiver.complete_message(msg)
```

### 4.3 SQS FIFO — Message Group ID

```python
# Producer
sqs.send_message(
    QueueUrl=FIFO_QUEUE_URL,
    MessageBody=json.dumps(event),
    MessageGroupId="account-789",       # convoy key
    MessageDeduplicationId=str(uuid4()) # idempotency
)

# SQS FIFO guarantees: messages in same group delivered in order,
# one message at a time per group
```

---

## 5. Key Design Decisions

### 5.1 Choosing the Convoy Key

```
What entities MUST be processed in order?
         │
         ▼
   Is ordering needed globally?
   ├── YES → Single partition (low throughput, simple)
   └── NO  → Per-entity key (high throughput, scalable)
              │
              ▼
        Key cardinality?
        ├── High (user_id, order_id) → Partition-based (Kafka/Kinesis)
        └── Low (region, type)       → Session/queue-based (SBus/SQS FIFO)
```

### 5.2 Partition Count Planning

```
Too few partitions → hot partitions, consumer bottlenecks
Too many partitions → resource waste, rebalance overhead

Rule of thumb:
  partitions = max_throughput_msgs_per_sec / msgs_per_sec_per_consumer
  
  With buffer: partitions × 2–3 for future growth
```

### 5.3 Consumer Assignment

```
Kafka Consumer Group Rebalance:
  Consumers = Partitions     → ideal, 1:1 assignment
  Consumers > Partitions     → idle consumers (wasteful)
  Consumers < Partitions     → one consumer handles multiple partitions (still ordered per partition)
```

---

## 6. Trade-offs

### 6.1 Benefits vs. Costs

| Dimension | Benefit | Cost |
|---|---|---|
| **Ordering** | Strict per-entity ordering guaranteed | No global ordering across entities |
| **Throughput** | High — parallel across convoys | Limited within a single convoy |
| **Complexity** | Cleaner business logic (no re-ordering code) | Broker/infra configuration overhead |
| **Scalability** | Scales with number of unique keys | Hot partitions if key distribution is skewed |
| **Fault Tolerance** | Can replay per partition | A poison message in a group blocks the whole group |
| **Latency** | Low for uncongested groups | High if a group has a slow/stuck consumer |

### 6.2 Comparison with Alternatives

| Pattern | Ordering | Throughput | Complexity | Use When |
|---|---|---|---|---|
| **Sequential Convoy** | Per-group ordered | High (parallel groups) | Medium | Per-entity ordering needed |
| **Competing Consumers** | None | Highest | Low | Order doesn't matter |
| **Single Consumer** | Global ordered | Low | Low | Strict global ordering needed |
| **Choreography + Saga** | Eventual | High | High | Long-running, multi-service flows |
| **Inbox/Outbox Pattern** | Per-aggregate | Medium | Medium | DB-first ordering guarantee |

### 6.3 Failure Mode Trade-offs

| Failure Scenario | Impact | Mitigation |
|---|---|---|
| Poison message in group | Blocks entire convoy | DLQ + skip-and-alert strategy |
| Consumer crash mid-group | Rebalance delays ordering | Idempotent processing + offset commit strategy |
| Hot partition (skewed keys) | Latency spike for popular entities | Key salting, virtual partitions |
| Out-of-order producer publish | Wrong ordering despite pattern | Sequence numbers + validation at consumer |
| Session timeout (SBus) | Message re-queued, reprocessed | Idempotency keys on all messages |

---

## 7. Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Using wall-clock time for ordering** | Clock skew in distributed systems makes this unreliable | Use logical sequence numbers or vector clocks |
| **Global single partition for all entities** | Destroys throughput, single point of contention | Partition by entity key |
| **Not handling poison messages** | One bad message blocks entire convoy indefinitely | DLQ + circuit breaker per group |
| **Stateless consumers assuming order** | Consumer restart loses position context | Commit offsets durably, use idempotent handlers |
| **Mixing ordered and unordered messages in same group** | Creates false ordering dependencies | Separate topics/queues by ordering requirement |
| **Too-large convoy groups** | One slow entity starves others in same partition | Fine-grained key selection |

---

## 8. Real-World Systems & Applications

### 8.1 Financial Services — Transaction Ordering

**Stripe**
- All charges, refunds, and disputes for a single payment `intent_id` must be processed sequentially.
- Stripe uses Kafka with `payment_intent_id` as the partition key.
- Prevents race conditions like refunding a payment before it's captured.

**Banks / Ledger Systems**
- Debits and credits for the same `account_id` are strictly ordered.
- Double-entry bookkeeping fails if credit arrives before the opening balance event.

```
Account-123 events (sequential):
  1. AccountOpened
  2. Deposit(+500)
  3. Withdrawal(-200)
  4. InterestApplied(+1.5)

If 3 processed before 2 → negative balance → business rule violation
```

### 8.2 E-Commerce — Order Lifecycle

**Amazon / Shopify**
- Order state machine: `Created → Payment Confirmed → Picking → Shipped → Delivered`
- All events for `order_id` are partitioned together.
- Processing `Shipped` before `PaymentConfirmed` would result in shipping unpaid orders.

### 8.3 Ride-Sharing — Trip State Management

**Uber**
- Trip events partitioned by `trip_id`: `Requested → Accepted → DriverArrived → TripStarted → Completed → Billed`
- GPS location updates for a single trip are ordered for accurate route replay and billing.
- Kafka partitioned by `trip_id` ensures the driver's app and billing system see events in the correct order.

### 8.4 Gaming — Player Action Sequencing

**Multiplayer Game Servers**
- Player actions within a session must be applied in order: move, attack, pick item.
- Out-of-order processing leads to inconsistent game state (picking up an item before reaching it).
- Partitioned by `player_session_id` or `game_room_id`.

### 8.5 Event Sourcing Systems

**Event Store / Axon Framework**
- Aggregate events (e.g., `BankAccount`) must replay in exact sequence to reconstruct state.
- Sequential Convoy is the natural fit — partition by `aggregate_id`.
- Projections that consume these events also require ordered delivery.

### 8.6 IoT — Device Telemetry

**AWS IoT / Azure IoT Hub**
- Sensor readings from a device must be processed in time order.
- Firmware update events must complete before new telemetry is interpreted with new schemas.
- Partitioned by `device_id`.

---

## 9. Infrastructure-Specific Implementations

| Platform | Mechanism | Key Config |
|---|---|---|
| **Apache Kafka** | Partition key | `partitioner.class`, consumer group assignment |
| **AWS SQS FIFO** | MessageGroupId | `.fifo` queue suffix, deduplication ID required |
| **AWS Kinesis** | Partition key | `PartitionKey` on PutRecord |
| **Azure Service Bus** | Message Sessions | `SessionId` on message, `GetSessionReceiver` |
| **Google Pub/Sub** | Ordering keys | `enable_message_ordering=True`, `ordering_key` |
| **RabbitMQ** | Single consumer per queue | Avoid competing consumers on ordered queues |
| **Apache Pulsar** | Key-shared subscription | `SubscriptionType.Key_Shared` |

---

## 10. Monitoring & Observability

### Key Metrics to Track

| Metric | What It Indicates | Alert Threshold |
|---|---|---|
| **Consumer lag per partition** | Backlog building up in a convoy | > N messages or > X seconds behind |
| **DLQ message rate** | Poison messages blocking convoys | Any increase → investigate immediately |
| **Partition skew ratio** | Hot partition / key imbalance | Max partition lag / avg lag > 3x |
| **Message processing time per group** | Slow convoy blocking others | P99 latency per group > SLA |
| **Session lock expiry rate** (SBus) | Consumer too slow, re-queuing messages | > 0 in steady state |
| **Rebalance frequency** (Kafka) | Unstable consumer group | > 1 per hour under normal load |
| **Out-of-order message rate** | Broken producer or routing bug | Should always be 0 |

### Observability Stack

```
Producers → Kafka/SQS/SBus
                │
          ┌─────┴──────┐
     Prometheus     CloudWatch / Azure Monitor
          │
       Grafana Dashboard
          │
    ┌─────┴─────────────┐
    │                   │
Consumer Lag       DLQ Rate
per Partition      per Group
```

---

## 11. Decision Framework

```
Do messages for the same entity need to be processed in order?
├── NO  → Use Competing Consumers (simpler, higher throughput)
└── YES →
        Can you tolerate occasional reordering with compensation logic?
        ├── YES → Saga / Choreography pattern
        └── NO  →
                Is global ordering needed across ALL entities?
                ├── YES → Single consumer / single partition (throughput sacrifice)
                └── NO  →
                        What's your message broker?
                        ├── Kafka/Kinesis → Partition by entity key
                        ├── SQS FIFO     → MessageGroupId
                        ├── Azure SBus   → Message Sessions
                        └── Pub/Sub      → Ordering Keys

                        → Sequential Convoy Pattern ✓
```

---

## 12. Summary

| Aspect | Detail |
|---|---|
| **Pattern Type** | Messaging / Asynchronous Communication |
| **Problem Solved** | Ordered processing of related messages without global serialization |
| **Core Mechanism** | Correlation key → route to dedicated partition/session/group |
| **Throughput Model** | Parallel across groups, sequential within a group |
| **Critical Dependency** | Idempotent message handlers (retries are inevitable) |
| **Poison Message Risk** | High — must have DLQ + alerting strategy |
| **Best Fit** | Financial ledgers, order state machines, event sourcing, IoT telemetry |
| **Avoid When** | Messages are independent → overhead with no benefit |