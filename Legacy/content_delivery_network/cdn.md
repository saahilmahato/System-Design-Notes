# CDN — Content Delivery Network

---

## What Is a CDN?

A **Content Delivery Network (CDN)** is a geographically distributed network of proxy servers (called **edge nodes** or **Points of Presence / PoPs**) that cache and serve content to users from locations physically closer to them, reducing latency and offloading traffic from the **origin server**.

---

## Core Concepts

### Origin Server
The central server that holds the canonical/master version of the content. CDN nodes pull from or are pushed content from the origin.

### Edge Node / PoP (Point of Presence)
Individual servers placed in data centers across geographic regions. They store cached copies of content and serve end users.

### Cache
A temporary store of content at the edge. CDNs cache **static assets** (images, JS, CSS, videos, fonts) and sometimes **dynamic content**.

### Cache Key
Usually a combination of the URL, request headers (e.g., `Accept-Encoding`, `Accept-Language`), and cookies. Determines what counts as a "cache hit."

---

## How It Works

```
User Request
     │
     ▼
DNS Resolution  ──►  CDN Anycast IP  ──►  Nearest Edge PoP
                                               │
                                    ┌──────────┴──────────┐
                                    │                     │
                               Cache HIT             Cache MISS
                                    │                     │
                              Serve from            Forward to
                               edge cache           Origin Server
                                                         │
                                                   Cache response
                                                   at edge for
                                                   future requests
```

1. User's DNS query resolves to the nearest CDN PoP (via **Anycast** or **GeoDNS**).
2. If content is cached (**cache hit**), serve immediately from edge.
3. If not cached (**cache miss**), CDN fetches from origin, caches it, then serves to user.

---

## Types of CDN Delivery

| Type | Description | Use Case |
|---|---|---|
| **Pull CDN** | Edge fetches content from origin on first request, caches it | Static websites, general web assets |
| **Push CDN** | Content is manually pushed/uploaded to CDN in advance | Large files, video-on-demand, known assets |
| **Streaming CDN** | Specialized for live or on-demand video (HLS/DASH protocols) | Netflix, Twitch, YouTube |
| **Security CDN** | CDN that also acts as a WAF, DDoS shield | Cloudflare, Akamai security layer |

---

## What CDNs Cache

**Typically Cached (Static)**
- Images, videos, audio
- CSS, JavaScript, HTML files
- Fonts
- PDFs, downloadable files
- API responses (with short TTLs)

**Typically NOT Cached (Dynamic)**
- User-specific data (shopping cart, dashboards)
- Real-time data (stock prices, live scores)
- POST/PUT/DELETE request responses
- Authenticated personalized content *(unless using edge computing/personalization logic)*

---

## Key CDN Features

### 1. Caching and TTL (Time-to-Live)
- Controlled via HTTP headers: `Cache-Control`, `Expires`, `ETag`, `Last-Modified`
- `Cache-Control: max-age=86400` → cache for 24 hours
- `Cache-Control: no-store` → never cache
- **Cache Invalidation**: Purge specific files or entire cache on deployment

### 2. Anycast Routing
Multiple edge nodes share the same IP address. The network routes the user to the nearest one automatically. Provides both **low latency** and **DDoS resilience**.

### 3. TLS Termination at the Edge
CDN handles SSL/TLS handshakes at the edge node, reducing round-trip latency for HTTPS connections to origin.

### 4. HTTP/2 and HTTP/3 (QUIC) Support
CDNs upgrade connections between user ↔ edge to modern protocols even if origin only supports HTTP/1.1.

### 5. Edge Computing / Edge Functions
Run code at the CDN edge (e.g., Cloudflare Workers, Lambda@Edge). Used for:
- A/B testing
- Auth token validation
- Request/response transformation
- Personalization without hitting origin

### 6. Origin Shield
An intermediate caching layer between edge PoPs and origin. Reduces the number of cache-miss requests hitting the origin directly.

