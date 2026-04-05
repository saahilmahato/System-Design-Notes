# Content Delivery Networks: Push CDNs

---

## What is a Push CDN?

A **Push CDN** is a CDN model where the **origin server proactively pushes content to edge nodes** before any user requests it. The content publisher explicitly controls what gets distributed, when it gets distributed, and for how long it lives on edge servers.

Unlike Pull CDNs (which fetch content on first request), Push CDNs require the operator to **manually or programmatically upload content** to the CDN, which then replicates it across its network of edge nodes.

---

## How It Works

```
[Origin Server] ──push──► [CDN Edge Node - US-East]
                 ──push──► [CDN Edge Node - EU-West]
                 ──push──► [CDN Edge Node - APAC]
                               │
                               ▼
                         [End Users]
                    (served directly from edge)
```

1. **Content Upload** — Publisher uploads content (files, assets, media) to the CDN origin or via an API.
2. **Replication** — The CDN propagates the content across selected or all PoPs (Points of Presence).
3. **TTL Assignment** — Publisher sets a TTL (Time-To-Live) or expiry for each piece of content.
4. **Serving** — Users are served directly from the nearest edge node without hitting the origin.
5. **Invalidation** — Publisher explicitly purges or updates content when it changes.

---

## Key Characteristics

| Property | Description |
|---|---|
| **Control** | Full publisher control over what, when, and where content is pushed |
| **Pre-warming** | Edge nodes are pre-loaded before any user traffic arrives |
| **Cache Hits** | Near 100% cache hit rate for pushed content |
| **Origin Load** | Origin server is almost never hit for pushed content |
| **Content Freshness** | Staleness risk if publisher forgets to push updates |
| **Storage Cost** | Storage consumed at edge even if content is never requested |

---

## When to Use Push CDN

Push CDNs are the right choice when:

- Content is **large but infrequent in change** (e.g., software binaries, game patches)
- Traffic patterns are **predictable and high-volume** (e.g., a scheduled live stream)
- You need **guaranteed availability** at the edge before users arrive (e.g., product launches)
- Content is **static and long-lived** (e.g., archived videos, firmware updates)
- You want **zero origin hits** under any load spike

---

## Trade-offs

### Advantages

- **Zero origin load** — Edge nodes never fall back to origin for pushed content; origin is shielded completely.
- **Guaranteed cache availability** — Content exists at edge before the first user request, eliminating cold-start latency.
- **Predictable performance** — No risk of a cache miss triggering a slow origin fetch during peak traffic.
- **Better for large files** — Binary files, video archives, and installers are pre-distributed without repeated origin fetches.
- **Fine-grained control** — Publisher decides exactly which regions get which content (useful for geo-specific releases).
- **Ideal for launch scenarios** — Gaming updates, OS releases, or media drops can be pre-positioned before going live.

### Disadvantages

- **Manual management overhead** — Publisher is responsible for pushing, updating, and purging content; automation is complex.
- **Storage cost at the edge** — All pushed content occupies edge storage regardless of whether it is ever requested (wasted on rarely accessed content).
- **Staleness risk** — If an update is pushed to the origin but not re-pushed to the CDN, users receive stale content.
- **Poor fit for dynamic content** — Personalized or frequently changing content is impractical to push.
- **Operational complexity** — Requires robust CI/CD or deployment pipelines to trigger pushes on content updates.
- **Cold starts on new PoPs** — Adding a new region or PoP requires a full re-push to that location.

---

## Push vs. Pull CDN

| Dimension | Push CDN | Pull CDN |
|---|---|---|
| **Content upload** | Publisher-initiated | User-request-triggered |
| **First request latency** | Zero (pre-warmed) | Higher (origin fetch on miss) |
| **Origin load** | Minimal | Moderate on cache misses |
| **Storage efficiency** | Low (stores everything pushed) | High (stores only requested content) |
| **Best for** | Large static assets, planned launches | General web content, dynamic sites |
| **Freshness control** | Explicit push/purge | TTL-based expiry |
| **Operational complexity** | Higher | Lower |

---

## Core System Design Concepts

