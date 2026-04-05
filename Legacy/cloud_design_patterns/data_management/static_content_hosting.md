# Static Content Hosting Pattern
> Cloud Design Patterns → Data Management

---

## 1. Overview

The **Static Content Hosting Pattern** separates static assets (HTML, CSS, JavaScript, images, fonts, videos, documents) from dynamic application logic and serves them **directly from a storage service or CDN** — eliminating the web/app server from the static asset delivery path entirely.

Static assets are **pre-generated at build time**, do not require server-side computation per request, and can be cached aggressively at the edge. Serving them through an application server wastes compute, introduces latency, and creates unnecessary scaling bottlenecks.

> **Core Principle:** If a response is identical for every user and does not depend on runtime state, it should never pass through an application server.

---

## 2. What Counts as "Static"

| Static (serve from storage/CDN)          | Dynamic (must hit app server)              |
|------------------------------------------|--------------------------------------------|
| HTML shell / SPA index.html              | User-specific API responses                |
| Compiled JS bundles (`main.abc123.js`)   | Authentication flows                       |
| CSS stylesheets                          | Payment processing                         |
| Images, icons, SVGs                      | Database queries                           |
| Fonts (`.woff2`, `.ttf`)                 | Session management                         |
| Pre-rendered HTML pages (SSG)            | Server-side rendered pages (SSR)           |
| PDF, DOCX, XLSX downloads                | Real-time WebSocket streams                |
| Video/audio files                        | Personalized content                       |
| `robots.txt`, `sitemap.xml`             | A/B test variant logic                     |
| OpenAPI / JSON schema files              | Feature flag evaluation per user           |

---

## 3. Architecture

### 3.1 Naive Architecture (Anti-Pattern)
```
User ──── HTTP GET /logo.png ──▶ Load Balancer
                                       │
                                  App Server
                                  (reads file
                                   from disk,
                                   streams bytes,
                                   wastes CPU/RAM)
                                       │
                                  returns logo.png
```
Problems: compute wasted, does not scale independently, no geo-distribution, high latency for distant users.

---

### 3.2 Static Content Hosting with Object Storage
```
User ──── HTTP GET /logo.png ──▶ Object Storage (S3 / GCS / Azure Blob)
                                  (serves directly, no app server)
```
Simple but no geo-distribution. Works for internal tools or single-region apps.

---

### 3.3 Static Content Hosting with CDN (Production Standard)
```
                        ┌──────────────────────────────────────┐
                        │           CDN Edge Network           │
                        │  ┌────────┐  ┌────────┐  ┌────────┐ │
                        │  │ Edge   │  │ Edge   │  │ Edge   │ │
                        │  │ Node   │  │ Node   │  │ Node   │ │
                        │  │ (US)   │  │ (EU)   │  │ (APAC) │ │
                        │  └───┬────┘  └───┬────┘  └───┬────┘ │
                        └──────┼───────────┼───────────┼──────┘
                               │           │           │
                        Cache miss only    │           │
                               │           │           │
                        ┌──────▼───────────▼───────────▼──────┐
                        │         Origin Storage               │
                        │  (S3 / GCS / Azure Blob / GitHub     │
                        │   Pages / Netlify / Vercel)          │
                        └──────────────────────────────────────┘

User (US) ──▶ CDN Edge (US) ──▶ cache hit ──▶ serves instantly
User (EU) ──▶ CDN Edge (EU) ──▶ cache hit ──▶ serves instantly
```

---

### 3.4 Hybrid Architecture (Static + Dynamic)
```
                        ┌─────────────┐
Browser ────────────────▶  CDN / Edge │
                        │             │
                Static  │  /static/*  │──▶ Object Storage (S3)
                assets  │  /*.js      │
                        │  /*.css     │
                        │  /images/*  │
                        │             │
                Dynamic │  /api/*     │──▶ Load Balancer ──▶ App Servers
                requests│  /auth/*    │                       │
                        │             │                  Database / Cache
                        └─────────────┘
```
The CDN acts as a **unified entry point**, routing by path prefix. Users always hit the same domain; routing is transparent.

---

### 3.5 CI/CD Build and Deploy Pipeline
```
Code Push (Git)
      │
      ▼
CI Pipeline (GitHub Actions / CircleCI / Jenkins)
      │
      ├── Run Tests
      ├── Build (npm run build / webpack / vite)
      │       │
      │       └── Generates: dist/
      │             ├── index.html
      │             ├── main.a1b2c3.js   ← content-hashed
      │             ├── styles.d4e5f6.css
      │             └── assets/
      │
      ├── Upload to Object Storage (S3 / GCS)
      │       └── Set Cache-Control headers per file type
      │
      └── Invalidate CDN Cache
              └── Purge stale assets from all edge nodes
```

