# Domain Name System (DNS)

> Translates human-readable domain names into machine-readable IP addresses. A foundational layer of the internet's infrastructure.

---

## 1. What is DNS?

DNS is a **hierarchical, distributed naming system** that maps domain names (e.g., `www.google.com`) to IP addresses (e.g., `142.250.80.46`). It functions like the internet's phone book — instead of memorizing IPs, users reference memorable domain names.

Every time a browser makes a request, DNS resolution happens first — making it a **critical path component** in system latency and availability.

---

## 2. Core Concepts

### DNS Hierarchy

```
Root (.)
  └── Top-Level Domain (TLD): .com, .org, .net, .io
        └── Second-Level Domain: google.com, github.com
              └── Subdomain: www.google.com, api.github.com
```

### Key Components

| Component | Role |
|---|---|
| **DNS Resolver** (Recursive Resolver) | Client-side component that initiates and manages the resolution chain |
| **Root Name Server** | Knows where TLD servers are (13 root server clusters globally) |
| **TLD Name Server** | Knows authoritative servers for domains under `.com`, `.org`, etc. |
| **Authoritative Name Server** | The final source of truth — holds the actual DNS records for a domain |
| **DNS Cache** | Stores results at multiple levels (browser, OS, resolver) to avoid repeated lookups |

---

## 3. DNS Resolution Process

```
Browser Cache
    │ miss
    ▼
OS / Local Cache (/etc/hosts)
    │ miss
    ▼
Recursive Resolver (ISP or 8.8.8.8)
    │ miss
    ▼
Root Name Server → "Ask .com TLD server"
    ▼
TLD Name Server (.com) → "Ask ns1.example.com"
    ▼
Authoritative Name Server → Returns IP
    ▼
Resolver caches result, returns to client
```

**Resolution types:**
- **Recursive**: Resolver does all the work; client gets final answer
- **Iterative**: Each server points to the next; client follows referrals

---

## 4. DNS Record Types

| Record | Purpose | Example |
|---|---|---|
| **A** | Maps domain → IPv4 | `example.com → 93.184.216.34` |
| **AAAA** | Maps domain → IPv6 | `example.com → 2606:2800::1` |
| **CNAME** | Alias to another domain | `www → example.com` |
| **MX** | Mail exchange server | `mail.example.com` |
| **NS** | Authoritative name servers for domain | `ns1.example.com` |
| **TXT** | Arbitrary text (used for SPF, DKIM, domain verification) | `"v=spf1 include:..."` |
| **SOA** | Start of Authority — zone metadata | Serial, refresh, TTL defaults |
| **PTR** | Reverse DNS (IP → domain) | Used for spam filtering |
| **SRV** | Service discovery with port/priority | Used in SIP, XMPP |
| **CAA** | Specifies which CAs can issue TLS certs | Security control |

---

## 5. TTL (Time to Live)

TTL defines **how long a DNS record can be cached** before it must be re-queried.

| TTL Value | Use Case |
|---|---|
| **60–300s** | Frequently changing IPs, failover scenarios |
| **3600s (1hr)** | Typical production use |
| **86400s (24hr)** | Stable infrastructure, CDNs |

**Pre-migration strategy:** Lower TTL days before a planned migration so propagation is fast when the change is made, then raise it afterward.

---

## 6. DNS in System Design Contexts

### Load Balancing via DNS

**Round Robin DNS** — Return multiple A records; resolvers cycle through them.

```
api.example.com → 10.0.0.1
api.example.com → 10.0.0.2
api.example.com → 10.0.0.3
```

**Weighted DNS** — Route a percentage of traffic to different IPs (used in blue/green deployments and canary releases).

**Geo DNS / Latency-based routing** — Return different IPs based on the requester's geographic region. Core to global CDN and multi-region system design.

### Health-Check-Based Failover

DNS providers (Route 53, Cloudflare) monitor endpoint health and automatically remove unhealthy IPs from DNS responses.

```
Primary: 10.0.0.1 (healthy → served)
Failover: 10.0.0.2 (promoted if primary fails)
```

### Service Discovery (Internal DNS)

In microservice architectures, internal DNS resolves **service names to container/pod IPs** dynamically.

- Kubernetes uses CoreDNS internally: `my-service.default.svc.cluster.local`
- AWS ECS uses Route 53 private hosted zones for service-to-service discovery

---

## 7. Trade-offs

### Caching vs. Freshness

| | High TTL | Low TTL |
|---|---|---|
| **Latency** | Lower (cache hits) | Higher (more lookups) |
| **Propagation speed** | Slow — stale records persist | Fast — changes take effect quickly |
| **Load on DNS servers** | Low | High |
| **Failover time** | Degraded — clients may cache dead IPs | Good — clients re-resolve quickly |

> **Design principle:** Use **low TTL for critical, frequently changing endpoints** (e.g., failover IPs). Use **high TTL for stable assets** (e.g., CDN origins).

---

### Round Robin DNS vs. Dedicated Load Balancer

| | Round Robin DNS | Load Balancer (L4/L7) |
|---|---|---|
| **Health awareness** | None (naive) | Active health checks |
| **Sticky sessions** | Not possible | Supported |
| **Request-level routing** | No (connection-level) | Yes (path, header, cookie) |
| **Cost** | Very low | Higher |
| **Complexity** | Minimal | Higher |

> Use Round Robin DNS only for **stateless services with identical replicas** where any instance can serve any request. For everything else, use a proper load balancer.

---

### DNS-based vs. Anycast Routing

