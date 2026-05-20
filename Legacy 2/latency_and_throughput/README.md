# System Design: Latency & Throughput — Index

## Files

| # | File | Contents |
|---|---|---|
| 1 | [`01-latency.md`](./01-latency.md) | Definition, components, latency numbers, percentiles, root causes |
| 2 | [`02-throughput.md`](./02-throughput.md) | Definition, Little's Law, hardware example, bottlenecks, scaling patterns |
| 3 | [`03-latency-vs-throughput.md`](./03-latency-vs-throughput.md) | Trade-offs, quadrant analysis, web server & DB examples, Amdahl's Law |
| 4 | [`04-techniques.md`](./04-techniques.md) | Caching, load balancing, async queues, DB tuning, CDN, concurrency, protocols |

---

## TL;DR (One-Page Cheatsheet)

### Definitions

| Term | Definition | Unit |
|---|---|---|
| **Latency** | Time for a single operation to complete | ms, µs, ns, clock cycles |
| **Throughput** | Number of operations per unit time | RPS, TPS, Mbps |

### The Golden Rule
> **Maximize throughput. Define and protect your latency SLA (p99).**

### Key Formulas

**Little's Law:**
```
Concurrent requests in-flight = Throughput (RPS) × Latency (seconds)
```

**Amdahl's Law (max speedup from parallelism):**
```
Speedup = 1 / (SerialFraction + ParallelFraction / N)
```

### Latency Numbers (memorize these)

| Operation | Latency |
|---|---|
| L1 cache | 0.5 ns |
| RAM | 100 ns |
| SSD read | 100 µs |
| Same-DC round trip | 0.5 ms |
| Cross-region (US↔EU) | ~100 ms |

### Trade-off Quick Reference

| Technique | Latency | Throughput |
|---|---|---|
| Caching | ↓↓ | ↑ |
| Load balancing | ↓ | ↑↑ |
| Async / queues | ↓ (perceived) | ↑↑ |
| CDN | ↓↓ | ↑ |
| DB indexing | ↓↓ | ↑ |
| Batching | ↑ | ↑↑ |
| Read replicas | ± | ↑↑ |
| Binary protocols | ↓ | ↑ |