---

## 4. Caching Strategy

Caching is the primary lever for performance in static hosting. Getting cache headers wrong is the most common operational mistake.

### 4.1 Cache-Control Header Strategy

```
File Type                Cache-Control                         Reasoning
────────────────────────────────────────────────────────────────────────────────
index.html               no-cache (or max-age=0)              Re-validate every time;
                                                               it references hashed assets
main.a1b2c3.js           max-age=31536000, immutable          Content-hashed; safe to
(hashed bundles)                                               cache forever
styles.d4e5f6.css        max-age=31536000, immutable          Same as above
logo.png (versioned)     max-age=31536000, immutable          Versioned filename = safe
favicon.ico              max-age=86400                        Changes rarely; 1 day fine
robots.txt               max-age=3600                         May change; short TTL
fonts/*.woff2            max-age=31536000, immutable          Fonts never change for a version
```

**Key insight:** Content-based hashing (fingerprinting) is what makes `immutable` safe. The filename changes when the content changes, so the browser fetches the new file while old files stay cached.

### 4.2 Cache Invalidation Approaches

| Strategy                     | How It Works                                               | Use Case                        |
|------------------------------|------------------------------------------------------------|---------------------------------|
| **Content hashing**          | Filename includes hash of content; new content = new URL  | JS/CSS bundles (best practice)  |
| **Version path prefix**      | `/v2.1.0/assets/main.js`                                  | API schemas, versioned SDKs     |
| **CDN cache purge/API**      | Explicit API call to invalidate specific paths or patterns| `index.html`, emergency rollback|
| **Cache-busting query param**| `?v=20240601`                                             | Simple setups; not recommended  |
| **Short TTL**                | Set `max-age=60`; expires quickly                         | Frequently-changing but static  |

---

## 5. Platform Implementations

### 5.1 AWS — S3 + CloudFront
```
S3 Bucket (origin)
  └── Static website hosting enabled
  └── Bucket policy: public read for /assets/*

CloudFront Distribution
  ├── Origin: S3 bucket (or S3 website endpoint)
  ├── Behaviors:
  │     /index.html         → TTL: 0 (no cache)
  │     /assets/*           → TTL: 31536000
  │     /api/*              → Forward to ALB (no cache)
  ├── HTTPS: ACM certificate
  ├── Custom domain: app.yoursite.com
  └── Lambda@Edge / CloudFront Functions:
        - Rewrite /about → /about/index.html (SPA routing)
        - Add security headers
        - A/B routing by cookie
```

#### Terraform Snippet
```hcl
resource "aws_s3_bucket" "static_site" {
  bucket = "myapp-static-assets"
}

resource "aws_cloudfront_distribution" "cdn" {
  origin {
    domain_name = aws_s3_bucket.static_site.bucket_regional_domain_name
    origin_id   = "S3-myapp-static"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.oai.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-myapp-static"

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
    compress               = true
  }

  enabled             = true
  default_root_object = "index.html"
}
```

---

### 5.2 Azure — Blob Storage + Azure CDN / Front Door
```
Azure Storage Account
  └── $web container (static website hosting)
  └── Custom 404 page: 404.html

Azure Front Door (CDN + Global Load Balancer)
  ├── Origin: storage account endpoint
  ├── Rules Engine:
  │     - Rewrite URL for SPA fallback
  │     - Add HSTS, X-Frame-Options headers
  ├── Caching Rules:
  │     /assets/* → cache 1 year
  │     /*.html   → no cache
  └── WAF Policy: OWASP ruleset
```

```bash
# Deploy to Azure Static Web Apps
az staticwebapp create \
  --name myapp \
  --resource-group myRG \
  --source https://github.com/org/repo \
  --location "East US 2" \
  --branch main \
  --app-location "/" \
  --output-location "dist"
```

---

### 5.3 GCP — Cloud Storage + Cloud CDN
```bash
# Create bucket
gsutil mb gs://myapp-static

# Enable website configuration
gsutil web set -m index.html -e 404.html gs://myapp-static

# Make public
gsutil iam ch allUsers:objectViewer gs://myapp-static

# Upload with cache headers
gsutil -h "Cache-Control:public,max-age=31536000,immutable" \
  rsync -r dist/assets/ gs://myapp-static/assets/

gsutil -h "Cache-Control:no-cache" \
  cp dist/index.html gs://myapp-static/index.html
```

