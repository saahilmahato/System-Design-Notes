# CDN Caching

## What Is CDN Caching?

A **Content Delivery Network (CDN)** is a globally distributed network of proxy servers (called **edge nodes** or **Points of Presence / PoPs**) that cache content close to end users. CDN caching is the mechanism by which these edge nodes store copies of content so that repeated requests are served locally rather than hitting the origin server.

The primary goals are:
- Reduce latency by serving from geographically closer nodes
- Offload traffic from origin servers
- Improve availability and fault tolerance
- Handle traffic spikes without scaling the origin

---

## Core Concepts

### Cache Hit vs. Cache Miss

| Scenario | Description | Outcome |
|---|---|---|
| **Cache Hit** | Edge node has a valid cached copy | Served directly from edge — fast |
| **Cache Miss** | No valid copy on edge node | Request forwarded to origin; response is cached for future requests |
| **Stale Hit** | Cached copy exists but is expired | May be served stale while revalidation happens (depends on config) |

### Cache Key

The unique identifier used to look up a cached object. Typically composed of:
- URL (scheme + host + path)
- Query string (optional — can be stripped or normalized)
- Vary headers (e.g., `Accept-Encoding`, `Accept-Language`)

> **Warning**: Poorly designed cache keys cause cache pollution (too many variants) or incorrect cache sharing (wrong content served to wrong users).

---

## CDN Caching Models

### 1. Pull CDN (Lazy Caching / On-Demand)

- Edge fetches content from origin **on first request** (cache miss)
- Subsequent requests are served from cache
- Cache entries expire via **TTL (Time-To-Live)**

```
User → Edge Node (MISS) → Origin Server
                         ↓
User → Edge Node (HIT)  ← Cached Response
```

**Best for**: Dynamic sites, unpredictable traffic patterns, large asset catalogs where only a subset is popular.

### 2. Push CDN (Pre-Warming / Proactive)

- Content is **pre-loaded** to edge nodes before requests arrive
- No cold-start latency on first request
- Requires explicit invalidation/update workflows

**Best for**: Known high-traffic events (live streams, game launches, flash sales), large static assets delivered globally.

### Comparison

| Dimension | Pull CDN | Push CDN |
|---|---|---|
| First-request latency | High (cache miss) | Low (pre-warmed) |
| Storage efficiency | Good (only popular content cached) | Poor (all content pushed) |
| Operational complexity | Low | High |
| Freshness control | TTL-based | Manual invalidation |
| Use case | General web assets | Scheduled high-traffic events |

---

## Cache Control & Expiry

### HTTP Cache Headers (Origin → CDN)

| Header | Purpose | Example |
|---|---|---|
| `Cache-Control: max-age=<s>` | TTL in seconds | `max-age=86400` (1 day) |
| `Cache-Control: s-maxage=<s>` | CDN-specific TTL (overrides `max-age`) | `s-maxage=3600` |
| `Cache-Control: no-store` | Never cache | Sensitive pages |
| `Cache-Control: no-cache` | Cache but always revalidate | Dynamic content |
| `Cache-Control: private` | Browser cache only, not CDN | User-specific pages |
| `Cache-Control: stale-while-revalidate=<s>` | Serve stale while refreshing async | `stale-while-revalidate=60` |
| `ETag` | Fingerprint for conditional requests | `ETag: "abc123"` |
| `Last-Modified` | Timestamp for conditional requests | Used with `If-Modified-Since` |
| `Vary` | Cache different versions per header | `Vary: Accept-Encoding` |
| `Surrogate-Control` | CDN-specific, stripped before browser | Fastly/Varnish support |

### Revalidation Flow (304 Not Modified)

```
CDN → Origin: GET /image.png
             If-None-Match: "abc123"

Origin → CDN: 304 Not Modified  (no body, just headers)
CDN: extends TTL, serves cached content
```

---

## Cache Invalidation

One of the hardest problems in CDN caching. Strategies:

### 1. TTL Expiry (Passive)
Simplest. Cache entries expire after TTL. No active invalidation needed. Risk: stale content served until expiry.

### 2. Purge / Explicit Invalidation
Send an API call to the CDN to immediately evict a specific URL or tag group.

```
DELETE https://api.cdn.com/cache?url=https://cdn.example.com/logo.png
```

**Drawback**: Expensive at scale; race conditions possible if purge and new request arrive simultaneously.

### 3. Cache-Tag / Surrogate-Key Invalidation
Group related objects under a tag. Invalidate all objects in a group with one call.