| | DNS Geo-routing | Anycast |
|---|---|---|
| **Granularity** | Per-region/country | Per-network (BGP) |
| **Speed of failover** | TTL-bound | Near-instant |
| **Client caching** | Can serve stale IPs | N/A (IP is stable) |
| **Complexity** | Moderate | High (BGP management) |

> Anycast (used by Cloudflare, Google's `8.8.8.8`) is better for **ultra-low-latency global infrastructure**. DNS geo-routing is simpler for **regional application routing**.

---

### Split-Horizon DNS

Serve **different DNS responses** based on whether the query comes from an internal or external network.

- Internal: `api.company.com → 10.0.1.5` (private IP)
- External: `api.company.com → 203.0.113.10` (public IP)

**Trade-off:** Reduces attack surface and internal traffic routing, but adds operational complexity in managing two zone files.

---

## 8. Security Considerations

### Common DNS Attacks

| Attack | Description | Mitigation |
|---|---|---|
| **DNS Spoofing / Cache Poisoning** | Attacker injects forged records into a resolver's cache | DNSSEC, DNS-over-HTTPS |
| **DDoS on DNS** | Flood authoritative/resolver servers to cause outages | Anycast distribution, rate limiting |
| **DNS Hijacking** | Redirect users to malicious IPs by compromising resolvers | DNSSEC, registrar locking |
| **DNS Tunneling** | Exfiltrate data encoded in DNS queries | Anomaly detection, query monitoring |
| **NXDOMAIN attacks** | Mass queries for non-existent domains | Negative caching, rate limiting |

### DNSSEC

Signs DNS records cryptographically, allowing resolvers to verify authenticity. Prevents cache poisoning but **does not encrypt queries** (DNS-over-HTTPS or DNS-over-TLS does).

### DNS-over-HTTPS (DoH) / DNS-over-TLS (DoT)

Encrypts DNS queries to prevent eavesdropping and man-in-the-middle attacks. Increasingly standard for privacy-sensitive systems.

---

## 9. DNS in High Availability Design

### Multi-CDN Strategy

Use DNS to route to different CDN providers (Fastly, Cloudflare, Akamai) based on availability or performance. If one CDN degrades, DNS TTLs determine how quickly traffic shifts.

### Active-Active Multi-Region

```
users globally
      │
  Geo DNS
  ├── US-EAST → Load Balancer → App Servers
  ├── EU-WEST → Load Balancer → App Servers
  └── AP-SOUTH → Load Balancer → App Servers
```

DNS is the **first hop** in routing users to the nearest healthy region.

### Active-Passive Failover

```
Primary: api.example.com → 10.0.0.1 (TTL: 60s, health-checked)
  └── if unhealthy → DNS switches to 10.0.0.2 (standby)
```

**Key consideration:** With TTL of 60s, there's up to 60s of downtime during failover. Some clients (mobile, corporate proxies) ignore TTLs and cache longer.

---

## 10. Real-World Systems & Applications

### Amazon Route 53
- AWS's managed DNS service with **health checks, geo-routing, latency-based routing, weighted policies, and failover**.
- Used as the DNS backbone for multi-region AWS architectures.
- Integrates with CloudFront, ELB, and S3 for seamless routing.

### Cloudflare DNS (1.1.1.1)
- One of the fastest public resolvers globally, using **Anycast** across 300+ PoPs.
- Provides DoH and DoT by default.
- Also acts as authoritative DNS with DDoS protection and WAF for customers.

### Google Public DNS (8.8.8.8)
- Uses Anycast + DNSSEC validation.
- Processes trillions of queries/day — a case study in **horizontal scalability and global distribution**.

### Kubernetes / CoreDNS
- CoreDNS is the default DNS server in Kubernetes clusters.
- Handles **service discovery internally** — every Service gets a DNS name automatically.
- Supports plugins for custom routing, caching, and health checking.

### Netflix (AWS + Route 53)
- Uses Route 53 with latency-based routing to direct users to the nearest AWS region.
- Employs **Chaos Monkey** and **Chaos Kong** to test DNS failover resilience across regions.

### GitHub
- Uses **Anycast DNS** via their CDN (Fastly) for global performance.
- Employs split-horizon DNS for internal service routing within data centers.

### Akamai
- Pioneer of **geo-DNS** — routes users to edge nodes based on geographic proximity.
- Authoritative DNS as a product, combined with their CDN for ultra-fast resolution + delivery.

---

## 11. Performance Optimization Tips

- **Pre-fetch DNS** for critical third-party domains: `<link rel="dns-prefetch" href="//api.example.com">`
- **Use a fast resolver** close to users (Cloudflare 1.1.1.1, Google 8.8.8.8) for external traffic
- **Minimize DNS lookup chain depth** — each CNAME adds a round trip
- **Avoid CNAME at zone apex** (root domain) — use ALIAS/ANAME records instead
- **Monitor TTL expiry patterns** to anticipate traffic spikes on authoritative servers
- **Cache negative responses** (NXDOMAIN) to reduce load from typos or enumeration attacks

---

## 12. Quick Reference — Design Checklist

- [ ] Define TTL strategy based on change frequency and failover requirements
- [ ] Use health-check-based DNS failover for critical endpoints
- [ ] Implement Geo DNS / latency routing for multi-region deployments
- [ ] Secure with DNSSEC + DoH/DoT where applicable
- [ ] Plan for DNS propagation delays before infrastructure migrations
- [ ] Use internal DNS for service discovery in containerized environments
- [ ] Monitor DNS query latency as part of overall system observability
- [ ] Set registrar-level locks and MFA to prevent DNS hijacking