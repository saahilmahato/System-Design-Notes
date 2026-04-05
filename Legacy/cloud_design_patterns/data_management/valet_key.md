# Valet Key Pattern
> Cloud Design Patterns → Data Management

---

## 1. Overview

The **Valet Key Pattern** provides clients with **restricted, time-limited, direct access** to a specific resource (e.g., blob storage, queue, table) **without routing the data through the application server**. Instead of the application acting as a proxy for every upload/download, it issues a **signed token or credential** — the "valet key" — that grants scoped permissions directly to the storage service.

The name is an analogy: you hand a valet only the **car key**, not your house keys, wallet, or full keyring. The valet can park the car but cannot access anything else.

---

## 2. Core Concept

```
WITHOUT VALET KEY (Proxy Model)
─────────────────────────────────────────────────────────
Client ──── upload 500MB ──▶ App Server ──── forward ──▶ Storage
                              (bottleneck,
                               bandwidth cost,
                               CPU overhead)

WITH VALET KEY (Direct Access Model)
─────────────────────────────────────────────────────────
Client ──── request token ──▶ App Server ──── issue SAS/signed URL ──▶ Client
Client ────────────────── upload 500MB directly ──────────────────▶ Storage
```

The application server is involved **only in issuing the token**, not in the data transfer itself.

---

## 3. How It Works — Step by Step

```
1. Client requests access
        │
        ▼
2. App Server authenticates & authorizes the client
        │
        ▼
3. App Server generates a Valet Key (signed URL / SAS token)
   - Scoped to: specific resource (single blob, prefix, queue)
   - Permissions: read / write / delete (minimal required)
   - Expiry: short TTL (seconds to minutes)
        │
        ▼
4. App Server returns the Valet Key to Client
        │
        ▼
5. Client uses the Valet Key directly against the Storage Service
   - No app server involved in the data path
        │
        ▼
6. Storage Service validates the token and serves/accepts the data
        │
        ▼
7. (Optional) App Server receives a callback/notification on completion
```

---

## 4. Key Properties of a Valet Key

| Property         | Description                                                                 |
|------------------|-----------------------------------------------------------------------------|
| **Scoped**       | Limited to a specific resource (one file, one prefix, one queue)           |
| **Time-limited** | Expires after a short TTL to minimize exposure window                      |
| **Permission-minimal** | Read-only or write-only; never full admin access                    |
| **Single-use or multi-use** | Configurable; prefer single-use for sensitive operations        |
| **Non-revocable (typically)** | Once issued, token is valid until expiry (design implication) |
| **Auditable**    | Storage service logs access events independently of the app server         |

---

## 5. Token Types by Platform

### 5.1 Azure — Shared Access Signature (SAS)
```
https://storageaccount.blob.core.windows.net/container/file.mp4
  ?sv=2023-01-03
  &se=2024-06-01T12%3A00%3A00Z   ← expiry
  &sr=b                           ← scope: blob
  &sp=r                           ← permission: read
  &sig=<HMAC-SHA256 signature>
```
- **Service SAS**: scoped to a specific blob/container/queue/table
- **Account SAS**: broader scope, avoid unless necessary
- **User Delegation SAS**: backed by Azure AD identity; preferred

### 5.2 AWS — Presigned URLs (S3)
```python
import boto3

s3 = boto3.client('s3')

# Generate a presigned PUT URL (client uploads directly)
url = s3.generate_presigned_url(
    ClientMethod='put_object',
    Params={'Bucket': 'my-bucket', 'Key': 'uploads/user-123/video.mp4'},
    ExpiresIn=300  # 5 minutes
)
# Returns: https://my-bucket.s3.amazonaws.com/uploads/...?X-Amz-Signature=...
```

### 5.3 Google Cloud — Signed URLs (GCS)
```python
from google.cloud import storage
from datetime import timedelta

client = storage.Client()
blob = client.bucket('my-bucket').blob('uploads/file.mp4')

url = blob.generate_signed_url(
    version='v4',
    expiration=timedelta(minutes=15),
    method='PUT',
    content_type='video/mp4'
)
```