```
# Origin response headers:
Surrogate-Key: product-123 category-shoes

# Invalidation:
DELETE https://api.cdn.com/cache/tags/product-123
# Evicts all assets tagged "product-123" across all edge nodes
```

Used by: **Fastly**, **Cloudflare**, **Varnish**.

### 4. Versioned URLs (Cache Busting)
Embed a version hash/timestamp in the asset URL. The old URL stays cached forever; new deployments produce new URLs.

```
/static/app.a3f9c12.js   ← old (cached forever)
/static/app.b7d2e45.js   ← new deployment
```

**Best practice for static assets** (JS, CSS, fonts, images). Zero invalidation cost.

### 5. Immutable Assets + Short TTL for Entry Points
- Static assets: long TTL + versioned URLs
- HTML entry points: short TTL (or no-cache) so users always get latest manifest

---

## What to Cache vs. Not Cache

| Content Type | Cache? | Recommended TTL | Notes |
|---|---|---|---|
| Static assets (JS/CSS/images) | ✅ Yes | 30 days – 1 year | Use versioned URLs |
| Fonts | ✅ Yes | 1 year | Immutable |
| API responses (public) | ✅ Conditionally | Minutes – hours | Only if not user-specific |
| HTML pages (static sites) | ✅ Yes | Minutes – hours | Short TTL or invalidate on deploy |
| Authenticated pages | ❌ No | — | Must not be shared across users |
| User-specific API responses | ❌ No | — | Contains PII/session data |
| One-time tokens / OTPs | ❌ No | — | Security risk |
| Real-time data (prices, stock) | ⚠️ Short | < 60 seconds | Or serve uncached with stale-while-revalidate |

---

## CDN Caching Architecture Patterns

### Static Site with CDN

```
Browser → CDN Edge → Origin (S3 / GCS / Static Host)
                     ↑ Only on cache miss
```
HTML, CSS, JS, images all served from edge. Origin only hit on miss or after invalidation.

### API Response Caching (Edge Caching)

```
Mobile App → CDN Edge → API Gateway → Microservices → DB
                        ↑ Only on miss
```
Public catalog data (product listings, exchange rates) cached at edge. Private/auth endpoints bypass CDN (`Cache-Control: private`).

### Dynamic Caching with ESI (Edge Side Includes)

Fragments of a page are cached independently at the edge and assembled at the edge node.

```html
<esi:include src="/fragment/header" />
<!-- Header: cached for 1 hour -->

<esi:include src="/fragment/user-cart" />
<!-- Cart: not cached (user-specific) -->
```
Used by: **Varnish**, **Akamai**, **Fastly**.

---

## Performance Metrics

| Metric | Description | Target |
|---|---|---|
| **Cache Hit Ratio (CHR)** | `hits / (hits + misses)` | > 90% for static assets |
| **Origin Offload %** | % of requests NOT hitting origin | > 80–95% |
| **Time to First Byte (TTFB)** | Latency from request to first byte | < 50ms (edge hit) |
| **Cache Miss Penalty** | Extra latency on miss (edge → origin RTT) | Monitor; minimize with origin shield |
| **Bandwidth Served** | Total bytes from edge vs. origin | Ratio indicates CDN efficiency |

---

## Trade-offs

### Staleness vs. Freshness

| Dimension | High TTL | Low TTL |
|---|---|---|
| Cache efficiency | ✅ Better hit ratio | ❌ More origin traffic |
| Data freshness | ❌ Stale content risk | ✅ More up-to-date |
| Invalidation cost | Low (passive expiry) | Less relevant |
| **Best for** | Immutable/static assets | Frequently changing data |

### Consistency vs. Availability

- CDN caching makes the system **eventually consistent** — edge nodes may serve stale content until TTL expires or purge completes.
- During CDN outages, falling back to origin maintains **availability** at the cost of latency.
- Choosing a very low TTL increases consistency but reduces the benefit of caching.

### Storage at Edge vs. Granularity

- Too many `Vary` header combinations → cache fragmentation, low CHR
- Too few → wrong content served (e.g., compressed vs. uncompressed)
- Solution: normalize `Accept-Encoding` at the edge layer

### Global Consistency Challenge

Purge propagation across hundreds of PoPs takes time (typically 1–30 seconds). During that window, different users in different regions may see different versions.

### Cache Poisoning (Security)

Malicious or misconfigured requests can poison the cache with bad responses. Mitigate by:
- Normalizing cache keys
- Stripping or validating query strings
- Never caching error responses (5xx) without caution
- Using signed URLs for private content

