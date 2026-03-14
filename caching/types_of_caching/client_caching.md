# Client Caching

## Overview

Client caching stores data **on the client side** (browser, mobile app, desktop app) to reduce repeated requests to the server. It is the outermost layer of the caching hierarchy — data is served directly from the consumer's device without any network round-trip at all.

The core principle is simple: if a resource hasn't changed, don't fetch it again.

---

## Where Client Caches Live

```
User Device
├── Browser Cache         → HTTP responses (HTML, CSS, JS, images, fonts)
├── Service Worker Cache  → Programmatic, offline-first caching (PWAs)
├── Application Cache     → In-memory state (Redux, Zustand, Apollo Client)
├── Local Storage         → Small key-value persistence (tokens, preferences)
├── IndexedDB             → Structured, queryable persistent storage
└── Cookie Store          → Session data, auth tokens (size-limited ~4KB)
```

---

## HTTP Cache-Control Mechanisms

The primary lever for client caching in web systems is the `Cache-Control` response header.

### Key Directives

| Directive | Meaning |
|---|---|
| `max-age=N` | Cache is fresh for N seconds |
| `s-maxage=N` | Override for shared/proxy caches (CDN) |
| `no-cache` | Must revalidate with server before use |
| `no-store` | Never cache (sensitive data) |
| `immutable` | Resource will never change; skip revalidation |
| `must-revalidate` | After expiry, must revalidate (no stale serving) |
| `stale-while-revalidate=N` | Serve stale, refresh in background for N seconds |
| `stale-if-error=N` | Serve stale if origin errors, for N seconds |
| `private` | Only the end-user's browser may cache (not CDN/proxy) |
| `public` | Any cache (browser, CDN, proxy) may store it |

### Freshness Model

```
Response received → Cache stores it
         │
         ▼
  Is max-age exceeded?
    No → Serve from cache (no network call)
    Yes → Is ETag / Last-Modified available?
           Yes → Conditional request to server
                  304 Not Modified → Serve from cache (headers refreshed)
                  200 OK          → Replace cache entry
           No  → Full request
```

### Validation Headers

| Header | Direction | Purpose |
|---|---|---|
| `ETag: "abc123"` | Server → Client | Fingerprint of resource version |
| `If-None-Match: "abc123"` | Client → Server | "Give me resource only if ETag differs" |
| `Last-Modified: <date>` | Server → Client | Timestamp of last change |
| `If-Modified-Since: <date>` | Client → Server | "Give me resource only if changed since" |

---

## Service Worker Caching (PWA Pattern)

Service Workers sit between the browser and network, acting as a programmable proxy.

### Caching Strategies

| Strategy | Description | Best For |
|---|---|---|
| **Cache First** | Check cache → fallback to network | Static assets (JS, CSS, images) |
| **Network First** | Check network → fallback to cache | Dynamic content, APIs |
| **Stale While Revalidate** | Return cache immediately, update in background | Frequently changing but non-critical data |
| **Cache Only** | Never go to network | Fully offline resources |
| **Network Only** | Never use cache | Auth, payments, real-time data |

```
Cache First Flow:
Request → SW intercepts → Cache hit? → YES → Return cached response
                                     → NO  → Fetch from network → Cache response → Return
```

### Service Worker Lifecycle

```
Install → Activate → Fetch (intercept requests)
   │           │
   ▼           ▼
Cache assets  Clear old caches
(cache.addAll)
```

---

## Application-Level Caching

In-memory caches in client applications (SPA state, mobile app state).

### Patterns

**Normalized Cache (Apollo Client / RTK Query)**
- Stores data by entity ID, not by query
- Multiple queries referencing the same entity auto-update
- Prevents duplicate data in memory

```
Cache Shape (Apollo):
{
  "User:1": { id: 1, name: "Alice", __typename: "User" },
  "User:2": { id: 2, name: "Bob",   __typename: "User" },
  "ROOT_QUERY": {
    "users": [{ __ref: "User:1" }, { __ref: "User:2" }]
  }
}
```

