# Back Pressure

## Table of Contents
1. [What is Back Pressure?](#what-is-back-pressure)
2. [Why Back Pressure Matters](#why-back-pressure-matters)
3. [Core Mechanics](#core-mechanics)
4. [Back Pressure Strategies](#back-pressure-strategies)
5. [Implementation Patterns](#implementation-patterns)
6. [Trade-offs](#trade-offs)
7. [Real-World Systems & Applications](#real-world-systems--applications)
8. [Decision Framework](#decision-framework)
9. [Anti-Patterns](#anti-patterns)
10. [Monitoring & Metrics](#monitoring--metrics)

---

## What is Back Pressure?

**Back pressure** is a flow control mechanism that allows a downstream consumer to signal to an upstream producer to slow down or stop sending data when it can no longer keep up with the rate of production.

The term originates from fluid dynamics — in a pipe system, back pressure is the resistance or force opposing the desired flow of fluid. In computing, it's the analogous resistance a system exerts when it's overwhelmed.

```
Producer ──────────────────────► Consumer
   ▲           [Queue/Buffer]         │
   │                                  │
   └──────── Back Pressure ◄──────────┘
              Signal: "slow down"
```

Without back pressure, producers continue at full speed regardless of consumer capacity, leading to:
- Buffer overflow
- Memory exhaustion (OOM crashes)
- Cascading failures across the system
- Unpredictable latency spikes

---

## Why Back Pressure Matters

In distributed systems, components almost never operate at identical throughput rates. A producer can easily generate data faster than a consumer can process it, especially under:

- **Traffic spikes** — sudden bursts of user activity
- **Slow downstream services** — a DB query taking longer than usual
- **Resource contention** — CPU, memory, I/O bottlenecks
- **Hot partitions** — uneven load distribution

Without a mechanism to communicate this imbalance, systems either drop data silently or crash under load. Back pressure makes the flow control **explicit and intentional**.

---

## Core Mechanics

### The Producer-Consumer Imbalance

```
Producer rate:  ████████████████████  (10,000 msg/sec)
Consumer rate:  ██████████            ( 5,000 msg/sec)
                                       → Queue grows unboundedly
```

### Feedback Loop

Back pressure creates a closed-loop control system:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Producer → [Buffer/Queue] → Consumer                   │
│      ↑                           │                      │
│      └──── Pressure Signal ◄─────┘                      │
│                                                         │
│  Signal types:                                          │
│    • Pause / Resume                                     │
│    • Rate limit tokens                                  │
│    • Reject with error (HTTP 429, TCP RST)              │
│    • ACK/NACK on message consumption                    │
└─────────────────────────────────────────────────────────┘
```

### Buffer as a Shock Absorber

Buffers (queues, ring buffers, channels) are the intermediary that absorbs transient spikes. Back pressure kicks in once the buffer reaches a defined **high-water mark**.

```
Buffer States:
  [0% ─────── 50% ──── 80% ─────── 100%]
   Normal    Warn    Throttle     Full → Drop/Block/Error
              ↑         ↑
         Low-water   High-water
           mark        mark
```

---

## Back Pressure Strategies

### 1. Blocking (Synchronous Back Pressure)

The producer is **blocked** until the consumer frees up capacity.

```
Producer.send(msg) → blocks until queue has space → resumes
```

- **Used in**: Java `BlockingQueue`, Go buffered channels, TCP flow control
- **Pros**: No data loss, simple to reason about
- **Cons**: Threads/goroutines tie up resources while blocked; risk of deadlock

---

### 2. Dropping (Loss-Tolerant Back Pressure)

When the buffer is full, incoming messages are **dropped** — either at the producer or at the queue boundary.

**Drop strategies:**
| Strategy | Description | Use Case |
|---|---|---|
| Drop Newest | Discard incoming message | Real-time metrics, sensor data |
| Drop Oldest | Evict head of queue | Live video streaming |
| Drop Random | Random eviction | Load shedding under extreme pressure |
| Priority Drop | Drop low-priority messages first | Multi-class traffic (e.g., ads vs. core API) |

- **Pros**: System remains responsive; no cascading slowdowns
- **Cons**: Data loss; requires idempotency or retry logic at the producer

---

### 3. Rate Limiting / Throttling

The producer is **slowed down** rather than stopped. The signal from the consumer dictates the pace.

```
Consumer fills queue to 80% → signals producer to halve emission rate
Consumer drains queue to 40% → signals producer to resume full rate
```

- **Used in**: Reactive Streams, Kafka consumer lag-based throttling, HTTP 429
- **Pros**: Graceful degradation; no hard blocking or data loss
- **Cons**: Requires a feedback channel; more complex than blocking

---

### 4. Buffering with Spill-to-Disk

When in-memory buffers are exhausted, data is spilled to persistent storage to handle the overflow.

```
Memory Buffer Full → Spill to Disk → Consumer reads from disk when caught up
```

- **Used in**: Kafka (persistent log), Flink's managed memory with RocksDB, Logstash persistent queues
- **Pros**: No data loss even under extreme pressure
- **Cons**: Disk I/O latency; increased operational complexity

---

### 5. Reactive Pull Model

Instead of producers pushing data, consumers **pull** only as much as they can handle. This is the model promoted by the **Reactive Streams specification**.

```
Consumer.request(n) → Producer sends exactly n items → Consumer processes → requests more
```

- **Used in**: RxJava, Project Reactor, Akka Streams, gRPC streaming
- **Pros**: Consumer always in control; naturally prevents overload
- **Cons**: Latency introduced by round-trip request; harder to implement for high-throughput pipelines

---

### 6. Load Shedding

A deliberate policy to **reject work** when the system is overloaded, protecting core functionality.

```
if (queue.size() > HIGH_WATER_MARK) {
    return HTTP 503 / 429;  // Reject; let the client retry later
}
```

- **Used in**: API gateways, service meshes (Envoy, Istio), AWS Lambda throttling
- **Pros**: System stays alive and serves critical traffic; explicit failure is better than implicit degradation
- **Cons**: Caller must handle rejection gracefully; requires good retry and circuit breaker logic

---

## Implementation Patterns

### TCP Flow Control (Kernel-Level Back Pressure)

TCP implements back pressure via the **receive window** (`rwnd`). The receiver advertises how much buffer space it has. When the buffer is full, the window shrinks to 0, causing the sender to pause.

```
Sender              Receiver
  │── SEQ=1, Data ──►│
  │── SEQ=2, Data ──►│  Receiver buffer filling up
  │◄── ACK, rwnd=0 ──│  Back pressure signal
  │     (paused)      │  Consumer drains buffer
  │◄── ACK, rwnd=64K ─│  Resume signal
  │── SEQ=3, Data ──►│
```

This is the gold standard for transparent, automatic back pressure at the network layer.

---

### Bounded Queues with High-Water Mark

```java
// Java BlockingQueue — blocks producer when full (capacity = 1000)
BlockingQueue<Message> queue = new ArrayBlockingQueue<>(1000);

// Producer — blocks automatically if queue is full
queue.put(message);  // Blocking call

// With timeout (non-blocking drop)
boolean accepted = queue.offer(message, 100, TimeUnit.MILLISECONDS);
if (!accepted) {
    metrics.increment("messages.dropped");
}
```

---

### Reactive Streams (Pull-Based)

```java
// Project Reactor — consumer requests 10 items at a time
Flux.range(1, 1_000_000)
    .onBackpressureBuffer(1000)  // Buffer up to 1000
    .subscribe(new BaseSubscriber<>() {
        @Override
        protected void hookOnSubscribe(Subscription subscription) {
            request(10);  // Pull 10 items initially
        }
        @Override
        protected void hookOnNext(Integer value) {
            process(value);
            request(10);  // Request next 10 after processing
        }
    });
```

---

### Kafka Consumer Lag as Back Pressure Signal

```
Topic Partition: [msg1][msg2][msg3]...[msg10000]
                                             ↑ Producer Offset: 10000
                        ↑ Consumer Offset: 5000

Consumer Lag = 10000 - 5000 = 5000 messages

Monitoring signal:
  if (consumerLag > THRESHOLD) {
      → Scale consumer group (add partitions/consumers)
      → Throttle producer
      → Alert on-call engineer
  }
```

---

### gRPC Flow Control

gRPC uses HTTP/2 flow control at the transport layer, plus application-level back pressure via stream credits.

```
Client                        Server
  │─── Request stream open ──►│
  │─── Data chunk 1 ──────────►│  Window: 65535
  │─── Data chunk 2 ──────────►│  Window: 32768
  │◄── WINDOW_UPDATE(32768) ───│  Server signals: more capacity
  │─── Data chunk 3 ──────────►│
```

---

## Trade-offs

### Blocking vs. Dropping

| Dimension | Blocking | Dropping |
|---|---|---|
| Data loss | None | Yes |
| System availability | Risk of cascading slowdown | Stays responsive |
| Complexity | Simple | Needs drop policy + retry logic |
| Best for | Financial transactions, event sourcing | Metrics, telemetry, live streams |

---

### Pull vs. Push

| Dimension | Push (Producer-Driven) | Pull (Consumer-Driven) |
|---|---|---|
| Throughput | Higher (no round-trip) | Lower (request latency) |
| Consumer overload risk | High without back pressure | None by design |
| Latency | Lower | Higher |
| Implementation | Simpler | More complex |
| Best for | Real-time streaming | Controlled processing pipelines |

---

### Buffer Size

| Buffer Size | Effect |
|---|---|
| Too small | Back pressure triggers too aggressively; frequent producer pausing |
| Just right | Absorbs transient spikes; smooth flow |
| Too large | Memory exhaustion; long tail latency; failure detection delayed |

**Rule of thumb**: Buffer size should be sized to absorb the expected burst duration at peak rate.
`buffer_size = peak_rate × max_acceptable_burst_duration`

---

### Back Pressure vs. No Back Pressure

| | With Back Pressure | Without Back Pressure |
|---|---|---|
| Overload behavior | Graceful slowdown or rejection | OOM crash, queue overflow, data loss |
| Failure mode | Explicit, detectable | Silent, catastrophic |
| Latency | Slightly higher under normal load | Lower under normal load |
| Cascading failure risk | Low | High |
| Operational complexity | Higher | Lower |

---

## Real-World Systems & Applications

### Kafka

Kafka's architecture is built around back pressure as a first-class concern:
- **Persistent log** means producers never block consumers — consumers read at their own pace
- **Consumer group lag** is the primary back pressure metric
- **Fetch request / max.poll.records** gives consumers explicit pull control
- Producers apply back pressure via `max.block.ms` — if the internal buffer is full, the `send()` call blocks for up to that duration before throwing an exception

```
Producer → [Partition Log (immutable)] → Consumer Group
                    ↑                           ↓
              Retention Policy            Consumer Offset
              (7 days default)            (controls read rate)
```

---

### TCP (Linux Kernel)

TCP's receive window and congestion control (CUBIC, BBR) are the most widely deployed back pressure mechanisms in existence. Every HTTP request you've ever made uses this. The kernel automatically manages buffer sizes via `tcp_rmem` and `tcp_wmem` tuning parameters.

---

### gRPC / HTTP2

HTTP/2 implements flow control at both the stream and connection level using `WINDOW_UPDATE` frames. gRPC server-side streaming uses this to prevent a fast server from overwhelming a slow client. This is critical for mobile/IoT clients with limited bandwidth.

---

### Akka / Akka Streams

Akka's actor mailboxes are unbounded by default — a known footgun. Akka Streams (built on Reactive Streams) introduces **demand-driven back pressure**: sources only emit when downstream signals demand. Used at Twitter, LinkedIn, and Zalando for event processing pipelines.

---

### NGINX / Envoy (Service Mesh)

Envoy implements back pressure through:
- **Circuit breakers**: `max_connections`, `max_requests`, `max_pending_requests`
- **Rate limiting**: Integrated with the rate limit service (e.g., Lyft's ratelimit)
- **Load shedding**: Responds with `503` when the upstream cluster is at capacity

```yaml
# Envoy circuit breaker config
circuit_breakers:
  thresholds:
    - priority: DEFAULT
      max_connections: 1000
      max_pending_requests: 1000
      max_requests: 1000
      max_retries: 3
```

---

### Netflix

Netflix's **Hystrix** (now in maintenance, succeeded by Resilience4j) implemented back pressure via bulkheads and circuit breakers. Each downstream dependency got a bounded thread pool. When that pool was saturated, requests were immediately rejected (fail-fast) rather than queuing indefinitely — classic load shedding as back pressure.

Netflix also uses **buffered prefetch** in their streaming pipeline: the CDN prefetches the next video segments, but back pressure from the client's playback buffer dictates how aggressively to prefetch.

---

### Uber (Ringpop / TChannel)

Uber's internal RPC framework TChannel implements back pressure via explicit **request timeouts + circuit breakers**. When downstream services degrade, timeouts trigger fast failure responses. Their dispatch infrastructure also uses queue depth as a signal to shed load at the API gateway layer before requests reach overloaded microservices.

---

### Discord

Discord's message pipeline (using Elixir/BEAM + Rust) uses back pressure in their gateway:
- WebSocket connections have bounded send buffers
- If a client's receive buffer fills (slow client, poor network), the server-side connection process applies back pressure to the event fan-out stage
- This prevents one slow client from blocking message delivery to other clients in the same guild

---

### RxJava / Reactive Extensions

RxJava 2+ (and Project Reactor) formalized back pressure strategies with explicit operators:
- `onBackpressureBuffer(capacity)` — buffer up to N, then error
- `onBackpressureDrop()` — silently drop overflow
- `onBackpressureLatest()` — keep only the most recent item

These are used in Android apps (network + UI thread coordination) and backend pipelines at companies like SoundCloud, GitHub, and Square.

---

### AWS SQS / Lambda

SQS acts as a durable back pressure buffer between Lambda invocations:
- Lambda has a concurrency limit per region/account
- SQS queues absorb the burst, preventing Lambda from being overwhelmed
- The **reserved concurrency** setting on a Lambda function is an explicit back pressure knob — when all reserved slots are in use, new invocations are throttled (SQS messages stay in queue)

---

## Decision Framework

```
START: Is your producer faster than your consumer?
        │
        ▼
Can you afford data loss?
   ├── NO  → Can you afford blocking the producer?
   │           ├── YES → Use Blocking Queue / TCP flow control
   │           └── NO  → Use Persistent Buffer (Kafka, SQS) + Pull model
   │
   └── YES → Is latency critical (real-time)?
               ├── YES → Drop newest / Drop oldest
               └── NO  → Rate limit / throttle with retry at producer
```

### Choosing a Strategy

| Scenario | Recommended Strategy |
|---|---|
| Internal service-to-service (same DC) | Blocking queue + async retry |
| Real-time telemetry / metrics | Drop with sampling (keep statistical accuracy) |
| Financial transactions / audit logs | Persistent queue (Kafka) + pull model |
| API Gateway under spike traffic | Load shedding (429/503) + client-side retry w/ jitter |
| Streaming data pipeline | Reactive Streams (Flink, Akka Streams) |
| Mobile client ↔ server | HTTP/2 flow control + adaptive bitrate (video) |
| Microservice fan-out | Circuit breaker + bounded thread pools |

---

## Anti-Patterns

### ❌ Unbounded Queues

```java
// DANGEROUS — unlimited memory growth
Queue<Message> queue = new LinkedList<>();
```

An unbounded queue hides back pressure. The system appears healthy (no dropped messages, no blocking) until the JVM OOMs. Always bound your queues and decide explicitly what happens when they're full.

---

### ❌ Ignoring Back Pressure Signals

```java
// Calling async without respecting demand
Observable.interval(1, TimeUnit.MILLISECONDS)  // 1000/sec
    .subscribe(item -> slowOperation(item));    // 10/sec
    // Result: MissingBackpressureException or heap explosion
```

---

### ❌ Retry Storms

When back pressure causes rejections, naive retry logic (no jitter, no exponential backoff) amplifies the problem. Every rejected request immediately retries, doubling the load on an already overwhelmed system.

```
System at 100% capacity
→ Rejects 50% of requests
→ All rejected clients retry immediately
→ Load jumps to 150%
→ More rejections → more retries → system collapse
```

**Fix**: Exponential backoff + jitter + circuit breaker.

---

### ❌ Back Pressure at Only One Layer

Applying back pressure in isolation (e.g., only at the queue) while other layers (network, database) have no limits creates a false sense of safety. Back pressure must be propagated end-to-end — from the consumer all the way back to the external client or producer.

---

### ❌ Sizing Buffers Arbitrarily

Setting queue sizes based on "seems reasonable" rather than measured throughput rates leads to both under-buffering (too aggressive back pressure) and over-buffering (late failure detection, high latency).

---

## Monitoring & Metrics

### Key Metrics to Track

| Metric | What It Signals |
|---|---|
| **Queue depth / length** | Upstream demand vs. downstream throughput gap |
| **Consumer lag** (Kafka) | How far behind consumers are |
| **Drop rate** | How often overflow policy is triggered |
| **Producer block time** | How long producers are held back |
| **Rejection rate (429/503)** | Load shedding frequency |
| **Processing latency P99** | End-to-end effect of back pressure |
| **Thread pool saturation** | Bulkhead exhaustion |
| **GC pressure / heap usage** | Unbounded buffer growth signal |

### Alerting Thresholds

```
WARN:  queue_depth > 70% of capacity for > 60 seconds
CRIT:  queue_depth > 90% of capacity for > 30 seconds
CRIT:  consumer_lag > SLA_MAX_LAG
CRIT:  drop_rate > 1% of total message volume
WARN:  producer_block_time_p99 > 100ms
```

### Dashboards to Build

1. **Producer/Consumer throughput** — side-by-side rate comparison
2. **Buffer occupancy over time** — steady-state vs. spike visualization
3. **Drop/rejection rate** — volume and percentage
4. **End-to-end latency percentiles** — P50, P95, P99
5. **Consumer lag per partition** (Kafka) — identify hot partitions

---

## Summary

| Concept | One-Liner |
|---|---|
| Back Pressure | Consumer signals producer to slow down or stop |
| Blocking | Producer waits; no data loss; risk of cascading slowdown |
| Dropping | Overflow discarded; system stays responsive; requires loss tolerance |
| Rate Limiting | Production rate adjusted to match consumption rate |
| Load Shedding | Requests rejected explicitly when system is overloaded |
| Reactive Pull | Consumer requests exactly what it can handle |
| High-Water Mark | Threshold that triggers the back pressure response |
| Consumer Lag | Kafka-specific back pressure observable |