---

### 5.4 Managed Platforms (Vercel / Netlify / Cloudflare Pages)

These platforms abstract the storage + CDN stack entirely:

| Platform              | Storage Origin     | CDN                     | Key Features                            |
|-----------------------|--------------------|-------------------------|-----------------------------------------|
| **Vercel**            | Vercel Blob        | Vercel Edge Network     | Preview deployments, Edge Functions     |
| **Netlify**           | Netlify CDN        | Global CDN              | Form handling, Identity, Edge Functions |
| **Cloudflare Pages**  | Cloudflare R2      | Cloudflare CDN          | Workers integration, unlimited bandwidth|
| **GitHub Pages**      | GitHub servers     | Fastly CDN              | Free for public repos, limited features |

```yaml
# vercel.json — route configuration
{
  "routes": [
    { "src": "/assets/(.*)", "headers": { "cache-control": "public, max-age=31536000, immutable" } },
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

---

## 6. SPA Routing Challenge

Single Page Applications (React, Vue, Angular) handle routing client-side. Object storage returns a `404` for deep links like `/dashboard/settings` because no physical file exists at that path.

### Solutions

**Option A: Rewrite all paths to index.html (CDN rule)**
```
# CloudFront Error Pages config
404 → /index.html (200 response)
403 → /index.html (200 response)
```

**Option B: Edge Function rewrite**
```javascript
// Cloudflare Worker
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // API requests pass through
  if (url.pathname.startsWith('/api/')) {
    return fetch(request);
  }
  
  // Static assets pass through
  if (url.pathname.match(/\.(js|css|png|jpg|svg|woff2|ico)$/)) {
    return fetch(request);
  }
  
  // Everything else → index.html (SPA routing)
  return fetch(new Request(new URL('/index.html', request.url)));
}
```

**Option C: Hash-based routing** (`/#/dashboard/settings`) — avoids the problem entirely but produces ugly URLs. Generally avoid in modern apps.

---

## 7. Security Headers

Static hosting doesn't automatically add security headers. They must be configured at the CDN layer.

```
Header                          Value                              Purpose
─────────────────────────────────────────────────────────────────────────────────────
Strict-Transport-Security       max-age=31536000; includeSubDomains  Force HTTPS
Content-Security-Policy         default-src 'self'; script-src ...  XSS protection
X-Content-Type-Options          nosniff                            Prevent MIME sniffing
X-Frame-Options                 DENY                               Clickjacking protection
Referrer-Policy                 strict-origin-when-cross-origin    Referrer control
Permissions-Policy              camera=(), microphone=()           Feature policy
```

```javascript
// CloudFront Function (viewer response)
function handler(event) {
  var response = event.response;
  var headers = response.headers;

  headers['strict-transport-security'] = { value: 'max-age=31536000; includeSubDomains' };
  headers['x-content-type-options']    = { value: 'nosniff' };
  headers['x-frame-options']           = { value: 'DENY' };
  headers['referrer-policy']           = { value: 'strict-origin-when-cross-origin' };

  return response;
}
```

---

## 8. Performance Optimizations

### 8.1 Asset Compression
```
Format          Compression     Browser Support     Use For
──────────────────────────────────────────────────────────
Brotli (br)     ~20% better     Modern browsers     JS, CSS, HTML, SVG
Gzip            Widely supported All browsers        Fallback
Pre-compressed  Serve .br/.gz   CDN-level serving   Eliminates on-the-fly compression cost
```

### 8.2 Image Optimization
```
Format      Use Case                        Advantage
──────────────────────────────────────────────────────────
WebP        Photos, complex images          30-50% smaller than JPEG/PNG
AVIF        Photos (modern browsers only)   50% smaller than JPEG
SVG         Icons, logos, illustrations     Resolution-independent, tiny
PNG         Transparency, screenshots       Lossless
JPEG        Photographs (legacy)            Wide support
```

- Serve **responsive images** with `srcset` and `sizes` attributes
- Use **lazy loading** (`loading="lazy"`) for below-the-fold images
- Use a CDN image transformation service (CloudFront + Lambda@Edge, Cloudflare Images, Imgix)

### 8.3 Bundle Optimization
```
Technique               Impact
──────────────────────────────────────────────────────────
Code splitting          Deliver only what the current page needs
Tree shaking            Eliminate dead code from bundles
Dynamic imports         Load modules on demand
Minification            Remove whitespace, shorten variable names
Source maps             Separate file; only loaded by DevTools
Scope hoisting          Webpack/Rollup: flatten module graph
```