**Time-based Invalidation (React Query / SWR)**
- Each cached query has a `staleTime` (fresh window) and `cacheTime` (GC window)
- `staleTime=0` → always refetch in background on mount
- `staleTime=Infinity` → never auto-refetch (you control invalidation)

**Optimistic Updates**
- Update client cache immediately on user action
- Rollback if server returns error
- Used for perceived performance (likes, follow buttons, form submits)

---

## Storage Mechanism Comparison

| Mechanism | Capacity | Persistence | Queryable | Use Case |
|---|---|---|---|---|
| Memory (JS) | ~100s MB | Until tab close | No | App state, component data |
| Cookie | ~4 KB | Configurable | No | Auth session, tracking |
| Local Storage | 5–10 MB | Until cleared | No | User preferences, tokens |
| Session Storage | 5–10 MB | Tab lifetime | No | Wizard/form state |
| IndexedDB | ~GBs | Until cleared | Yes | Offline app data, large datasets |
| Cache API (SW) | ~GBs | Until cleared | By URL | Static assets, API responses |

---

## Trade-offs

### Advantages

| Benefit | Description |
|---|---|
| **Zero latency** | No network round-trip for cache hits |
| **Reduced server load** | Fewer requests hit origin or even CDN |
| **Offline capability** | Service workers enable fully offline experiences |
| **Bandwidth savings** | Conditional requests send tiny headers instead of full payloads |
| **Improved UX** | Instant navigation and interactions (optimistic updates) |

### Disadvantages & Risks

| Risk | Description | Mitigation |
|---|---|---|
| **Stale data** | Client sees outdated content | Short `max-age`, `stale-while-revalidate`, explicit invalidation |
| **Cache poisoning** | Malicious data stored in cache | HTTPS, careful key design, `Vary` headers |
| **Versioning complexity** | Old caches break after deploys | Content hashing (`app.a3b2f1.js`), cache busting |
| **Privacy leakage** | Sensitive data in shared/persistent cache | `Cache-Control: private, no-store` on auth responses |
| **Memory pressure** | Large caches on low-end devices | LRU eviction, bounded cache sizes |
| **Inconsistency** | Client and server out of sync | Optimistic update rollbacks, polling, WebSockets |

### Key Decisions

```
What to cache on the client?
├── Is the data user-specific?     → Cache-Control: private (not CDN)
├── Does it change frequently?     → Short max-age + stale-while-revalidate
├── Does it never change?          → max-age=31536000 + immutable (versioned URL)
├── Is it sensitive?               → Cache-Control: no-store
└── Does the app need offline?     → Service Worker + Cache API
```

---

## Cache Invalidation Strategies

The hardest problem in client caching is knowing when to bust stale content.

### URL-Based (Content Hashing) — Recommended for Static Assets
```
/static/bundle.js        → /static/bundle.a3f9c2.js
/static/styles.css       → /static/styles.b1e8d7.css
```
- Immutable URLs, served with `max-age=31536000, immutable`
- Deploy new hash → old URLs still cached (fine), new requests get fresh files
- Used by Webpack, Vite, Next.js by default

### Explicit Invalidation (Client Frameworks)
```javascript
// React Query: invalidate after mutation
queryClient.invalidateQueries(['user', userId])

// Apollo Client: evict specific entity
cache.evict({ id: 'User:1' })
cache.gc()
```

### Versioned API Responses
```json
{
  "data": {...},
  "version": "2024-01-15T10:00:00Z"
}
```
Client compares version on next load and invalidates if changed.

### Push-Based Invalidation (WebSocket / SSE)
Server notifies client when data changes → client invalidates specific cache keys.

---

## Vary Header & Cache Segmentation

The `Vary` header tells caches to segment stored responses by request headers.

```
Vary: Accept-Encoding        → Separate caches for gzip vs br
Vary: Accept-Language        → Separate caches per language
Vary: Authorization          → DANGEROUS — creates per-user CDN cache entries
```

**Warning:** `Vary: Authorization` should never be set on CDN-cached resources — it either defeats CDN caching entirely or risks leaking private data. Use `Cache-Control: private` instead.

---

## Real-World Systems & Applications

