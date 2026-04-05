# Claim Check Pattern

## Overview

The **Claim Check Pattern** (also called **Reference-Based Messaging**) is a messaging integration pattern that splits a large message into two parts:

1. **The Claim Check** — a lightweight reference token (ID, URL, key) sent through the message bus
2. **The Payload** — the actual large data stored in an external data store

Instead of passing bulky data through the message broker, producers store the payload externally and send only a reference. Consumers use that reference to retrieve the payload when needed.

> **Core principle:** Message brokers are optimized for *routing and delivery*, not *data transport*. Keep the bus lean; store the bulk elsewhere.

---

## The Problem It Solves

Modern message brokers impose strict size limits:

| Broker          | Default / Max Message Size |
|-----------------|---------------------------|
| Azure Service Bus | 256 KB (Standard) / 100 MB (Premium) |
| AWS SQS         | 256 KB                     |
| Apache Kafka    | 1 MB (default, configurable) |
| RabbitMQ        | 128 MB (practical ~few MB) |
| Google Pub/Sub  | 10 MB                      |

Exceeding these limits causes **dropped messages**, **serialization failures**, or forces expensive infrastructure upgrades. The Claim Check pattern sidesteps all of this.

---

## Architecture

```
┌──────────────┐        ┌───────────────────┐
│   Producer   │        │   External Store  │
│              │──(1)──▶│  (Blob / S3 / DB) │
│              │        └───────────────────┘
│              │               │
│              │◀──(2) Key/URL─┘
│              │
│              │──(3) [Claim Check msg]──▶┌──────────────┐
│              │                          │ Message Bus  │
└──────────────┘                          │ (Queue/Topic)│
                                          └──────┬───────┘
                                                 │
                                               (4) Claim Check delivered
                                                 │
                                          ┌──────▼───────┐        ┌───────────────────┐
                                          │   Consumer   │──(5)──▶│   External Store  │
                                          │              │◀──(6)──│  Fetch Payload    │
                                          └──────────────┘        └───────────────────┘
```

**Flow:**
1. Producer uploads the large payload to external storage (S3, Blob Storage, DB)
2. External store returns a reference key / URL
3. Producer sends a lightweight message containing only the reference
4. Message bus delivers the small claim check message to consumer(s)
5. Consumer reads the claim check and fetches the payload using the reference
6. Consumer processes the full payload

---

## Claim Check Message Structure

```json
{
  "messageId": "msg-8f3a2b",
  "correlationId": "order-tx-9921",
  "timestamp": "2025-04-01T10:00:00Z",
  "payloadRef": {
    "store": "s3",
    "bucket": "order-payloads",
    "key": "orders/2025/04/01/order-9921.json",
    "expiresAt": "2025-04-02T10:00:00Z"
  },
  "metadata": {
    "eventType": "OrderPlaced",
    "size": 4200000,
    "contentType": "application/json"
  }
}
```

> **The claim check message itself should be tiny** — ideally under 1–5 KB. The metadata fields allow consumers to decide whether to fetch the payload at all (selective processing).

---

## Storage Options for the Payload

| Storage Type         | Best For                              | Examples                         |
|----------------------|---------------------------------------|----------------------------------|
| Object / Blob Store  | Binary files, large JSON, media       | S3, Azure Blob, GCS              |
| Relational DB        | Structured data needing querying      | PostgreSQL, MySQL                |
| Distributed Cache    | Short-lived, high-speed access        | Redis, Memcached                 |
| NoSQL Document Store | Schema-flexible large documents       | MongoDB, DynamoDB, Cosmos DB     |
| Shared File System   | Legacy integration, on-prem           | NFS, SMB shares                  |

**Object storage (S3-family) is the most common choice** — durable, cheap, auto-scalable, and supports presigned URLs for secure, time-limited consumer access.

---

## Variants

### 1. Automatic Claim Check
The middleware (e.g., Azure Event Grid, AWS SNS extended library) transparently intercepts oversized messages and offloads to storage automatically. The consumer SDK also handles retrieval transparently. The application code remains unaware of the pattern.

### 2. Manual Claim Check
The application explicitly handles storage and retrieval. Gives full control over storage backend, TTL, access policy, and cleanup logic.

### 3. Selective Claim Check
Not all consumers need the full payload. The claim check message includes enough metadata for consumers to decide whether to fetch — enabling **filter before fetch** optimization.

```
Consumer A (needs full data)   → Reads claim check → Fetches payload → Processes
Consumer B (only needs header) → Reads claim check → Skips fetch → Processes metadata
```

---

## Trade-offs

### Advantages