---

## Origin Shield

An **origin shield** (also called a **CDN shield layer** or **mid-tier cache**) is an additional caching layer between edge PoPs and the origin.

```
Edge Node (PoP) → Origin Shield → Origin Server
```

- Collapses cache misses from many edge nodes into one request to origin
- Dramatically reduces origin load on cold starts or after invalidation
- Adds one extra hop on miss (minor latency increase)

Used by: **Cloudflare Tiered Cache**, **Fastly Shielding**, **AWS CloudFront Origin Shield**.

---

## Real-World Systems & Applications

### Netflix
- Uses **Open Connect** (their own CDN) with thousands of ISP-embedded appliances
- Pre-positions popular titles to edge nodes during off-peak hours (Push CDN model)
- Serves > 99% of streaming traffic from edge; origin barely touched during playback
- Cache key: content ID + quality level + segment number

### GitHub
- Static assets (JS, CSS, images) served via CDN with versioned URLs and 1-year TTL
- `raw.githubusercontent.com` uses CDN with short TTL for repo file access
- Deploy pipeline triggers cache purge on new releases

### Shopify
- Product images and theme assets cached at CDN edge with long TTLs
- Store HTML pages use short TTLs or `stale-while-revalidate` for near-real-time inventory
- Uses **surrogate keys** tied to product IDs for surgical invalidation on inventory updates

### Cloudflare (as both CDN and customer example)
- Serves ~20% of all internet traffic from edge cache
- **Cache Rules**: fine-grained per-URL caching logic at edge
- **Workers**: run JS at edge to modify cache behavior dynamically
- **Cache Reserve**: persistent cache using R2 storage to avoid origin misses even for rarely-accessed content

### Akamai (media streaming)
- Used by major broadcasters (Disney+, ESPN)
- Adaptive bitrate manifests cached with very short TTLs (~5–10s)
- Video segments cached with long TTLs; CDN handles origin shield to reduce origin load

### Stack Overflow
- Heavily caches Q&A page HTML at CDN edge
- Uses `Surrogate-Key` headers tied to question IDs; invalidates on edit/new answer
- Cache hit ratio > 97% for public pages

---

## Decision Framework

```
Is the content user-specific or authenticated?
  YES → Do NOT cache at CDN. Use Cache-Control: private.
  NO  ↓

Does the content change frequently?
  YES → Short TTL (< 5 min) + stale-while-revalidate OR bypass CDN
  NO  ↓

Is the content versioned at the URL level?
  YES → Long TTL (1 year), no invalidation needed (cache busting)
  NO  ↓

Can you tag content with surrogate keys?
  YES → Long TTL + surrogate-key purge on change
  NO  → Moderate TTL + monitor staleness tolerance
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Caching authenticated responses | Data leaks across users | Always set `Cache-Control: private` for auth'd content |
| No cache-busting for static assets | Stale JS/CSS after deploy | Use content-hash in filenames |
| Caching 5xx errors | Amplifies outage; users stuck | Set `Cache-Control: no-store` on error responses |
| Over-using `Vary: *` | Caches nothing effectively | Use specific `Vary` headers; normalize at edge |
| Setting TTL = 0 for everything | CDN becomes a pass-through | Identify cacheable content explicitly |
| Purging entire cache on deploy | Origin storm (thundering herd) | Use versioned URLs; purge only changed assets |
| Ignoring origin shield | High origin load on edge misses | Enable origin shield for media/large-scale systems |

---

## Monitoring & Observability

- **Cache Hit Ratio**: Per PoP and globally; alert if CHR drops suddenly
- **Origin Request Rate**: Spike = CDN ineffective or invalidation storm
- **TTFB by region**: Identifies slow edge nodes or origin routing issues
- **Purge latency**: Time to propagate invalidation across all PoPs
- **Stale content rate**: Track how often `stale-while-revalidate` is triggered
- **Error rate by cache status**: Differentiate origin errors from edge errors

---

## Summary

| Concern | Recommendation |
|---|---|
| Static assets | Versioned URLs + max-age 1 year |
| Public API responses | `s-maxage` + surrogate-key invalidation |
| User-specific content | `Cache-Control: private`; never CDN-cache |
| Freshness on deploy | Versioned URLs (static) + short TTL (HTML) |
| Origin protection | Enable origin shield |
| Cache invalidation | Prefer versioned URLs > surrogate keys > purge > low TTL |