```
Edge PoP (Tokyo)  ─┐
Edge PoP (Seoul)  ─┼──►  Origin Shield  ──►  Origin Server
Edge PoP (Sydney) ─┘        (single region)
```

---

## Cache Invalidation Strategies

| Strategy | How It Works | Trade-off |
|---|---|---|
| **TTL Expiry** | Cache auto-expires after set time | Simple but may serve stale content |
| **Manual Purge** | Explicitly purge on deploy | Precise but requires operational discipline |
| **Cache-busting URLs** | Append version hash to filename (e.g., `app.a3f2c1.js`) | Guaranteed freshness, old URLs remain valid |
| **Surrogate Keys / Cache Tags** | Tag related resources, purge by tag | Powerful but vendor-specific |

---

## Trade-offs

### ✅ Advantages

- **Reduced Latency**: Content served from geographically closer nodes. Can reduce TTFB (Time to First Byte) from hundreds of ms to single-digit ms.
- **Reduced Origin Load**: Cache hits never hit the origin server. Enables origin servers to handle far less traffic.
- **Scalability**: CDNs can absorb massive traffic spikes (e.g., a viral video, a product launch) without scaling the origin.
- **High Availability**: If one PoP fails, traffic reroutes to another. Reduces single point of failure.
- **DDoS Mitigation**: Distributed architecture absorbs volumetric attacks across many nodes. Many CDNs include WAF and rate limiting.
- **Bandwidth Cost Savings**: Egress from CDN edge is typically cheaper than egress from your own data center or cloud provider.
- **Built-in HTTPS / TLS**: CDN handles certificate management and TLS termination out-of-the-box.

---

### ❌ Disadvantages / Costs

- **Cache Staleness**: Users may receive outdated content until TTL expires or manual purge is done. Getting cache invalidation wrong is a notoriously hard problem.
- **Cache Miss Penalty**: First request to a cold edge still hits origin — in some cases adding latency vs. direct origin access.
- **Cost at Scale**: High traffic volumes on premium CDNs (Akamai, Fastly) can be expensive. Requires careful cost modeling.
- **Complexity**: Adds another layer to debug. Cache-related bugs (serving stale HTML, wrong locale, cached auth responses) are subtle and painful to diagnose.
- **Not Suitable for Highly Dynamic Content**: Pure real-time or user-specific content gets no benefit from caching.
- **Vendor Lock-in**: CDN-specific features (edge workers, cache tags, WAF rules) make migration to another vendor non-trivial.
- **Data Residency / Compliance Concerns**: Content may be cached in jurisdictions with different data laws (GDPR implications for EU data cached in the US).
- **Limited Control Over Edge Infrastructure**: You cannot fully control hardware, software versions, or routing decisions at edge nodes.

---

### Key Tension Points

| Tension | Description |
|---|---|
| **Freshness vs. Performance** | Longer TTLs = better performance, but more stale content risk |
| **Cache Hit Rate vs. Personalization** | Higher personalization = lower cache hit rate |
| **Cost vs. Coverage** | More PoPs = lower latency globally, but higher cost |
| **Security vs. Cacheability** | Authenticated/encrypted responses are harder to cache safely |

---

## Performance Metrics to Monitor

- **Cache Hit Ratio (CHR)**: `cache hits / (cache hits + cache misses)`. Target >90% for static-heavy workloads.
- **Time to First Byte (TTFB)**: Should drop significantly with CDN for cached content.
- **Origin Offload %**: Percentage of total requests served from edge (not origin).
- **Latency by Region**: Validate that PoP coverage matches your user geography.
- **Error Rate at Edge**: 5xx errors can indicate origin health issues or misconfigured CDN rules.

---

## Real-World Systems & Applications

### 1. **Netflix**
- Uses a custom CDN called **Open Connect**. Netflix ships physical appliances directly to ISP data centers to cache popular content at the network's edge.
- During peak hours, ~95% of Netflix traffic is served from Open Connect appliances, dramatically reducing backbone internet traffic.
- Uses **push-based** pre-population: content is pushed to appliances overnight during low-traffic hours.