### 5.4 Generic — JWT-Based Token
```json
{
  "sub": "user-123",
  "resource": "uploads/user-123/avatar.png",
  "permissions": ["write"],
  "exp": 1717243200,
  "iat": 1717239600
}
```
Validated by a custom middleware or storage gateway.

---

## 6. Security Considerations

### 6.1 Token Leakage
- A stolen token is valid until expiry — keep TTL **as short as possible**
- Use HTTPS exclusively; never expose tokens in logs or URLs that get cached
- Prefer POST policies over GET URLs for uploads (hides token from browser history)

### 6.2 Scope Creep
- Always scope to the **minimum required resource** (single blob, not entire container)
- Include content-type restrictions in upload tokens to prevent MIME-type attacks

### 6.3 Revocation Problem
- Most signed URL implementations are **stateless and non-revocable**
- Mitigation: use a **SAS revocation list** (Azure) or **short TTL + Object Lifecycle Policies**
- For high-security flows, implement a **token registry** that storage validates via a callback

### 6.4 Path Traversal
- Validate and sanitize the resource path before embedding it in the token
- Prevent `../../` or other traversal patterns from being included

### 6.5 Upload Validations
```
Client ──▶ Storage (direct upload via Valet Key)
                │
                ▼
       Storage triggers event (S3 Event / Azure Event Grid)
                │
                ▼
       App Server / Lambda validates:
       - File size limits
       - MIME type verification (magic bytes, not extension)
       - Virus/malware scanning
       - Content policy checks
```
**Never trust client-uploaded content.** Always validate post-upload via async pipeline.

---

## 7. Common Use Cases

| Use Case                     | Pattern Applied                                                  |
|------------------------------|------------------------------------------------------------------|
| **User file uploads**        | Client uploads avatar/video directly to S3/GCS/Azure Blob       |
| **Large media ingestion**    | Video platforms accept raw uploads without proxying through API  |
| **Secure file downloads**    | Time-limited download links for paid/private content            |
| **IoT sensor data**          | Devices write telemetry directly to blob/queue storage          |
| **Multi-part uploads**       | Each part gets its own signed URL; assembled by storage         |
| **CDN asset invalidation**   | Signed URLs bypass CDN cache for private content                |
| **Cross-origin file access** | Frontend JS uploads directly from browser (no CORS proxy needed)|

---

## 8. Architecture Patterns Combining Valet Key

### 8.1 Valet Key + Event-Driven Validation
```
Browser
  │── POST /upload-token ──▶ API Server
  │◀──── SAS URL ──────────── API Server
  │
  │── PUT file.mp4 ──────────────────────▶ Blob Storage
                                                │
                                          Event Grid / S3 Event
                                                │
                                           Lambda / Function
                                                │
                                        ┌───────┴────────┐
                                   Scan file         Update DB
                               (virus, MIME)     (file confirmed)
```

### 8.2 Valet Key + Claim Check Pattern
```
Producer ──▶ Blob Storage (via Valet Key)
                  │
          stores large payload
                  │
Producer ──▶ Message Queue ──▶ Consumer
              (sends only
               blob reference
               + metadata)
                              Consumer ──▶ Blob Storage (via Valet Key)
                                            fetches large payload
```

### 8.3 Valet Key + CDN (Private Content Delivery)
```
User ──▶ App Server (auth check) ──▶ issues signed URL
User ──────────────────────────────▶ CDN Edge (validates signature)
CDN Edge (cache miss) ──────────────▶ Origin Storage
```

---

## 9. Implementation — Backend Token Issuance

### Node.js (AWS S3 Presigned URL)
```javascript
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({ region: 'us-east-1' });

async function issueUploadToken(userId, filename, contentType) {
  // Validate & sanitize inputs
  const key = `uploads/${userId}/${Date.now()}-${sanitize(filename)}`;

  const command = new PutObjectCommand({
    Bucket: process.env.UPLOAD_BUCKET,
    Key: key,
    ContentType: contentType,
    Metadata: { userId, originalName: filename }
  });

  const signedUrl = await getSignedUrl(s3, command, {
    expiresIn: 300 // 5 minutes
  });

  // Record pending upload in DB for post-upload validation
  await db.pendingUploads.insert({ key, userId, status: 'pending' });

  return { uploadUrl: signedUrl, key };
}
```

