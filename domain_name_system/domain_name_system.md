# Domain Name System (DNS)

## What is DNS?

DNS is the **phonebook of the internet** — it translates human-readable domain names (e.g., `www.example.com`) into machine-readable IP addresses (e.g., `192.168.1.1`). Without DNS, every user would need to remember IP addresses to access websites.

DNS is a **globally distributed, hierarchical system**. No single server knows everything — the resolution process walks a delegation tree until the authoritative answer is found.

---

## DNS Hierarchy

```
Root (.)
  └── TLD (.com, .org, .net, .io)
        └── Second-Level Domain (example.com)
              └── Subdomain (www.example.com, api.example.com)
```

| Level | Example | Role |
|---|---|---|
| Root (.) | 13 root server clusters | Entry point; delegates to TLD servers |
| TLD Nameserver | `.com`, `.org`, `.io` | Delegates to authoritative NS for the domain |
| Authoritative Nameserver | `ns1.example.com` | Holds the actual DNS records |
| Recursive Resolver | ISP / `8.8.8.8` / `1.1.1.1` | Walks the tree on behalf of the client |

> There are 13 logical root nameserver addresses (a–m.root-servers.net), but hundreds of physical servers globally via Anycast.

---

## The Four DNS Server Types

| Server | Analogy | Responsibility |
|---|---|---|
| **DNS Recursive Resolver** | Librarian | Accepts client query; walks the tree; returns the final answer |
| **Root Nameserver** | Library index | Points resolver to the correct TLD server |
| **TLD Nameserver** | Book rack | Points resolver to the authoritative nameserver for the domain |
| **Authoritative Nameserver** | Dictionary | Holds the actual records; returns the definitive answer |

---

## DNS Resolution — Step by Step

For a cold lookup of `www.example.com` (nothing cached):

