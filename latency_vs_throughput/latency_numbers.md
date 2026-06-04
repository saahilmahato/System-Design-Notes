## Latency Reference Numbers Every Engineer Should Know

> Knowing these orders of magnitude — and the **relative gaps between them** — is what separates engineers who guess from those who diagnose. Internalize the scale, not just the numbers.

### 🏎️ CPU & Memory (Nanoseconds — ns)

| Operation | Latency | Notes |
|---|---|---|
| L1 cache reference | 0.5 ns | Fastest memory access possible |
| Branch mispredict | 5 ns | CPU pipeline flush penalty |
| L2 cache reference | 7 ns | 14× slower than L1 |
| L3 cache reference | 15-40 ns | Shared across cores |
| Mutex lock/unlock | 25 ns | Synchronization cost; avoid on hot paths |
| Main memory (RAM) reference | 100 ns | 20× slower than L2; 200× slower than L1 |

---

### 📡 Compression, I/O & Local Network (Microseconds — µs)

| Operation | Latency | Notes |
|---|---|---|
| Compress 1K bytes (Snappy/Zippy) | 3–10 µs | Worth it for large payloads over network |
| Send 2K bytes over 1 Gbps network | 10–20 µs | Pure transmission time, no processing |
| Read 4K randomly from SSD | 150 µs | ~1 GB/s SSD throughput |
| Read 1 MB sequentially from memory | 250 µs | RAM is fast but not free |
| Round trip within same datacenter | 500 µs | Your baseline for in-DC service calls |
| Read 1 MB sequentially from SSD | 1,000 µs (1 ms) | 4× slower than RAM sequential read |

---

### 🏢 Disk & Cross-DC Operations (Milliseconds — ms)

| Operation | Latency | Notes |
|---|---|---|
| HDD disk seek (random) | 10 ms | 20× a datacenter round trip — avoid random HDD I/O |
| Read 1 MB sequentially from network | 10 ms | ~1 Gbps link |
| Read 1 MB sequentially from HDD | 20–30 ms | 80× RAM, 20× SSD — use SSDs |

---

### 🌍 Network & Intercontinental (Milliseconds — ms)

| Operation | Latency | Notes |
|---|---|---|
| Packet round trip across the US | 50 ms | Coast-to-coast |
| Packet round trip US ↔ Europe | 100 ms | Transatlantic |
| Packet round trip CA → Netherlands → CA | 150 ms | Global hop |
| Earth → Mars (at closest approach) | 4–24 min | Light-speed limit; no TCP handshakes in space |

---

### 🤖 LLM Inference Latencies (2026 Reference)
 
| Operation | Latency | Notes |
|---|---|---|
| Local LLM (GPU), generate 1 token | 15 ms | Small model on consumer GPU |
| Frontier LLM (hosted), generate 1 token | 20 ms | API-served output token |
| Local LLM, time to first token | 75 ms | Small model, short prompt |
| Local LLM (CPU only), generate 1 token | 100 ms | No GPU — ~5–7× slower than GPU |
| Fast LLM, time to first token | 250 ms | Specialized inference hardware |
| Frontier LLM, time to first token | ~1,000 ms | Short prompt, no KV cache |
| Frontier LLM, short response (~100 tokens) | ~3,000 ms | Full response time |
| Frontier LLM, long context prefill (~100K tokens) | ~10,000 ms | No cache; input processing dominates |
| Frontier LLM, reasoning response | ~30,000 ms | Single call with extended thinking |
 
> LLM latencies matter increasingly as AI is embedded into request paths. A synchronous call to a frontier model adds **seconds**, not milliseconds — design accordingly (async, streaming, caching).