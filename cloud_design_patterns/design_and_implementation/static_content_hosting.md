# Static Content Hosting — Cloud Design Pattern

> **Category:** Design and Implementation
> **Related Patterns:** CDN Offloading, Valet Key, Backends for Frontends, Content Delivery Network

---

## 1. Overview

**Static Content Hosting** is a cloud design pattern that involves deploying static assets (HTML, CSS, JavaScript, images, fonts, videos, PDFs) to a dedicated storage service that can serve them directly to clients — bypassing application servers entirely.

The core insight is that **static content does not require compute**. Routing static files through a web/application server wastes CPU cycles, memory, and incurs unnecessary latency. Instead, blob/object storage services (S3, Azure Blob, GCS) combined with a CDN can serve static assets globally with higher availability, lower cost, and better performance than application servers.

---

## 2. Core Concepts

### 2.1 What is "Static" Content?

| Content Type | Examples | Cacheable? |
|---|---|---|
| Markup | `index.html`, SPA shell | Yes (with versioning) |
| Stylesheets | `.css`, `.scss` compiled | Yes |
| Scripts | `.js`, `.ts` compiled | Yes (fingerprinted) |
| Images | `.png`, `.jpg`, `.webp`, `.svg` | Yes (long TTL) |
| Fonts | `.woff2`, `.ttf`, `.eot` | Yes (very long TTL) |
| Documents | `.pdf`, `.docx` | Yes |
| Media | `.mp4`, `.mp3` | Yes (range requests) |
| Data | `.json`, `.xml` config/manifests | Conditionally |

### 2.2 Why Not Serve from App Server?

```
❌ Without Pattern (App Server Serving Static Files)

Client → Load Balancer → App Server (Node/Java/.NET)
                              │
                        ┌─────┴──────┐
                        │  Business  │
                        │   Logic    │   ← CPU wasted on file I/O
                        └─────┬──────┘
                              │
                         File System / Disk
```

```
✅ With Pattern (Dedicated Static Storage + CDN)

Client ──────────────────────► CDN Edge (PoP, ~5ms)
                                     │
                              (cache hit ~95%)
                                     │
                           Object Storage Origin
                           (S3 / Azure Blob / GCS)

Client ──── API Requests ──► Load Balancer → App Server
                                              (only dynamic work)
```

### 2.3 Key Terminology

- **Object Storage:** Flat-namespace blob storage (S3, GCS, Azure Blob) that can serve files over HTTP/HTTPS with high durability (11 9s) and availability.
- **CDN (Content Delivery Network):** Geographically distributed PoPs that cache and serve static content close to users.
- **Cache Busting / Fingerprinting:** Embedding a content hash in filenames (`app.a3f9c1.js`) to allow long cache TTLs while ensuring users get fresh content on deployments.
- **Origin Pull:** CDN fetches content from the origin (object storage) on cache miss and caches it at the edge.
- **Static Site Generation (SSG):** Pre-building all HTML pages at build time for full static hosting.

---

## 3. Architecture

### 3.1 Reference Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CI/CD PIPELINE                             │
│                                                                     │
│  Source Repo → Build (webpack/vite) → Asset Fingerprinting          │
│                    │                                                │
│                    └──── Upload to Object Storage (S3/GCS/Blob)     │
└────────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
                    ┌────────────────────────────┐
                    │      OBJECT STORAGE        │
                    │  (S3 / GCS / Azure Blob)   │
                    │                            │
                    │  /assets/app.a3f9c1.js     │
                    │  /assets/main.8b2c0d.css   │
                    │  /assets/logo.svg          │
                    │  /index.html               │
                    └──────────────┬─────────────┘
                                   │ Origin Pull
                    ┌──────────────▼─────────────┐
                    │         CDN LAYER          │
                    │  (CloudFront / Akamai /    │
                    │   Fastly / Azure CDN)      │
                    │                            │
                    │  PoP: US-East  PoP: EU     │
                    │  PoP: AP-SE    PoP: SA     │
                    └──────────────┬─────────────┘
                                   │ Cached Response
                         ┌─────────▼──────────┐
                         │      CLIENTS       │
                         │  Browser / Mobile  │
                         └────────────────────┘

      (Dynamic API requests go separately to App Servers)
      Client ──► API Gateway ──► App Servers ──► Databases