1. User types `www.example.com` in browser
2. OS checks **local cache** → miss
3. OS queries the **recursive resolver** (e.g., ISP's resolver or `8.8.8.8`)
4. Resolver checks its **cache** → miss
5. Resolver queries a **root nameserver** → gets `.com` TLD address
6. Resolver queries the **.com TLD nameserver** → gets `example.com` authoritative NS address
7. Resolver queries the **authoritative nameserver** for `example.com` → gets IP
8. Resolver **caches** the result (respecting TTL) and returns it to the OS
9. OS caches it; browser makes HTTP request to the returned IP

> Cached lookups skip most of these steps — the resolver returns directly from cache if TTL hasn't expired.

---

## DNS Query Types

| Query Type | Behavior | Used By |
|---|---|---|
| **Recursive** | Resolver does all the work; client gets final answer or error | Clients → recursive resolver |
| **Iterative** | Server returns best referral it can; client must follow up | Resolver → root/TLD/authoritative |
| **Non-recursive** | Resolved from cache immediately | Any level with a valid cached record |

---

## DNS Caching Layers

Caching is the primary performance lever in DNS. Every layer caches with a TTL.

| Cache Location | TTL Control | Notes |
|---|---|---|
| Browser (Chrome, Firefox) | Respects DNS TTL | Chrome: visible at `chrome://net-internals/#dns` |
| OS stub resolver | Respects DNS TTL | First local stop; checks before leaving the machine |
| Recursive resolver (ISP / public) | Respects DNS TTL | `8.8.8.8`, `1.1.1.1` cache aggressively |
| Authoritative nameserver | Set by zone owner | Lower TTL = faster propagation; higher = less load |

**TTL trade-off:**
- Low TTL (30s–300s) → faster propagation, more DNS traffic, useful during migrations
- High TTL (3600s–86400s) → less DNS traffic, slower failover and record propagation

---

## DNS Record Types

| Record | Full Name | Purpose | Example |
|---|---|---|---|
| **A** | Address | Maps hostname → IPv4 | `example.com → 93.184.216.34` |
| **AAAA** | IPv6 Address | Maps hostname → IPv6 | `example.com → 2606:2800::1` |
| **CNAME** | Canonical Name | Alias; maps name → another name | `www.example.com → example.com` |
| **NS** | Name Server | Specifies authoritative NS for domain/subdomain | `example.com NS ns1.example.com` |
| **MX** | Mail Exchange | Specifies mail servers (with priority) | `example.com MX mail.example.com (priority 10)` |
| **TXT** | Text | Arbitrary text; used for SPF, DKIM, domain verification | `"v=spf1 include:..."` |
| **PTR** | Pointer | Reverse DNS — IP → hostname | `93.184.216.34 → example.com` |
| **SOA** | Start of Authority | Zone metadata: primary NS, admin email, serial, TTL defaults | Set per zone |
| **SRV** | Service | Protocol/port discovery for services | `_http._tcp.example.com` |
| **CAA** | Cert Authority Authorization | Restricts which CAs can issue TLS certs | `example.com CAA 0 issue "letsencrypt.org"` |

> **CNAME caveat:** A CNAME cannot coexist with other records at the zone apex (e.g., you can't have `CNAME` at `example.com` alongside an `MX` record). Use `ALIAS`/`ANAME` records (provider-specific) or `A` records at the apex.

---

## DNS Routing Policies (Managed DNS)

Managed DNS providers (Cloudflare, AWS Route 53, etc.) support intelligent traffic routing at the DNS layer. This is a lightweight alternative to or complement of application-layer load balancing.

| Policy | How It Works | Best For |
|---|---|---|
| **Simple** | Single static record; always returns same IP | Single-server, low-scale setups |
| **Weighted Round Robin** | Distributes traffic proportionally by weight | A/B testing, canary deployments, graduated rollouts |
| **Latency-based** | Returns the record from the region with lowest latency to the requester | Multi-region active-active deployments |
| **Geolocation** | Routes based on requester's geographic region | Data residency, region-specific content, compliance |
| **Geoproximity** | Routes based on physical distance to resources; supports bias shifting | Fine-grained geographic traffic control |
| **Failover** | Primary/secondary pair; returns secondary if primary health check fails | Active-passive disaster recovery |
| **Multivalue Answer** | Returns up to 8 healthy records randomly | Cheap pseudo-load-balancing without a real LB |
| **IP-based** | Routes based on CIDR ranges of the client's IP | ISP-level control, on-prem to cloud routing |

> **DNS vs. Load Balancer routing:** DNS routing is coarse-grained and cached — it can't do session persistence, health-check at request granularity, or TLS termination. It's best for regional steering; use a load balancer within a region for fine-grained distribution.

---

## DNS and Load Balancing Algorithms (Brief)

When using weighted routing at the DNS layer, the underlying algorithms mirror those in load balancers:

| Algorithm | Description | When to Use |
|---|---|---|
| **Round Robin** | Cycles through records equally | Homogeneous server clusters |
| **Weighted Round Robin** | Distributes proportionally by assigned weight | Heterogeneous capacity; A/B testing; maintenance windows |
| **Least Connections** | Routes to server with fewest active connections | Long-lived connections (WebSockets, file transfers) |
| **Random** | Randomly picks a server | High-volume even distribution across identical nodes |

> Pure DNS cannot implement least-connections natively — that requires a real load balancer with real-time connection state. DNS-layer "load balancing" is really just weighted/random record selection.

---

## DNS Propagation

When a record is updated, the change doesn't appear globally instantly. Propagation delay depends on:

- **TTL of the old record** — resolvers will serve stale data until TTL expires
- **Negative TTL (SOA)** — how long NXDOMAIN (domain not found) responses are cached
- **Resolver non-compliance** — some resolvers ignore TTL and cache longer

**Best practice for migrations:**
1. Lower TTL to 60–300s several days before the change
2. Make the record change
3. Wait for old TTL to expire everywhere
4. Raise TTL back after confirming the new record is live

---

## Security: DNSSEC

DNS was designed without authentication — responses can be forged. **DNSSEC** adds cryptographic signing to DNS records.

| Concept | What It Does |
|---|---|
| **Zone Signing** | Zone owner signs all records with a private key |
| **DS Record** | Parent zone stores hash of child zone's public key — creates a chain of trust from root |
| **RRSIG** | Signature record returned alongside DNS responses |
| **NSEC/NSEC3** | Proves a record does NOT exist (authenticated denial of existence) |

**Limitations of DNSSEC:**
- Does not encrypt DNS traffic (use DNS-over-HTTPS or DNS-over-TLS for that)
- Adds complexity and larger response sizes
- Zone enumeration risk with NSEC (mitigated by NSEC3)

**DNS-over-HTTPS (DoH) / DNS-over-TLS (DoT):** Encrypts the DNS query itself so ISPs and network observers cannot see which domains are being resolved.

---

## DNS Attack Vectors

| Attack | Description | Mitigation |
|---|---|---|
| **DNS Cache Poisoning** | Injecting forged records into a resolver's cache | DNSSEC; source port randomization; query ID randomization |
| **DNS Amplification DDoS** | Attacker spoofs victim IP; small query returns large response, flooding victim | Rate limiting; response rate limiting (RRL); disabling open resolvers |
| **DNS Hijacking** | Attacker redirects DNS queries to malicious servers | DNSSEC; registrar lock; MFA on DNS registrar account |
| **NXDOMAIN Attack** | Flood of queries for non-existent domains, exhausting resolver resources | Rate limiting; negative caching |
| **Authoritative DDoS** | Direct volumetric attack on authoritative nameservers | Anycast distribution; Cloudflare/Route 53 scale |

> The 2016 Dyn DDoS attack (via Mirai botnet) took down Twitter, GitHub, Reddit, and others by targeting their DNS provider's authoritative infrastructure.

---

## Anycast DNS

Most major DNS providers use **Anycast** routing to publish the same IP address from multiple data centers globally. Routers direct queries to the nearest (lowest-cost BGP path) server automatically.

- Provides **geographic load distribution** with no application-layer changes
- Provides **inherent DDoS resilience** — attack traffic is distributed across all PoPs
- Enables **low-latency resolution** globally

---

## Operational Considerations

| Concern | Best Practice |
|---|---|
| **TTL tuning** | Use high TTL (86400s) normally; lower to 60–300s before planned changes |
| **Redundant NS records** | Always configure at least 2 authoritative nameservers in different networks |
| **Health checks + failover** | Use managed DNS health checks (Route 53, Cloudflare) to auto-fail over |
| **Registrar lock** | Enable registrar lock to prevent unauthorized domain transfers |
| **Monitor propagation** | Use tools like `dig`, `nslookup`, `dnschecker.org` after changes |
| **Negative TTL** | Keep SOA negative TTL low during migrations to avoid NXDOMAIN caching |

---

## DNS in System Design — Decision Checklist

- [ ] Do you need global traffic steering? → Use latency-based or geolocation DNS routing
- [ ] Do you need active-passive failover across regions? → Use DNS failover with health checks
- [ ] Are you running A/B tests or canary deployments? → Use weighted routing
- [ ] Are you migrating IPs? → Lower TTL days in advance
- [ ] Are you using subdomains for microservices? → Use CNAME records; watch apex CNAME restriction
- [ ] Is DDoS on your threat model? → Use managed DNS (Cloudflare, Route 53) for Anycast resilience
- [ ] Do you need data residency compliance? → Use geolocation routing to restrict regions

---

## Disadvantages of DNS

- **Propagation delay** — TTL-based caching means changes aren't instant; stale data can persist
- **Coarse-grained load balancing** — DNS cannot route based on real-time server health or connection counts
- **Not a substitute for a load balancer** — no session persistence, no L7 inspection, no TLS termination
- **Management complexity** — DNS infrastructure at scale is managed by ISPs, governments, and large operators
- **DDoS target** — authoritative and recursive resolvers are high-value attack targets
- **Cache poisoning risk** — without DNSSEC, responses can be forged

---

## Anti-Patterns

| Anti-Pattern | Why It's Bad | Fix |
|---|---|---|
| Using DNS round robin as a load balancer | No health checks, no session affinity, client caches pin to one IP | Use a real load balancer; use DNS for regional steering only |
| Extremely long TTLs with no failover plan | Stuck with stale records for hours during outages | Lower TTL proactively; combine with health-check-based failover |
| Single authoritative nameserver | SPOF — if it goes down, domain resolves nowhere | Use ≥2 NS records in geographically/network-diverse locations |
| CNAME at zone apex | Violates RFC; breaks MX, NS records; some resolvers reject it | Use ALIAS/ANAME (provider-specific) or A record at apex |
| Skipping DNSSEC on sensitive domains | Vulnerable to cache poisoning and hijacking | Enable DNSSEC; it's free on most managed DNS providers |
| Not locking the registrar account | Attacker can transfer domain or change NS records | Enable registrar lock + MFA on all registrar accounts |
| Hardcoding IP addresses instead of DNS | Can't do zero-downtime IP migrations | Always use DNS names in config; reserve IPs for DNS resolution only |