---

## 9. Trade-offs

### 9.1 Advantages

| Advantage                          | Detail                                                                      |
|------------------------------------|-----------------------------------------------------------------------------|
| **Massively scalable**             | Object storage + CDN scales to millions of concurrent downloads natively    |
| **Low latency**                    | Edge nodes serve from geographic proximity to the user                      |
| **Low cost**                       | Storage + CDN transfer is orders of magnitude cheaper than compute          |
| **High availability**              | CDN edge nodes provide redundancy; origin outage doesn't affect cached hits |
| **Reduced app server load**        | App servers only handle dynamic/API traffic                                 |
| **Simpler deployment**             | Static assets are immutable; deployments are atomic file uploads            |
| **No cold start**                  | No server to spin up; immediate response from edge cache                    |
| **DDoS resilience**                | CDN absorbs volumetric attacks across distributed edge capacity             |

### 9.2 Disadvantages

| Disadvantage                        | Detail                                                                     |
|-------------------------------------|----------------------------------------------------------------------------|
| **No runtime personalization**      | Cannot inject per-user data into truly static files                       |
| **Stale cache problem**             | Cache invalidation must be explicitly triggered after each deployment     |
| **SPA routing complexity**          | Requires CDN rewrite rules or hash-based routing workarounds              |
| **Build-time dependency**           | Any content change requires a rebuild and redeploy (no live edits)        |
| **CORS configuration required**     | Cross-origin fonts, scripts, and APIs require careful header setup        |
| **Security header management**      | Must be configured at CDN layer, not baked in automatically               |
| **Consistency lag**                 | CDN cache propagation delay means different edge nodes may serve different versions briefly |
| **Not suitable for highly dynamic content** | Pages that change per-request cannot benefit from static hosting  |

### 9.3 Hybrid Personalization Workarounds

When you need personalization with static hosting:
- **Edge Functions / Workers**: Run JS at the CDN edge to inject user-specific data (Cloudflare Workers, Lambda@Edge, Vercel Edge Functions)
- **Client-side hydration**: Serve static shell → fetch personalized data via API after load
- **ISR (Incremental Static Regeneration)**: Regenerate specific pages on demand at CDN (Next.js / Vercel)
- **Partial hydration / Islands architecture**: Static framework with small dynamic islands (Astro, Qwik)

---

## 10. Real-World Systems & Applications

### 10.1 GitHub Pages
- Hosts documentation sites, personal portfolios, and project sites directly from a Git repo
- Jekyll builds static HTML from Markdown at push time; Fastly CDN serves the output
- No server-side computation; entire experience is static

### 10.2 Netlify
- Pioneered the **Jamstack** (JavaScript + API + Markup) architecture
- Build pipeline generates static assets, deploys to globally distributed CDN
- Used by: Smashing Magazine, Figma's docs, HashiCorp docs

### 10.3 Facebook (Static Resources)
- Facebook separates its static asset delivery from application logic at massive scale
- JS/CSS bundles are content-hashed, versioned, and served from `static.xx.fbcdn.net` (Fastly/custom CDN)
- Facebook reports static assets account for the majority of bytes transferred to users

### 10.4 Twitter / X
- `abs.twimg.com` serves all static assets (JS, CSS, images) via CDN entirely separate from API infrastructure
- Allows the CDN to absorb traffic spikes (e.g., viral events) without impacting API servers

### 10.5 Airbnb
- Uses Nginx + CloudFront for static asset delivery
- CSS and JS bundles are built by Webpack with content hashing and pushed to S3 during CI
- CDN cache TTL is set to 1 year for all hashed assets

### 10.6 Shopify Storefronts (Themes)
- Merchant store themes are compiled to static CSS/JS and served from Shopify's CDN
- Theme assets (`cdn.shopify.com`) are globally cached; only checkout and cart are dynamic

### 10.7 Stripe Documentation
- `stripe.com/docs` is a static site generated at build time
- Served via Cloudflare CDN; documentation pages are pre-rendered HTML for fast load and SEO
- API reference is generated from OpenAPI spec and baked into static HTML

### 10.8 Wikipedia
- Static HTML pages cached aggressively via Varnish + CDN layers (Fastly)
- Most pageviews are served from cache without hitting MediaWiki application servers
- Image assets served from `upload.wikimedia.org` on dedicated CDN infrastructure

### 10.9 Discord CDN
- User avatars, server icons, banners, attachments served from `cdn.discordapp.com`
- Static media entirely separated from real-time WebSocket API infrastructure
- Cloudflare CDN handles global distribution