### TTL & Invalidation Strategy
- Push CDNs rely on **explicit purge APIs** rather than TTL expiry.
- Design systems to call the CDN purge API as part of the **deployment pipeline**.
- Use **versioned URLs** (e.g., `/assets/v3.2.1/app.js`) to avoid stale content — a new version is a new URL, making purging unnecessary.

### Content Pre-warming
- For predictable traffic spikes (e.g., live events, Black Friday), pre-push content **hours or days in advance**.
- Some CDN providers support **scheduled pushes** or **geo-targeted distribution**.

### Replication Consistency
- Large CDN networks have hundreds of PoPs. Pushing to all of them takes time.
- Design for **eventual consistency** at the edge — there is a propagation window where some PoPs may have new content while others do not.
- Use **blue/green deployment patterns** at the CDN level: push new content to a subset of PoPs, validate, then propagate globally.

### Storage Budgeting
- Unlike Pull CDNs (which evict cold content via LRU), Push CDNs may hold content indefinitely until explicitly deleted.
- Always set **explicit expiry dates** or trigger **automated cleanup jobs** post-deployment.

---

## Real-World Systems and Applications

### 1. Gaming: Xbox / PlayStation Software Updates
- **Problem:** Game patches (10–100 GB+) need to be delivered to millions of players simultaneously at launch.
- **Solution:** Push patch binaries to CDN edge nodes **before the launch window** opens.
- **Why Push?** Zero tolerance for cache misses at launch. A miss means hitting the origin under millions of concurrent download requests — catastrophic.
- **CDN Provider:** Akamai is widely used by console makers for large-scale software distribution.

### 2. Streaming: Netflix Open Connect
- **Problem:** Stream video to 200M+ subscribers globally with minimal buffering.
- **Solution:** Netflix's **Open Connect** appliances (custom CDN hardware) are placed inside ISP networks. Netflix pushes the most-watched titles **overnight** to local appliances.
- **Why Push?** Netflix uses viewing history data to predict popular content and pre-positions it by region, eliminating peak-hour congestion on backbone links.

### 3. Software Distribution: Mozilla Firefox / OS Vendors
- **Problem:** Distributing browser or OS installer binaries globally on release day.
- **Solution:** Binaries are pushed to CDN (e.g., AWS CloudFront or Fastly) days before the public release.
- **Why Push?** Installer files are large and static — ideal push candidates. All users on release day hit the edge, not the origin.

### 4. Music & Podcasts: Spotify / Apple Podcasts
- **Problem:** Podcast episodes and audio assets must be globally available the moment they are published.
- **Solution:** Audio files are pushed to edge PoPs upon publish, ensuring the first listener in any region gets near-instant playback.
- **Why Push?** Audio files are static and large; once published, they do not change.

### 5. E-Commerce: Product Image Delivery (Cloudinary + Shopify)
- **Problem:** High-resolution product images must load instantly for millions of product pages.
- **Solution:** When a merchant uploads images, they are processed, transcoded, and **pushed to CDN edge nodes** across all regions.
- **Why Push?** Images are immutable once uploaded. Pre-distribution ensures instant load from the first request, globally.

### 6. Enterprise: Akamai NetStorage
- Akamai's **NetStorage** is a push-based origin storage product where companies upload content once and Akamai replicates it globally.
- Used by financial institutions, media companies, and enterprises for distributing static assets, compliance documents, and media archives.

---

## Key Metrics to Track

| Metric | Description |
|---|---|
| **Cache Hit Ratio** | Should be ~100% for well-managed push content |
| **Propagation Latency** | Time for content to appear on all PoPs after a push |
| **Edge Storage Utilization** | Monitor for runaway storage growth from unpurged assets |
| **Origin Request Rate** | Should be near zero for pushed content |
| **Purge Latency** | Time to invalidate outdated content across all edges |
| **TTFB (Time to First Byte)** | Latency from edge to end user |

---

## Summary

> **Push CDNs are the right tool when you own the content distribution schedule.** They trade operational complexity and storage cost for absolute cache guarantee, zero origin load, and predictable performance. They are the architecture of choice for large-file distribution, planned high-traffic events, and media-heavy platforms where cold-start latency is unacceptable.