### 2. **Cloudflare**
- One of the world's largest CDNs with 300+ PoPs globally.
- Serves both CDN and security (DDoS, WAF, Bot Management) from the same network.
- **Cloudflare Workers** allows running JavaScript at the edge, enabling dynamic logic without hitting origin at all.
- Used by Discord, Shopify, Canva, and millions of others.

### 3. **Amazon CloudFront**
- AWS's CDN, deeply integrated with S3, EC2, API Gateway, and Lambda.
- **Lambda@Edge** and **CloudFront Functions** allow edge compute.
- Used to serve static assets for apps on AWS, video streaming, and API acceleration.
- Common pattern: S3 (origin) + CloudFront (CDN) for serving SPAs (Single Page Applications).

### 4. **YouTube / Google**
- Google's global network (one of the largest private networks on Earth) acts as a CDN for YouTube.
- **Google Global Cache (GGC)**: Similar to Netflix Open Connect — Google installs cache servers at ISPs to serve YouTube videos locally.
- Videos are transcoded into multiple bitrates and formats (HLS/DASH) and distributed across edge nodes.

### 5. **Akamai**
- One of the oldest and largest CDNs, founded in 1998.
- Used heavily by government websites, media companies, and enterprises.
- Serves a significant portion of global web traffic. Powers sites like Apple, Microsoft, and major financial institutions.
- Known for sophisticated **edge logic** and **media streaming** capabilities.

### 6. **Shopify**
- Uses CDN to serve storefronts globally at low latency for millions of merchants.
- Static assets (product images, JS, CSS) are cached aggressively via CDN.
- Uses Cloudflare and custom infrastructure to handle massive traffic spikes during flash sales.

### 7. **GitHub Pages / Vercel / Netlify**
- Static site hosting platforms that are essentially CDN-first architectures.
- Every deploy pushes assets to edge nodes globally. No traditional origin server for static content.
- Vercel's **Edge Network** and **Edge Functions** are built on CDN infrastructure with compute capabilities.

---

## Common System Design Patterns Using CDNs

### Static Asset Serving (SPA / Jamstack)
```
Browser → CloudFront → S3 Bucket (origin)
              │
         Cache HTML, JS, CSS, images
         with long TTLs + cache-busting hashes
```

### API Acceleration / Edge Caching
```
Client → CDN Edge → API Gateway → Microservices
              │
         Cache GET responses with
         short TTLs (e.g., 60s) for
         semi-dynamic data (product listings, etc.)
```

### Video Streaming
```
Client → CDN Edge → Origin (video encoding service / S3)
              │
         Segment-level caching
         (HLS .ts segments, DASH chunks)
         Adaptive bitrate manifests cached separately
```

### Multi-Region with Origin Failover
```
CDN Edge
    │
    ├──► Primary Origin (us-east-1)  [healthy]
    │
    └──► Failover Origin (eu-west-1) [on failure]
```

---

## When to Use a CDN

| Use a CDN When... | Skip / Reconsider When... |
|---|---|
| Serving static assets (images, CSS, JS) | Content is 100% real-time and non-cacheable |
| Users are globally distributed | All users are in a single local region |
| Traffic is bursty or unpredictable | Origin can handle all load comfortably |
| You need DDoS protection | You have strict data sovereignty requirements |
| Reducing origin infrastructure cost | Budget doesn't justify CDN spend |

---

## Summary

A CDN is a **foundational infrastructure component** for any system that serves content at scale to distributed users. It trades **consistency** (caching means potential staleness) for **performance, availability, and cost efficiency**. The best CDN designs combine smart TTL policies, cache-busting for deployments, origin shielding, and edge compute for the rare cases where you need dynamic logic without origin round-trips.

> **The hardest problem in CDN design is cache invalidation — know your invalidation strategy before you set your TTLs.**