### Google Chrome Browser Cache
- HTTP cache stores response bodies keyed by URL + method + `Vary` headers
- Disk cache split into index + data files, uses LRU eviction
- `max-age=0, must-revalidate` on HTML; long `max-age` on hashed static assets
- Cache partition (introduced Chrome 86): caches are keyed by (top-level origin, frame origin, URL) to prevent cross-site cache timing attacks

### Gmail (PWA)
- Service Worker caches the full application shell (`index.html`, JS bundles, CSS)
- IndexedDB stores email metadata and bodies for offline reading
- Stale-while-revalidate for inbox — loads instantly from cache, refreshes in background
- Push notifications via service worker trigger cache updates

### Twitter / X — Feed Caching
- Client caches the first N tweets in memory and IndexedDB
- On revisit, renders cached tweets instantly, then appends new tweets from API
- Uses optimistic updates for likes/retweets — local state updated immediately, server write async

### Next.js Applications
- Build step generates content-hashed filenames for all static assets
- `_next/static/` served with `Cache-Control: public, max-age=31536000, immutable`
- `pages/` HTML served with `Cache-Control: no-cache` (always revalidate)
- ISR (Incremental Static Regeneration) uses `stale-while-revalidate` at CDN level

### Netflix — Video Player
- Adaptive bitrate chunks pre-fetched into browser media buffers (client cache)
- App shell cached via Service Worker for near-instant load
- User preferences (playback settings, profiles) stored in Local Storage
- IndexedDB used for downloaded titles on mobile (offline viewing)

### Shopify Storefronts
- Product images served with `max-age=31536000` from CDN with content-addressed URLs
- Cart state cached in Local Storage — persists across sessions until checkout
- Apollo Client normalizes product/variant data to avoid re-fetching on page nav

### GitHub
- File blobs and diffs cached client-side during PR review sessions (memory cache)
- Heavy use of `stale-while-revalidate` for repo metadata
- Service Worker (github.com) caches the application shell for repeat visits

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Caching auth tokens in Local Storage | XSS can steal tokens | Use `HttpOnly` cookies |
| `Cache-Control: no-cache` on static assets | Every request revalidates → wasted RTT | Use content hashing + `immutable` |
| `Vary: *` | Nothing is cacheable | Use specific `Vary` values |
| Caching without considering `Vary: Accept-Encoding` | Compressed/uncompressed mixed | Always include `Accept-Encoding` in Vary |
| Overly aggressive `max-age` on mutable URLs | Users see stale content for days | Hash URLs or use short TTLs |
| Storing large datasets in Local Storage | Synchronous I/O blocks main thread | Use IndexedDB for large data |
| No cache size bounds in app state | Memory leak over long sessions | Implement LRU / max-entry limits |

---

## Monitoring & Metrics

| Metric | Description |
|---|---|
| **Cache Hit Rate** | % of requests served from cache without revalidation |
| **Revalidation Rate** | % of cached responses that trigger conditional requests |
| **Stale Serve Rate** | % of responses served stale (via SWR or error fallback) |
| **Time to First Byte (TTFB)** | Should approach 0ms for cache-first hits |
| **Service Worker Install/Activate Time** | Latency before SW can serve cached responses |
| **Cache Storage Usage** | Total bytes in Cache API and IndexedDB (watch for quota) |
| **Prefetch Hit Rate** | % of prefetched resources actually used |

---

## Decision Framework

```
Designing client caching for a resource?

1. Static asset (JS/CSS/image)?
   → Content hash URL + Cache-Control: public, max-age=31536000, immutable

2. HTML document?
   → Cache-Control: no-cache (revalidate on every nav, use ETag)

3. API response (public data)?
   → max-age appropriate to change frequency + stale-while-revalidate

4. API response (user-specific)?
   → Cache-Control: private, max-age=N (never CDN-cached)

5. Sensitive data (tokens, PII)?
   → Cache-Control: no-store

6. Offline support needed?
   → Service Worker + Cache First for shell + Network First for API

7. High-frequency mutations with instant feedback needed?
   → Optimistic updates in app state cache
```