| Benefit                        | Explanation                                                                                     |
|--------------------------------|-------------------------------------------------------------------------------------------------|
| **Eliminates broker size limits** | Payloads bypass the broker entirely; the bus only carries tiny references                   |
| **Reduced broker cost**        | Pricing for managed queues (SQS, Service Bus) is per-message-size; smaller messages = lower cost |
| **Reduced network congestion** | The message bus network is not saturated by large payloads                                    |
| **Independent scalability**    | Storage and messaging infrastructure scale separately and optimally                            |
| **Selective consumption**      | Consumers can inspect metadata and skip payload fetches they don't need                       |
| **Decoupled payload lifecycle**| Payloads can be retained, versioned, and expired independently of message TTL                  |
| **Security**                   | Presigned URLs / scoped credentials limit who can fetch what payload, and for how long         |

### Disadvantages

| Trade-off                      | Explanation                                                                                     |
|--------------------------------|-------------------------------------------------------------------------------------------------|
| **Increased latency**          | Consumers make an additional network round-trip to fetch the payload                            |
| **Operational complexity**     | Adds a dependency on external storage; more moving parts to monitor and secure                  |
| **Partial failure risk**       | Message delivery succeeds but payload fetch can fail (storage down, key expired, permission denied) |
| **Stale/dangling references**  | If the payload is deleted before consumption, the claim check becomes invalid                   |
| **No atomic delivery**         | Payload upload and message publication are two separate operations — failure between them requires compensation logic |
| **Harder to debug**            | Tracing a full request now spans two systems (broker + storage)                                 |
| **TTL management burden**      | Someone must define, enforce, and clean up payload lifetimes                                    |

---

## Failure Modes & Mitigations

| Failure Scenario                    | Mitigation                                                                 |
|-------------------------------------|----------------------------------------------------------------------------|
| Payload upload succeeds, publish fails | Idempotent retry on publish; garbage-collect orphaned payloads via TTL  |
| Publish succeeds, payload deleted early | Use payload TTL > message TTL + worst-case consumer lag               |
| Consumer can't access storage       | Presigned URL with sufficient expiry; IAM role attached to consumer         |
| Storage outage during consumption   | Dead-letter queue (DLQ) + retry with backoff; alert on DLQ depth           |
| Duplicate message delivery          | Idempotent consumer logic; check if payload was already processed           |
| Large fan-out (many consumers)      | Shared storage naturally handles fan-out; no duplication of payload data    |

---

## Claim Check vs. Related Patterns

| Pattern             | How It Differs                                                                   |
|---------------------|----------------------------------------------------------------------------------|
| **Direct messaging**    | Payload travels through the broker — works only for small messages           |
| **Event-Carried State Transfer** | Full state in the event itself — works for moderate sizes, not huge payloads |
| **Event Sourcing**  | Events are the source of truth — Claim Check is about transport, not storage model |
| **CQRS**            | Separates reads/writes — orthogonal; Claim Check can be used in either path       |
| **Scatter-Gather**  | Fans out to multiple consumers — Claim Check complements it for large payloads    |

---

## Security Considerations

### Presigned URLs (Recommended for S3 / Azure Blob)
```
s3://order-payloads/orders/2025/04/01/order-9921.json
→ Presigned URL valid for 1 hour
→ HTTPS-only, read-only, single-object scope
```

- Time-bound access prevents indefinite exposure
- No consumer needs long-lived credentials to the storage bucket
- Each claim check can carry its own scoped, expiring URL

### IAM-Based Access
- Attach storage read permissions to consumer service identity
- Use bucket policies to restrict access by prefix/path
- Log all payload fetches via CloudTrail / Azure Monitor

### Encryption
- Encrypt payloads at rest (S3 SSE-KMS, Azure Blob encryption)
- Enforce HTTPS for all presigned URL access
- Consider envelope encryption for highly sensitive payloads

---

## Implementation Sketch (AWS: SQS + S3)

```python
# Producer
import boto3, uuid, json

s3 = boto3.client('s3')
sqs = boto3.client('sqs')

def publish_large_message(payload: dict, queue_url: str, bucket: str):
    key = f"payloads/{uuid.uuid4()}.json"
    
    # Step 1: Upload payload
    s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(payload))
    
    # Step 2: Generate presigned URL (1-hour TTL)
    url = s3.generate_presigned_url('get_object',
        Params={'Bucket': bucket, 'Key': key}, ExpiresIn=3600)
    
    # Step 3: Publish claim check
    claim_check = {
        "messageId": str(uuid.uuid4()),
        "payloadUrl": url,
        "payloadKey": key,
        "eventType": "OrderPlaced"
    }
    sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(claim_check))

# Consumer
import requests

def process_message(message: dict):
    claim = json.loads(message['Body'])
    
    # Fetch full payload using the claim check reference
    response = requests.get(claim['payloadUrl'])
    payload = response.json()
    
    # Process...
    handle_order(payload)
```

---

## Real-World Systems & Applications

### 1. **Azure Service Bus + Azure Blob Storage (Microsoft)**
Azure's own documentation uses this as the canonical example for Service Bus. The Azure SDK includes a `ServiceBusMessageDataFactory` that automatically handles offloading to Blob Storage when a message exceeds the broker's size limit.