### Python (Azure SAS Token)
```python
from azure.storage.blob import (
    BlobServiceClient, BlobSasPermissions, generate_blob_sas
)
from datetime import datetime, timedelta, timezone
import uuid

def issue_upload_token(user_id: str, filename: str) -> dict:
    blob_name = f"uploads/{user_id}/{uuid.uuid4()}/{filename}"
    
    sas_token = generate_blob_sas(
        account_name=ACCOUNT_NAME,
        container_name=CONTAINER_NAME,
        blob_name=blob_name,
        account_key=ACCOUNT_KEY,
        permission=BlobSasPermissions(write=True),
        expiry=datetime.now(timezone.utc) + timedelta(minutes=10),
        content_type="application/octet-stream"
    )
    
    blob_url = (
        f"https://{ACCOUNT_NAME}.blob.core.windows.net"
        f"/{CONTAINER_NAME}/{blob_name}?{sas_token}"
    )
    
    return {"upload_url": blob_url, "blob_name": blob_name}
```

### Frontend Upload (Browser → S3)
```javascript
async function uploadFile(file) {
  // 1. Get signed URL from our backend
  const { uploadUrl, key } = await fetch('/api/upload-token', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, contentType: file.type })
  }).then(r => r.json());

  // 2. Upload directly to S3 — no app server involved in transfer
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type }
  });

  if (!response.ok) throw new Error('Upload failed');

  // 3. Notify backend of completion
  await fetch('/api/upload-complete', {
    method: 'POST',
    body: JSON.stringify({ key })
  });
}
```

---

## 10. Trade-offs

### 10.1 Advantages

| Advantage                          | Detail                                                                 |
|------------------------------------|------------------------------------------------------------------------|
| **Offloads bandwidth**             | App server never handles large payloads; storage handles transfer      |
| **Reduces latency**                | Client connects directly to geo-distributed storage endpoints         |
| **Horizontal scalability**         | Token issuance is lightweight; storage scales independently            |
| **Cost efficiency**                | Eliminates egress through app servers; reduces compute costs           |
| **Reduced attack surface**         | App server not exposed to raw file data; limits injection vectors      |
| **Built-in storage features**      | Leverage multipart upload, resumable uploads, parallel chunks natively |
| **Simpler app server**             | No streaming, buffering, or chunked transfer logic needed              |

### 10.2 Disadvantages

| Disadvantage                        | Detail                                                                 |
|-------------------------------------|------------------------------------------------------------------------|
| **Non-revocable tokens**            | Issued tokens cannot be instantly invalidated (short TTL is the only mitigation) |
| **No inline validation**            | Cannot inspect file content before it reaches storage; must be async  |
| **Client complexity**               | Client must implement two-step flow (token request + direct upload)   |
| **Token leakage risk**              | Accidental logging or sharing of URL compromises access               |
| **Limited permission granularity**  | Some platforms offer coarse permissions (read/write) but not finer controls |
| **Consistency challenges**          | Upload may succeed but app server is unaware without a callback/event |
| **Cross-origin setup**              | Requires correct CORS configuration on storage bucket                 |

### 10.3 When NOT to Use

- Files require **real-time processing** during upload (e.g., transcoding frame-by-frame)
- **Strict compliance** requiring server-side inspection before storage
- Environments where clients **cannot make direct outbound connections** to storage endpoints
- When **transaction atomicity** is needed between file storage and DB write

---

## 11. Real-World Systems & Applications

### 11.1 Dropbox
- Clients upload directly to S3 using presigned URLs
- Dropbox backend issues upload authorization tokens scoped per-file-block (chunked)
- Post-upload, a separate metadata service reconciles the blocks

