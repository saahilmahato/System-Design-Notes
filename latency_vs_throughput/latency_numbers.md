## Latency Reference Numbers Every Engineer Should Know

> Knowing these orders of magnitude — and the **relative gaps between them** — is what separates engineers who guess from those who diagnose. Internalize the scale, not just the numbers.

### 🏎️ CPU & Memory (Nanoseconds — ns)

| Operation | Latency | Notes |
|---|---|---|
| L1 cache reference | 0.5 ns | Fastest memory access possible |
| Branch mispredict | 5 ns | CPU pipeline flush penalty |
| L2 cache reference | 7 ns | 14× slower than L1 |
| L3 cache reference | 20 ns | Shared across cores |
| Mutex lock/unlock | 25 ns | Synchronization cost; avoid on hot paths |
| Main memory (RAM) reference | 100 ns | 20× slower than L2; 200× slower than L1 |

---

### 🗜️ Compression & Network Preprocessing (Microseconds — μs, Milliseconds — ms)

| Operation | Typical Cost | Notes |
|---|---|---|
| Header parsing | < 1 μs | Usually negligible |
| Checksum calculation | 1–100 μs | Depends on payload size |
| JSON serialization | 10–500 μs | Can become significant for large objects |
| JSON deserialization | 10–1000 μs | Often slower than serialization |
| Gzip compression | 0.1–10 ms | CPU-intensive, excellent compression ratio |
| Gzip decompression | 0.05–2 ms | Usually much faster than compression |
| Brotli compression | 0.5–100+ ms | Higher ratios, much higher CPU cost |
| Brotli decompression | 0.1–5 ms | Faster than compression |
| Snappy/LZ4 compression | 10–500 μs | Optimized for speed over ratio |
| Snappy/LZ4 decompression | 5–200 μs | Extremely fast |
| TLS encryption/decryption | 10–500 μs | Hardware acceleration is common |

---

### 💾 Storage & Persistence (Microseconds — μs, Milliseconds — ms)

| Operation | Typical Latency | Notes |
|---|---|---|
| NVMe SSD random read | 50–150 μs | ~1,000× slower than RAM |
| NVMe SSD random write | 20–200 μs | Depends on controller and workload |
| SATA SSD random read | 100–300 μs | Slower interface and controller |
| HDD sequential read (first byte) | 1–5 ms | Dominated by rotational latency |
| HDD random read | 5–15 ms | Seek + rotational latency |
| HDD random write | 5–20 ms | Similar to random reads |
| fsync() / durable commit (SSD) | 0.1–5 ms | Forces data to stable storage |
| fsync() / durable commit (HDD) | 5–20+ ms | Mechanical media dominates |

---

### 🌍 Network & Intercontinental (Milliseconds — ms)

| Operation | Typical Latency | Notes |
|------------|----------------|--------|
| Same rack communication | 0.1–0.5 ms | Servers connected through the same top-of-rack switch |
| Same data center | 0.5–2 ms | East-west traffic inside a facility |
| Same metro area | 1–10 ms | Different availability zones or facilities |
| Regional communication | 10–30 ms | Within a large geographic region |
| Cross-country communication | 30–80 ms | Limited by fiber distance and routing |
| Intercontinental communication | 80–200 ms | Ocean crossings dominate latency |
| Circumnavigating the Earth (theoretical minimum) | ~133 ms | Speed of light in fiber limit |
| Circumnavigating the Earth (real network path) | 150–300+ ms | Routing, switching, and indirect paths add overhead |
| Geostationary satellite round trip | 500–700 ms | Physics dominates; difficult to improve |
| Earth ↔ Moon round trip | ~2.5 s | Light-speed limit |
| Earth ↔ Mars round trip | 6–44 min | Depends on orbital distance |

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