---

## 11. Static Site Generators (SSG) Ecosystem

Static Content Hosting is the deployment target for SSG frameworks:

| Generator       | Language    | Best For                               | Rendering Model         |
|-----------------|-------------|----------------------------------------|-------------------------|
| **Next.js**     | React       | Hybrid static + dynamic apps           | SSG, SSR, ISR, App Router|
| **Gatsby**      | React       | Content-heavy marketing sites          | Pure SSG (GraphQL data) |
| **Astro**       | Multi        | Docs, blogs, content sites             | Islands architecture    |
| **Hugo**        | Go           | Documentation, large content sites     | Pure SSG (fastest build)|
| **Jekyll**      | Ruby         | Simple blogs, GitHub Pages             | Pure SSG                |
| **Nuxt.js**     | Vue          | Vue-based hybrid apps                  | SSG, SSR, ISR           |
| **SvelteKit**   | Svelte       | Svelte apps with static export         | SSG, SSR                |
| **Eleventy**    | JS           | Flexible, minimal blogs/docs           | Pure SSG                |
| **VitePress**   | Vue + Vite   | Technical documentation                | Pure SSG                |

---

## 12. Decision Framework

```
Is the content the same for all users at request time?
        │
        ├── NO (user-specific) ──▶ App Server (SSR or API)
        │                           Consider: static shell + client hydration
        │
        └── YES
              │
              ▼
        Does it change frequently (every few minutes)?
              │
              ├── YES ──▶ Consider: ISR, short-TTL CDN cache, or SSR
              │
              └── NO (changes at deploy or infrequently)
                    │
                    ▼
                  ✅ USE STATIC CONTENT HOSTING
                    │
                    ▼
              Single region or global audience?
                    │
                    ├── Single region ──▶ Object Storage with website hosting
                    │                    (S3, GCS, Azure Blob)
                    │
                    └── Global ──────▶ Object Storage + CDN
                                       (CloudFront, Azure Front Door,
                                        Cloudflare Pages, Vercel, Netlify)
```

---

## 13. Operational Checklist

```
Build & Deploy
  ☐ Content-hash all JS, CSS, and image filenames
  ☐ Set Cache-Control: no-cache on index.html
  ☐ Set Cache-Control: max-age=31536000, immutable on hashed assets
  ☐ Enable Brotli/Gzip compression at CDN
  ☐ Automate CDN cache invalidation in CI/CD pipeline

CDN Configuration
  ☐ Route /api/* to app servers (bypass CDN cache)
  ☐ Rewrite 404/403 → index.html for SPA routing
  ☐ Add security headers (HSTS, CSP, X-Frame-Options)
  ☐ Enable HTTP/2 or HTTP/3 (QUIC)
  ☐ Configure custom error pages

Security
  ☐ Block direct S3 bucket access; route through CDN only
  ☐ Apply WAF rules at CDN layer
  ☐ Restrict bucket policy to CDN origin access identity
  ☐ Enable access logging on both origin and CDN

Monitoring
  ☐ Track CDN cache hit ratio (target: >95% for static assets)
  ☐ Alert on origin error rate spikes (CDN hitting origin too often)
  ☐ Monitor p95/p99 TTFB (Time To First Byte) at edge
  ☐ Set up Real User Monitoring (RUM) for field data (Core Web Vitals)
```

---

## 14. Interview Cheat Sheet

| Question                                        | Key Answer                                                                        |
|-------------------------------------------------|-----------------------------------------------------------------------------------|
| Why serve static assets from CDN vs. app server?| Eliminates compute bottleneck, reduces latency via geo-distribution, lower cost   |
| How do you handle cache invalidation?           | Content hashing (immutable URLs) + explicit CDN purge for `index.html` on deploy  |
| How do you support SPA deep linking?            | CDN rewrite rule: 404/403 → `/index.html`; or edge function path rewrite         |
| What's the risk of long CDN TTLs?               | Stale assets after deploy; mitigated entirely by content hashing                 |
| How do you add security headers?                | CloudFront Functions / Lambda@Edge / Cloudflare Workers on viewer response        |
| Difference between CDN pull vs. push?           | Pull: CDN fetches from origin on cache miss. Push: pre-populate CDN (rare for static)|
| How do you handle personalized content?         | Static shell + client-side API hydration; or Edge Functions; or ISR              |
| What is ISR?                                    | Incremental Static Regeneration — regenerate static pages on demand at CDN edge  |
| How does this pattern relate to Valet Key?      | Valet Key handles write path (uploads); Static Content Hosting handles read path |