### 11.2 YouTube / Google Drive
- Signed GCS resumable upload URLs allow large video files to be uploaded in chunks directly to Google infrastructure
- Application server only handles session initiation and completion callbacks

### 11.3 Slack
- File uploads bypass Slack's API servers — clients receive a presigned S3 URL
- Slack's backend attaches a Lambda trigger to the S3 bucket for post-upload scanning and indexing

### 11.4 GitHub (LFS — Large File Storage)
- GitHub LFS issues batch upload tokens (signed URLs) for large binary objects (videos, datasets, binaries)
- Git client uploads directly to S3/Azure Blob behind the scenes

### 11.5 Stripe (Document Uploads)
- Identity verification documents are uploaded via presigned URLs directly to Stripe's storage
- Stripe backend is never a pass-through for sensitive document bytes

### 11.6 Airbnb
- Property photos uploaded directly to S3 via presigned PUT URLs from the mobile app
- Triggers an async pipeline: image resizing, NSFW detection, thumbnail generation

### 11.7 Netflix
- Content ingestion partners receive scoped, time-limited upload credentials (AWS Temporary Security Credentials via STS)
- Allows studios to upload raw masters directly to Netflix's S3 buckets without going through Netflix's API fleet

### 11.8 Uber (Driver Documents)
- Driver license and insurance documents use presigned upload URLs
- Post-upload OCR and fraud detection pipelines run asynchronously on the stored files

---

## 12. Operational Considerations

### 12.1 Token TTL Strategy
```
Operation          Recommended TTL
─────────────────────────────────
Small file upload  2–5 minutes
Large file upload  15–30 minutes (or per-chunk TTL)
Resumable upload   Session-based (refresh token before expiry)
Secure download    1–15 minutes (based on sensitivity)
CDN signed URL     Minutes to hours (based on caching needs)
```

### 12.2 Monitoring & Alerting
- Track **token issuance rate** vs. **actual upload completion rate** — large gap indicates abuse or client bugs
- Alert on **expired token upload attempts** — may signal slow clients or attack probes
- Monitor **storage event latency** — time from upload completion to app server callback

### 12.3 CORS Configuration (S3 Example)
```json
[
  {
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedOrigins": ["https://app.yoursite.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

---

## 13. Decision Framework

```
Need to transfer large files or binary data?
        │
        ├── NO ──▶ Standard API response is fine
        │
        └── YES
              │
              ▼
        Can client connect directly to cloud storage?
              │
              ├── NO ──▶ Use streaming proxy or chunked upload through app server
              │
              └── YES
                    │
                    ▼
              Is inline content validation required (e.g., compliance)?
                    │
                    ├── YES ──▶ Proxy upload → inspect → store
                    │            OR: store → async scan → quarantine on fail
                    │
                    └── NO
                          │
                          ▼
                    ✅ USE VALET KEY PATTERN
                    - Issue scoped, time-limited token
                    - Client uploads/downloads directly
                    - Validate post-upload via storage events
```

---

## 14. Interview Cheat Sheet

| Question                                | Key Answer                                                              |
|-----------------------------------------|-------------------------------------------------------------------------|
| What problem does Valet Key solve?      | Eliminates app server as bandwidth bottleneck for large data transfers |
| How is security maintained?             | Scoped permissions + short TTL + HTTPS + post-upload validation        |
| What if a token is compromised?         | Expires on TTL; use short durations + Object-level access logging      |
| How does it differ from OAuth?          | Valet Key is storage-specific, stateless, and resource-scoped; OAuth is identity-based |
| What is the main risk?                  | Non-revocability and skipping inline content validation                |
| AWS implementation?                     | S3 Presigned URLs via `generate_presigned_url()`                       |
| Azure implementation?                   | Blob SAS tokens via `generate_blob_sas()`                              |
| GCP implementation?                     | GCS Signed URLs via `blob.generate_signed_url()`                       |
| Pair with which other patterns?         | Claim Check (offload payload), Event-driven (post-upload validation), CDN (signed delivery) |