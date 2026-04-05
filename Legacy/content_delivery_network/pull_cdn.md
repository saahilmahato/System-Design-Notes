# Content Delivery Networks: Pull CDNs

---

## What is a Pull CDN?

A **Pull CDN** is a type of CDN where content is **not pre-loaded** onto edge servers. Instead, when a user requests a resource, the edge server checks its local cache:

- **Cache HIT** → Serve cached content immediately.
- **Cache MISS** → Edge server *pulls* the content from the origin server, caches it, then serves it to the user.

Subsequent requests for the same resource are served from the edge cache until the TTL (Time-To-Live) expires.

---

## How It Works — Request Lifecycle

```
User Request
     │
     ▼
Edge Server (PoP)
     │
     ├── Cache HIT ──────────────────────► Serve to User ✅
     │
     └── Cache MISS
              │
              ▼
        Origin Server
              │
         Fetch Content
              │
              ▼
        Edge Server
         Cache + Serve
              │
              ▼
          User ✅
```

1. User requests `https://cdn.example.com/image.png`
2. DNS resolves to the nearest edge PoP (Point of Presence)
3. Edge checks local cache
4. On miss: pull from origin, store with TTL
5. Return content to user; future requests are cache hits

---

## Key Concepts

### TTL (Time-To-Live)
- Dictates how long a cached asset lives on the edge before being evicted or re-validated.
- Set via `Cache-Control: max-age=<seconds>` or `Expires` headers.
- **Short TTL** → More origin hits, fresher content.
- **Long TTL** → Fewer origin hits, potentially stale content.

### Cache Invalidation
- Manually purge cached assets before TTL expires (e.g., after a deployment).
- Can be done by URL, tag, prefix, or full purge.
- Critical for correctness after content updates.

### Origin Shield
- An intermediate caching layer between edge nodes and the origin.
- Reduces redundant origin pulls when multiple edge nodes miss simultaneously (thundering herd protection).

### Cache Key
- Typically the URL, but can include query strings, headers, cookies.
- Misconfigured cache keys can cause cache pollution or incorrect content serving.

### Consistent Hashing / PoP Selection
- Anycast or GeoDNS routes users to the nearest PoP.
- Ensures minimal latency and high cache hit rates per region.

---

## Trade-offs

| Dimension | Pull CDN | Notes |
|---|---|---|
| **Setup Complexity** | Low | Just point DNS; no pre-population needed |
| **Cold Start** | Slow first request per PoP | Cache miss hits origin with full latency |
| **Origin Load** | Low (after warm-up) | Traffic spikes cause origin hammering on cold cache |
| **Storage Cost** | Lower | Only caches what is actually requested |
| **Cache Control** | Reactive | TTL-based; invalidation can be complex |
| **Content Freshness** | Configurable | Dependent on TTL strategy |
| **Scalability** | High | Handles massive traffic after cache is warm |
| **Best Fit** | High-traffic, stable assets | Images, JS, CSS, videos |

### Pull CDN vs. Push CDN

| | Pull CDN | Push CDN |
|---|---|---|
| **Content pre-loaded?** | ❌ No | ✅ Yes |
| **Setup effort** | Low | High |
| **Cold start latency** | High | None |
| **Storage efficiency** | High (serves demand) | Low (stores everything) |
| **Best for** | High-traffic, popular content | Small sites, predictable assets |
| **Origin dependency** | On cache miss | Only at upload time |

---

## Configuration Considerations

### Cache-Control Headers (Origin must set these)
```
Cache-Control: public, max-age=86400        # Cache for 1 day
Cache-Control: no-store                     # Never cache
Cache-Control: stale-while-revalidate=60    # Serve stale, refresh in background
Surrogate-Control: max-age=3600            # CDN-specific TTL (stripped before browser)
```

### URL Structure & Versioning
- Use **fingerprinted URLs** for immutable assets: `app.a3f9c1.js`
- Allows aggressive long TTLs (e.g., 1 year) without stale content concerns
- On deploy, new hash = new URL = cache miss (intentional)

### Cache Bypass Rules
- Bypass cache for authenticated routes, personalized content, or POST requests.
- Use `Vary` header carefully — it creates separate cache entries per header value.

---

## Failure Modes & Mitigations