```

### 3.2 Deployment Models

#### Model A: Full Static Site (SSG / SPA)
- Entire site is pre-built HTML/JS/CSS
- No server-side rendering at request time
- Best for: Marketing sites, documentation, JAMstack apps
- Examples: Gatsby, Next.js (static export), Hugo, Jekyll

#### Model B: Hybrid (Static Assets + Dynamic API)
- Frontend shell served statically; data fetched from API
- App servers only handle API requests
- Best for: SPAs (React, Vue, Angular), dashboards
- Examples: React SPA on S3 + API Gateway + Lambda

#### Model C: Microsite / White-Label Static Hosting
- Multiple tenants/brands served from same object storage
- Path or subdomain-based routing to different assets
- Best for: Multi-tenant SaaS, white-label platforms

---

## 4. Implementation

### 4.1 AWS Implementation (S3 + CloudFront)

```
S3 Bucket Configuration:
  ├── Static website hosting: ENABLED
  ├── Public access: BLOCKED (access only via CloudFront OAC)
  ├── Versioning: ENABLED (for rollbacks)
  ├── Bucket policy: Allow CloudFront OAC only
  └── CORS: Configured if cross-origin assets needed

CloudFront Distribution:
  ├── Origin: S3 bucket (via Origin Access Control)
  ├── Cache behaviors:
  │     ├── /assets/*  → Cache TTL: 1 year (fingerprinted)
  │     ├── /index.html → Cache TTL: 0 (or short)
  │     └── /*.html    → Cache TTL: 5 minutes
  ├── Compress: ENABLED (gzip/brotli)
  ├── HTTPS: ENFORCED (ACM cert)
  └── Custom error pages: 404 → /index.html (SPA routing)
```

```javascript
// Example: Cache-Control headers strategy
// Fingerprinted assets (hash in filename) — never expire
"Cache-Control": "public, max-age=31536000, immutable"

// HTML files — short cache or no-cache (content changes on deploy)
"Cache-Control": "public, max-age=300, must-revalidate"

// Service worker — never cache
"Cache-Control": "no-cache, no-store, must-revalidate"
```

### 4.2 Azure Implementation (Blob Storage + Azure CDN)

```
Azure Blob Storage:
  ├── Container: $web (static website hosting container)
  ├── Index document: index.html
  ├── Error document: 404.html
  └── Access: Private (CDN access via SAS or public)

Azure CDN (Front Door / Verizon / Akamai):
  ├── Origin: Blob static website endpoint
  ├── Caching rules: Per file extension
  ├── Custom domain + HTTPS
  └── Rules engine: URL rewrite for SPA routing
```

### 4.3 GCP Implementation (GCS + Cloud CDN)

```
GCS Bucket:
  ├── Website configuration: mainPageSuffix = index.html
  ├── allUsers: objectViewer (for public assets)
  └── Backend bucket: linked to HTTP(S) Load Balancer

Cloud CDN:
  ├── Enable on backend bucket
  ├── Cache mode: CACHE_ALL_STATIC (or FORCE_CACHE_ALL)
  └── Signed URLs for private content (Valet Key pattern)
```

### 4.4 Asset Fingerprinting (Cache Busting)

```
Build Pipeline:

Source File          →  Build Tool   →  Output
─────────────────────────────────────────────────
src/app.js           →  Webpack/Vite →  app.[contenthash].js
src/styles.css       →  PostCSS      →  styles.[contenthash].css
public/logo.svg      →  (no hash)    →  logo.svg (stable URL)

Generated HTML references hashed filenames:
<script src="/assets/app.a3f9c1b2.js"></script>
<link rel="stylesheet" href="/assets/styles.7d8e2c.css">
```

### 4.5 SPA (Single Page App) Routing Fix

```
Problem: User navigates to /dashboard/users
→ CDN looks for /dashboard/users/index.html → 404

Solutions:
1. CloudFront custom error: 403/404 → /index.html (200)
2. Nginx try_files: try_files $uri $uri/ /index.html;
3. S3 redirect rules: All 404s → index.html
4. Hash-based routing: /#!/dashboard/users (no server routing)
```

---

## 5. Caching Strategy

### 5.1 Cache TTL by Content Type

```
Asset Type               TTL          Reason
─────────────────────────────────────────────────────────────────────
Hashed JS/CSS bundles    1 year       Content-addressed; safe to cache forever
Hashed images/fonts      1 year       Same rationale
index.html               0–5 min      Entry point; must reflect latest deploy
robots.txt, sitemap      1 hour       Occasionally changes
favicon.ico              1 week       Rarely changes
Videos/large media       24 hours     Large, expensive to re-fetch
API responses (dynamic)  Varies       Depends on data freshness needs
```

### 5.2 Cache Invalidation on Deploy

```
Strategy 1: Fingerprinting (Preferred)
  - Old: app.a3f9c1.js remains at CDN (stale but unreferenced)
  - New: app.b4d8e2.js pushed; index.html updated to reference new hash
  - No invalidation needed — users get new hash from new index.html

Strategy 2: CDN Invalidation (for non-hashed files)
  - CloudFront: Create invalidation for /index.html
  - Cost: $0.005 per invalidation path after 1,000/month free
  - Propagation: ~15–60 seconds globally

Strategy 3: Cache-Control versioning
  - URL: /assets/v2.4.1/styles.css
  - Bump version on deploy; all assets use new path
```

---

## 6. Security

### 6.1 Access Control Models

```
Public Assets (most static sites):
  - All objects public read
  - HTTPS enforced via CDN
  - DDoS protection via CDN (rate limiting, WAF)

Private/Authenticated Assets:
  - Object storage bucket: PRIVATE
  - Access via signed URLs (Valet Key pattern)
  - CDN: Signed cookies / token auth
  - Example: Protected course content, paid media

Hybrid (per-resource auth):
  - Lambda@Edge / Cloudflare Workers intercept requests
  - Validate JWT/session before serving asset
  - Return 403 if unauthorized
```

### 6.2 Security Checklist

```
✅ Block direct S3/GCS/Blob access (force through CDN)
✅ Enforce HTTPS (HTTP → HTTPS redirect at CDN)
✅ Enable CDN WAF (block SQLi, XSS, bad bots)
✅ Set security headers via CDN response headers policy:
    - Content-Security-Policy
    - Strict-Transport-Security (HSTS)
    - X-Content-Type-Options: nosniff
    - X-Frame-Options: DENY
✅ Enable access logging (CDN + origin)
✅ Rotate bucket credentials (prefer IAM roles)
✅ Validate CORS: Only allow trusted origins
```

---

## 7. Performance Optimization

### 7.1 Compression

```
Content Encoding Stack:

At Build Time (preferred):
  - Pre-compress to .gz and .br files
  - Upload both compressed and uncompressed versions
  - S3: Set Content-Encoding header on compressed objects

At CDN (fallback):
  - CloudFront: Compress = true (auto gzip/brotli)
  - Brotli vs gzip: Brotli ~15–25% better compression

Typical savings:
  Resource     Original    Gzip     Brotli
  ─────────────────────────────────────────
  JS bundle    500 KB      170 KB   145 KB
  CSS          120 KB      30 KB    26 KB
  HTML         50 KB       12 KB    10 KB
```

### 7.2 Image Optimization

```
Format Selection:
  Use Case          Format     Notes
  ─────────────────────────────────────────────
  Photos            WebP       ~25-35% smaller than JPEG
  Photos (fallback) JPEG       Universal support
  Logos/Icons       SVG        Vector; scalable
  Icons (many)      SVG sprite Fewer HTTP requests
  Transparency      WebP/PNG   WebP preferred
  Animations        WebP/AVIF  Replace GIF

Responsive Images (srcset):
  <img srcset="img-320w.jpg 320w,
               img-640w.jpg 640w,
               img-1280w.jpg 1280w"
       sizes="(max-width: 640px) 100vw, 50vw"
       src="img-640w.jpg">

CDN-side image transformation (Cloudflare Images, Cloudinary):
  /cdn-cgi/image/width=400,format=webp/assets/hero.jpg
```

### 7.3 HTTP/2 & HTTP/3

```
HTTP/1.1 era (legacy):
  - Max 6 concurrent connections per domain
  - Domain sharding: static1.example.com, static2.example.com
  - File bundling: Concatenate JS/CSS to reduce requests

HTTP/2 era (now):
  - Multiplexing: Many requests on single connection
  - Server push: Send assets before browser asks
  - Domain sharding is HARMFUL (negates multiplexing)
  - Smaller, uncombined files can be beneficial (better caching granularity)

HTTP/3 (QUIC) — emerging:
  - UDP-based; eliminates head-of-line blocking
  - Better on lossy/mobile networks
  - CloudFront, Cloudflare support HTTP/3
```

---

## 8. Trade-offs

### 8.1 Advantages

| Advantage | Detail |
|---|---|
| **Cost reduction** | Object storage (~$0.023/GB/month on S3) is far cheaper than compute. CDN reduces origin egress costs. |
| **Scalability** | Object storage scales to virtually unlimited concurrent requests. No autoscaling config needed. |
| **Performance** | CDN edge nodes serve content in <10ms for cached assets vs. 100–300ms+ for app server round trips. |
| **Availability** | S3 SLA: 99.9%; CloudFront SLA: 99.9%. Object storage is multi-AZ by default. Higher than single-region app servers. |
| **Operational simplicity** | No server patching, capacity planning, or scaling configuration for static content. |
| **Global reach** | CDN PoPs serve users worldwide with low latency without deploying infrastructure in each region. |
| **Separation of concerns** | Static delivery pipeline is fully decoupled from app server deployments. Deploy frontend independently. |
| **Security surface reduction** | App servers don't handle static file requests; reduced attack surface and fewer vulnerabilities to exploit. |

### 8.2 Disadvantages & Limitations

| Disadvantage | Detail | Mitigation |
|---|---|---|
| **No server-side personalization** | Cannot inject user-specific content into static HTML at serving time | Use client-side JS to fetch personalized data post-load; use edge computing (Lambda@Edge) for lightweight personalization |
| **CDN propagation delay** | Cache invalidations take 15–60 seconds to propagate globally | Use fingerprinting (no invalidation needed); use short TTLs for critical files |
| **Cache inconsistency window** | During deployment, some users may get new HTML with old cached assets | Fingerprinting eliminates this; atomic deployments help |
| **Complex routing for SPAs** | CDN doesn't understand SPA client-side routing | Configure custom error pages (404 → index.html) |
| **CORS complexity** | Cross-origin requests for fonts, assets require CORS headers | Configure bucket/CDN CORS policies carefully |
| **Cold start on cache miss** | First request after TTL expiry hits origin; latency spike | Stagger TTLs; use CDN prefetching; pre-warm cache |
| **Storage costs for large media** | Video/audio files at scale add up | Lifecycle policies; archive old assets to Glacier/cold tier |
| **Versioning/rollback complexity** | Old hashed assets accumulate; must purge old versions | Automate lifecycle rules to delete assets older than N days |

### 8.3 Trade-off Summary Table

```
Dimension             Static Hosting       App Server Serving
────────────────────────────────────────────────────────────
Latency               Low (CDN edge)       Higher (origin)
Cost (compute)        Near zero            Significant
Cost (storage)        Low (S3 rates)       Higher (EBS/SSD)
Scalability           Near unlimited       Requires autoscaling
Personalization       None (at serve time) Full (SSR)
SEO (w/o SSG)         Poor (SPA)           Good (SSR)
Deployment speed      Fast (just upload)   App server deploy
Operational overhead  Very low             Higher
```

---

## 9. Anti-Patterns

### 9.1 Serving Static Files Through App Server

```
❌ Anti-Pattern:
  Express.js: app.use(express.static('public'))
  Django: SERVE_STATIC = True in production

  Problem: Every static request consumes app server thread/process,
           burns CPU on file I/O, doesn't benefit from CDN caching,
           and doesn't scale independently of app tier.

✅ Fix: Use WhiteNoise (Django) only for dev; use S3+CloudFront in production.
        Use Nginx/Caddy as a static file server in front of app if CDN not feasible.
```

### 9.2 No Cache Busting

```
❌ Anti-Pattern:
  /assets/app.js → Cache-Control: max-age=31536000
  Deploy new version → users get stale cached file

✅ Fix: Always fingerprint filenames or use versioned paths.
  /assets/app.a3f9c1b2.js → Cache-Control: max-age=31536000, immutable
```

### 9.3 Caching HTML Files Aggressively

```
❌ Anti-Pattern:
  Cache-Control: max-age=86400 on index.html
  Deploy new app version → users get old HTML referencing old hashed assets

✅ Fix:
  index.html: Cache-Control: no-cache (revalidates on every request)
  Hashed assets: Cache-Control: max-age=31536000, immutable
```

### 9.4 Overly Broad CDN Invalidations

```
❌ Anti-Pattern:
  On every deploy: invalidate /* (all paths)
  Problem: Expensive, slow propagation, cache efficiency destroyed

✅ Fix: Only invalidate /index.html and non-fingerprinted files.
        Fingerprinted assets need no invalidation.
```

### 9.5 Serving Large Media Without Range Requests

```
❌ Anti-Pattern:
  Video file served without Accept-Ranges header
  Browser must download entire file before playback begins

✅ Fix:
  Object storage supports Range requests by default
  Ensure CDN passes Accept-Ranges and Range headers
  Use HLS/DASH for adaptive bitrate streaming of large videos
```

---

## 10. Real-World Systems & Applications

### 10.1 Netflix

- **Static assets**: React-based UI shell (HTML/JS/CSS) hosted on S3 + OpenConnect CDN
- **Media**: Video content delivered via Netflix's proprietary CDN (OpenConnect Appliances installed at ISPs)
- **Strategy**: ISP-embedded CDN reduces backbone traffic; assets pre-positioned via predictive caching
- **Scale**: Serves ~15% of global internet traffic at peak; uses S3 for asset storage and pushes to edge nodes nightly based on predicted demand

### 10.2 GitHub

- **Static assets**: CSS, JS, images served via Fastly CDN
- **GitHub Pages**: Entire static site hosting product built on this pattern — Jekyll/Hugo sites compiled and pushed to object storage → served via CDN
- **Asset pipeline**: Ruby/Node build process fingerprints all assets; `github.githubassets.com` is the CDN domain for static assets
- **Lesson**: Separating `github.githubassets.com` from `github.com` ensures static asset failures don't affect API availability

### 10.3 Airbnb

- **Frontend**: React SPA shell served statically; data fetched via API
- **Images**: Property photos stored in S3, served via Akamai CDN with on-the-fly image resizing and WebP conversion
- **Strategy**: Image CDN generates resized/optimized versions on demand and caches them; `a0.muscache.com` serves these images
- **Scale**: Millions of property images globally; CDN absorbs virtually all image traffic

### 10.4 Shopify

- **Merchant storefronts**: Static assets (JS, CSS, theme files) served from `cdn.shopify.com` via Cloudflare CDN
- **Liquid templates**: Rendered server-side, but all referenced static assets served from CDN
- **Media**: Merchant product images processed and stored in GCS, served through Cloudflare with image transformations
- **Multi-tenant insight**: Single CDN domain serves assets for all merchants; path-based or header-based routing distinguishes tenants

### 10.5 Vercel / Netlify (Platform-level Pattern)

- **Core product IS this pattern**: These platforms automate the full static hosting pipeline
- **Vercel**: Git push → build → asset fingerprinting → S3-equivalent storage → 100+ PoP Edge Network
- **Netlify**: Similar pipeline with atomic deploys (swap entire site atomically, eliminating deployment races)
- **Atomic deploys**: Old deploy served until new deploy fully uploaded; then CDN instantly switches; eliminates "mixed version" state
- **Lesson**: Atomic deployments solve the cache inconsistency problem fundamentally

### 10.6 Discord

- **Client assets**: Electron desktop app and web client JS/CSS bundles served from CloudFront
- **Media**: User-uploaded images and attachments stored in S3 and served via `cdn.discordapp.com` (CloudFront)
- **Auto-expiring CDN URLs**: Media URLs include signed expiry tokens (Valet Key pattern) to prevent unauthorized embedding
- **Scale**: Billions of media requests per day; no app server involvement in serving any static asset

### 10.7 AWS S3 Static Website Hosting (Reference Implementation)

- **S3 itself** uses this pattern for serving its own console frontend
- **AWS Amplify** is a productization of this pattern for developers: Git integration → build → S3 → CloudFront, with per-branch preview deployments

---

## 11. Monitoring & Observability

### 11.1 Key Metrics

```
CDN Metrics:
  ├── Cache Hit Ratio (target: >90%)
  │     Low ratio → review TTL settings, check Vary headers
  ├── Requests per second (by PoP)
  ├── Bandwidth (egress from CDN vs. from origin)
  ├── Origin fetch rate (cache misses hitting object storage)
  ├── Error rate (4xx, 5xx by path)
  └── Time-to-first-byte (TTFB) at edge

Object Storage Metrics:
  ├── GET/PUT request count
  ├── Bandwidth (egress)
  ├── Error rates (4xx, 5xx)
  └── Storage size (capacity planning)

End-User Performance:
  ├── Core Web Vitals: LCP, FCP, CLS, TTFB
  ├── Real User Monitoring (RUM) by geography
  └── Asset load times by type
```

### 11.2 Alerting

```
Alert On:
  ├── Cache hit ratio drops below 80% (sudden → check headers; gradual → TTL review)
  ├── Error rate spikes on CDN (deployment gone wrong, origin unavailable)
  ├── Origin fetch rate spikes (cache invalidation storm, TTL misconfiguration)
  ├── LCP > 2.5s for real users in any region
  └── S3/GCS availability incidents (check status pages, failover)
```

---

## 12. Advanced Patterns & Extensions

### 12.1 Edge Computing for Personalization

```
Problem: Static content can't be personalized at serve time.

Solution: Lambda@Edge / Cloudflare Workers runs code at CDN PoPs

Use cases:
  - A/B testing: Rewrite HTML at edge to inject experiment variant
  - Geo-based redirects: /en → /en-gb based on IP geolocation
  - Auth gate: Check JWT in cookie before serving private assets
  - Bot detection: Serve honeypot content to scrapers

Architecture:
  Client → CDN Edge → [Lambda@Edge executes] → Serve modified response
                             ↓ (on miss)
                       Object Storage Origin
```

### 12.2 Multi-Region Static Hosting

```
For disaster recovery and regulatory compliance:

Primary:   us-east-1 (S3 + CloudFront)
Secondary: eu-west-1 (S3 replicated via CRR + separate CloudFront)

S3 Cross-Region Replication (CRR):
  - Automatic async replication of objects
  - RPO: ~minutes (replication lag)
  - Failover: DNS switch (Route 53 health checks) to secondary CDN

Use case: EU GDPR compliance (serve EU users from EU region only)
```

### 12.3 Atomic Deployments

```
Naive deploy (dangerous):
  1. Upload new index.html → CDN serves new HTML
  2. Old JS/CSS still uploading → users get new HTML + old assets = BROKEN

Atomic deploy (safe):
  1. Upload ALL new assets (new hashes) → Not yet referenced
  2. Run smoke tests on new assets
  3. Upload new index.html → Atomically references new assets
  4. Invalidate index.html cache

Platform support: Netlify, Vercel handle this automatically.
```

### 12.4 Progressive Web App (PWA) & Service Workers

```
Service Worker + Static Hosting:
  - Service worker itself must be served with Cache-Control: no-cache
  - Service worker caches static assets in browser cache (offline support)
  - Stale-While-Revalidate: Serve from cache, update in background

IMPORTANT: Service worker update flow must be carefully managed to avoid
users being stuck on old versions. Use workbox for best practices.
```

---

## 13. Decision Framework

### 13.1 When to Use Static Content Hosting

```
✅ Use Static Hosting When:
  - Content is same for all users (or personalized client-side)
  - High read-to-write ratio (assets change infrequently)
  - Global audience requiring low latency
  - Cost optimization is a priority
  - High availability / fault tolerance needed
  - Frontend team wants independent deployment capability
  - JAMstack, SPA, or SSG architecture

❌ Consider App-Server Serving When (rare):
  - Development environment (simplicity trumps optimization)
  - Highly personalized HTML generated server-side per user
  - SSR required for SEO and static pre-rendering not feasible
  - Assets contain sensitive data requiring per-request auth checks
    (though Valet Key / Lambda@Edge can handle this at CDN level)
```

### 13.2 Choosing a CDN

```
CDN               Best For                   Strengths
─────────────────────────────────────────────────────────────────
CloudFront        AWS-native stacks          Deep AWS integration
Cloudflare        General, Workers/edge      Workers ecosystem, free tier
Fastly            Real-time cache purge      Instant invalidation, VCL control
Akamai            Enterprise, media          Largest PoP network, media delivery
Azure CDN         Azure-native stacks        Front Door APIM integration
Google Cloud CDN  GCP-native stacks          Low latency, HTTP/3 support
Vercel Edge       Next.js apps               Zero-config for Next.js
```

---

## 14. Quick Reference Cheat Sheet

```
┌────────────────────────────────────────────────────────────────────┐
│              STATIC CONTENT HOSTING — CHEAT SHEET                  │
├────────────────────────────────────────────────────────────────────┤
│ CORE IDEA: Store static assets in object storage; serve via CDN    │
│            Bypass app servers for static content entirely          │
├────────────────────────────────────────────────────────────────────┤
│ STACK                                                              │
│  AWS:   S3 + CloudFront + ACM (HTTPS) + Route 53                   │
│  Azure: Blob Storage ($web) + Azure Front Door + CDN               │
│  GCP:   GCS + Cloud CDN + HTTPS Load Balancer                      │
│  DIY:   Nginx + Object Storage + Varnish/Fastly                    │
├────────────────────────────────────────────────────────────────────┤
│ CACHE STRATEGY                                                     │
│  Hashed assets (JS/CSS/img): max-age=31536000, immutable           │
│  HTML files:                 no-cache (or max-age=300)             │
│  Never cache:                service-worker.js                     │
├────────────────────────────────────────────────────────────────────┤
│ KEY PRACTICES                                                      │
│  ✅ Always fingerprint/hash asset filenames                        │
│  ✅ Block direct object storage access (force through CDN)         │
│  ✅ Enforce HTTPS everywhere                                       │
│  ✅ Enable compression (brotli > gzip)                             │
│  ✅ Set security headers at CDN level                              │
│  ✅ Monitor cache hit ratio (target >90%)                          │
│  ✅ Use atomic deploys (upload assets before updating index.html)  │
│  ✅ Configure SPA routing (404 → index.html)                       │
├────────────────────────────────────────────────────────────────────┤
│ METRICS TO WATCH                                                   │
│  Cache Hit Ratio | TTFB at Edge | Origin Fetch Rate | LCP          │
├────────────────────────────────────────────────────────────────────┤
│ ANTI-PATTERNS TO AVOID                                             │
│  ❌ Serving static from app server in production                   │
│  ❌ Long TTL on HTML (non-hashed) files                            │
│  ❌ No fingerprinting (cache busting nightmare)                    │
│  ❌ Broad CDN invalidations on every deploy                        │
│  ❌ Exposing bucket directly to internet (bypass CDN)              │
├────────────────────────────────────────────────────────────────────┤
│ REAL-WORLD USERS                                                   │
│  Netflix, GitHub, Airbnb, Shopify, Discord, Vercel, Netlify        │
└────────────────────────────────────────────────────────────────────┘
```