**Use case:** Enterprise workflow orchestration where process state (XML documents, audit trails) regularly exceeds 256 KB.

### 2. **AWS SQS Extended Client Library**
Amazon provides an official Java/Python library that transparently implements Claim Check for SQS. Payloads > 256 KB are automatically offloaded to S3 and the SQS message carries only the S3 reference.

**Use case:** ETL pipelines where large data batches are signaled between Lambda stages or between ECS services.

### 3. **Apache Kafka + Object Storage (Data Pipelines)**
While Kafka supports larger messages than SQS, teams building high-throughput pipelines often store raw binary blobs (Avro files, Parquet snapshots, images) in S3/GCS and post only the object key to Kafka topics.

**Companies:** Uber (Kafka + S3 for Flink jobs), LinkedIn (origin of Kafka — uses external storage for large change data capture payloads).

**Use case:** Real-time ML feature pipelines, CDC (Change Data Capture) for large rows.

### 4. **Email & Notification Systems**
Email platforms (SendGrid, Mailchimp, Amazon SES) never embed large attachments in internal event queues. The attachment is stored in blob storage; the queued event carries only the attachment reference and recipient list.

**Use case:** Transactional email with PDF invoices, reports, or media attachments.

### 5. **Media Processing Pipelines (Netflix, YouTube)**
Raw video upload triggers an event containing only the storage path, not the video bytes. Transcoding workers (FFmpeg clusters) pull the raw file from object storage independently. Multiple workers can process different resolutions in parallel using the same single claim check.

**Use case:** Video ingestion → transcoding → thumbnail generation → CDN distribution.

### 6. **Healthcare & Insurance (HL7 / FHIR Messaging)**
FHIR document bundles, imaging metadata (DICOM references), and lab results can be very large. Integration engines (like Azure Health Data Services, AWS HealthLake) use Claim Check to route event notifications through lightweight message buses while storing clinical documents in compliant storage (HIPAA-eligible S3).

**Use case:** Hospital EHR system integration, lab result delivery, radiology workflows.

### 7. **Order Management Systems (E-commerce)**
Large orders (enterprise B2B with hundreds of line items, attachments, custom pricing contracts) exceed broker limits. The order event carries an order ID and storage reference; fulfillment, billing, and inventory services each independently retrieve the full order document.

**Companies:** SAP Commerce Cloud, Salesforce Commerce, Shopify Plus (for B2B flows).

---

## Decision Framework

```
Is your message payload > broker size limit?
        │
        ├── NO → Use direct messaging; no Claim Check needed
        │
        └── YES
              │
              ├── Is the full payload needed by all consumers?
              │       │
              │       ├── YES → Claim Check with shared object storage
              │       │
              │       └── NO → Selective Claim Check with metadata
              │                 (consumers filter before fetching)
              │
              ├── Is latency critical (< 50ms end-to-end)?
              │       │
              │       └── YES → Reconsider architecture; add pre-warm caching
              │                  (Redis layer in front of blob store)
              │
              ├── Is this a fan-out scenario (many consumers)?
              │       │
              │       └── YES → Claim Check is ideal — single payload stored,
              │                  many consumers fetch independently
              │
              └── Is compliance / data residency a concern?
                      │
                      └── YES → Use presigned URLs with short TTL + KMS encryption
                                  + VPC endpoint for private storage access
```

---

## Monitoring & Observability

| Metric                             | Why It Matters                                      | Alert Threshold         |
|------------------------------------|-----------------------------------------------------|-------------------------|
| Payload fetch success rate         | Tracks broken/expired claim check references        | < 99.9%                 |
| Payload fetch latency (p99)        | Secondary latency introduced by the pattern         | > 500ms                 |
| Orphaned payload count             | Payloads stored but never fetched (wasted cost)     | Growing trend           |
| DLQ depth                         | Failed claim check resolutions                      | > 0 sustained           |
| Storage access denied errors       | IAM / presigned URL misconfiguration                | Any occurrence          |
| Time-to-consume vs. payload TTL gap | Risk window where payload expires before consumption | TTL gap < 2× lag       |

**Distributed tracing** (OpenTelemetry, AWS X-Ray, Jaeger) should propagate `traceId` through both the claim check message and the payload fetch, linking the full request across broker + storage.

---

## Key Takeaways

- The Claim Check pattern is **mandatory** when payloads routinely exceed broker limits; it is also worth adopting preemptively for any payload > ~64 KB to control broker costs.
- **Object storage (S3 / Azure Blob / GCS) is the canonical payload store** — durable, cheap, scalable, and supports presigned URL security.
- The biggest operational risk is **payload expiry before consumption** — always set payload TTL significantly longer than worst-case consumer lag.
- For fan-out scenarios, Claim Check is especially efficient: **one payload upload serves N consumers**.
- Use **distributed tracing** across broker + storage to maintain end-to-end observability.
- Combine with **idempotent consumer design** to safely handle duplicate message delivery.