| Failure | Impact | Mitigation |
|---|---|---|
| **Origin goes down** | Cache misses fail; 5xx errors | Origin shield, stale-if-error, failover |
| **Thundering herd** | Sudden traffic spike overwhelms origin | Request coalescing, origin shield |
| **Cache poisoning** | Malicious content served to users | Strict cache-key config, input sanitization |
| **Stale content** | Users see outdated data | Short TTL, cache purge on deploy |
| **Cache bypass storms** | Bypass headers misused, origin overloaded | Rate limit bypass routes |

### Request Coalescing
When multiple users simultaneously request the same uncached resource, the CDN collapses them into a **single origin request**, queuing others until the response is cached.

---

## Performance Metrics to Monitor

- **Cache Hit Ratio (CHR)** — Target: >90% for static assets
- **Origin Response Time** — Baseline for cache miss latency
- **TTFB (Time to First Byte)** — End-to-end latency from user perspective
- **Bandwidth Offload %** — How much traffic CDN absorbs from origin
- **Error Rate by PoP** — Surface regional origin/CDN issues

---

## When to Use a Pull CDN

✅ **Good fit:**
- Static assets: images, CSS, JS, fonts, videos
- High and unpredictable traffic (viral content, global user base)
- Sites where content changes infrequently

⚠️ **Use caution:**
- Highly dynamic, personalized content (caching identity-sensitive responses)
- Low-traffic sites (pull CDN may never warm up; adds latency)
- Real-time data (stock prices, live scores — TTL too short to benefit)

❌ **Not ideal for:**
- Private/authenticated content without careful cache-key design
- Frequently changing content with strict freshness requirements

---

## Real-World Systems & Applications

### Cloudflare
- Uses Pull CDN as the default model.
- Users point their DNS to Cloudflare; zero asset pre-loading needed.
- Features like **Cache Rules**, **Cache Reserve** (persistent CDN storage), and **Tiered Caching** (multi-level origin shield) extend the pull model.
- Powers millions of websites; handles >3.3 trillion requests/day.

### AWS CloudFront
- Pull CDN with configurable **origin groups** and **origin shield**.
- Integrates with S3, EC2, ALB as origin.
- **Lambda@Edge** / **CloudFront Functions** allow request/response manipulation at edge PoPs.
- Used by: Amazon.com, Twitch (video delivery), Slack (static assets).

### Fastly
- Pull CDN with **Varnish-based** edge caching (VCL for cache logic).
- Instant purge API: invalidates globally in ~150ms — critical for news sites.
- Used by: GitHub (code delivery), The New York Times, Stripe (API docs).

### Akamai
- One of the oldest CDNs; hybrid pull/push model but pull-first for web assets.
- Used by: Apple software updates, major e-commerce platforms, government sites.

### Netflix Open Connect
- Netflix's proprietary CDN; edge appliances are pre-positioned at ISPs.
- Uses a **predictive pull** model — content is proactively pulled to PoPs based on predicted popularity (title launch, regional trends).
- Offloads ~95% of Netflix traffic from the internet backbone.

### YouTube / Google Cloud CDN
- Google's global backbone acts as the CDN fabric.
- Videos are pulled to regional PoPs on demand and cached aggressively.
- Uses `stale-while-revalidate` patterns for metadata freshness.

---

## System Design Interview Patterns

### Caching Layer in a URL Shortener (e.g., bit.ly)
- Redirect responses (`301`/`302`) are cacheable.
- Pull CDN caches short-URL → long-URL mappings at edge.
- Reduces load on the redirect service; latency drops from ~50ms to ~5ms.

### Static Asset Serving for a Social Media Platform
```
Browser → Pull CDN (images/JS/CSS) → Origin (S3/GCS)
Browser → API Servers (dynamic feeds, auth) [bypasses CDN]
```
- CDN cache-keys must exclude auth cookies to prevent leaking private data.

### Video Streaming Platform
- Video manifest files (`.m3u8`) cached with short TTL (~5s for live).
- Video segments (`.ts`) cached with long TTL (immutable chunks).
- Pull CDN absorbs playback load; origin only serves unique first-time pulls.

---

## Summary

> A Pull CDN lazily populates its cache on demand. It is the industry default for web asset delivery due to low operational overhead, high scalability, and significant origin offload — at the cost of cold-start latency on the first request per edge node. Proper TTL configuration, cache invalidation strategy, and origin shielding are essential for correctness and resilience.