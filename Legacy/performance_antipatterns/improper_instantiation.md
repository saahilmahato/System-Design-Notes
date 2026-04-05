# Performance Antipattern: Improper Instantiation

---

## 1. What Is It?

**Improper Instantiation** occurs when an application repeatedly creates new instances of objects that are expensive to initialize — instead of creating them once and reusing them. This is one of the most common and impactful performance antipatterns in distributed systems and high-throughput services.

The core problem: initialization cost is paid **on every request** rather than **once at startup**.

---

## 2. Why Is It Expensive?

Object creation is not always cheap. Many types of objects carry significant initialization overhead:

| Object Type | Why It's Expensive |
|---|---|
| HTTP/HTTPS clients | TLS handshake, DNS resolution, TCP connection establishment |
| Database connections | TCP connect, auth handshake, session setup |
| Thread pool executors | Thread creation, OS scheduling overhead |
| gRPC/RPC stubs | Channel creation, connection negotiation |
| SDK clients (AWS, GCP) | Config loading, credential resolution, HTTP client init |
| Serializers / parsers | Schema loading, reflection setup |
| Regex patterns | Compilation of regex into finite automata |
| Logger instances | Handler setup, formatter creation |
| ORM sessions/contexts | Connection binding, transaction context setup |

---

## 3. The Antipattern in Practice

### ❌ Bad: Creating a new client per request

```python
# Python — HTTP client recreated on every request
def fetch_user(user_id: str):
    client = httpx.Client()           # NEW connection per call
    response = client.get(f"/users/{user_id}")
    return response.json()
```

```java
// Java — new DB connection every time
public User getUser(String id) {
    Connection conn = DriverManager.getConnection(DB_URL, USER, PASS); // expensive!
    PreparedStatement stmt = conn.prepareStatement("SELECT * FROM users WHERE id = ?");
    stmt.setString(1, id);
    return mapResultSet(stmt.executeQuery());
}
```

```go
// Go — AWS SDK client created inside handler
func handleRequest(w http.ResponseWriter, r *http.Request) {
    sess := session.Must(session.NewSession()) // reinitializes every request
    svc := s3.New(sess)
    svc.GetObject(...)
}
```

### ✅ Good: Instantiate once, reuse everywhere

```python
# Python — shared client at module level
_client = httpx.Client()  # Created once at startup

def fetch_user(user_id: str):
    response = _client.get(f"/users/{user_id}")
    return response.json()
```

```java
// Java — use a connection pool
private static final DataSource dataSource = createConnectionPool(); // once

public User getUser(String id) {
    try (Connection conn = dataSource.getConnection()) { // borrowed from pool
        // ...
    }
}
```

```go
// Go — initialize at package level
var s3Client = s3.New(session.Must(session.NewSession()))

func handleRequest(w http.ResponseWriter, r *http.Request) {
    s3Client.GetObject(...)
}
```

---

## 4. Root Causes

- **Lack of awareness** — developers don't know certain objects are expensive to create.
- **Stateless-first thinking** — over-applying the stateless principle where shared state (client, pool) is actually appropriate.
- **Copy-paste patterns** — tutorial/example code often shows inline instantiation for simplicity, not production use.
- **DI framework misuse** — injecting a factory when a singleton is appropriate; using `Transient` scope instead of `Singleton` in ASP.NET DI.
- **Thread-safety fears** — developers create new instances to avoid sharing state, even when the object is already thread-safe.
- **Lazy initialization done wrong** — creating a new instance inside a function "so it's always fresh."

---

## 5. Symptoms & Detection

| Symptom | Likely Cause |
|---|---|
| High latency on first few requests | Cold-path instantiation |
| Steady latency increase under load | Connection exhaustion from repeated init |
| `TIME_WAIT` / port exhaustion | New TCP connection per request, not reused |
| High CPU at low throughput | Object construction, GC pressure |
| Memory spikes | Large objects created and immediately GC'd |
| "Too many open files" errors | File/socket handles not pooled |

**Profiling tools to detect it:**

- **JVM**: Java Flight Recorder, async-profiler — look for allocation hotspots
- **Python**: `py-spy`, `memray` — track object allocations
- **Go**: `pprof` heap/alloc profiles
- **Network level**: `netstat`, Wireshark — identify excessive TCP connections
- **APM tools**: Datadog, New Relic — trace-level client init time

---

## 6. Trade-offs

### 6.1 Singleton / Shared Instance

| Dimension | Shared Instance | Per-Request Instance |
|---|---|---|
| **Latency** | ✅ Low — no init cost per call | ❌ High — pays init cost every time |
| **Memory** | ✅ Low — one object | ❌ High — N objects in-flight |
| **Throughput** | ✅ High — connection reuse | ❌ Low — OS overwhelmed by new connections |
| **Thread safety** | ⚠️ Must verify — object must be thread-safe | ✅ Trivial — each thread owns its instance |
| **Config flexibility** | ❌ Fixed at startup | ✅ Can reconfigure per-request |
| **Failure isolation** | ❌ One bad state affects all | ✅ Failures isolated per request |
| **Testability** | ⚠️ Harder to mock/replace | ✅ Easy to inject different instances |

### 6.2 Connection Pooling vs. Single Shared Connection

| Dimension | Connection Pool | Single Connection |
|---|---|---|
| **Concurrency** | ✅ Multiple concurrent requests | ❌ Serialized requests |
| **Resilience** | ✅ Dead connection replaced | ⚠️ Single failure breaks everything |
| **Resource usage** | ⚠️ N connections held open | ✅ Minimal resource usage |
| **Complexity** | ⚠️ Pool size tuning required | ✅ Simple |

### 6.3 Eager vs. Lazy Initialization

| Dimension | Eager (at startup) | Lazy (on first use) |
|---|---|---|
| **Startup time** | ❌ Slower startup | ✅ Faster startup |
| **First request latency** | ✅ No cold start | ❌ Cold start penalty |
| **Failure detection** | ✅ Fails fast at boot | ❌ Fails at runtime, under load |
| **Complexity** | ✅ Simple | ⚠️ Needs thread-safe lazy init (double-checked locking, `sync.Once`) |

---

## 7. Correct Patterns & Solutions

### 7.1 Singleton Pattern (Thread-Safe)

```java
// Java — thread-safe lazy singleton
public class HttpClientProvider {
    private static final HttpClient INSTANCE = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();

    public static HttpClient get() { return INSTANCE; }
}
```

```go
// Go — sync.Once for safe lazy init
var (
    redisOnce   sync.Once
    redisClient *redis.Client
)

func GetRedisClient() *redis.Client {
    redisOnce.Do(func() {
        redisClient = redis.NewClient(&redis.Options{Addr: "localhost:6379"})
    })
    return redisClient
}
```

### 7.2 Connection Pooling

```python
# Python — SQLAlchemy connection pool
engine = create_engine(
    DATABASE_URL,
    pool_size=10,        # maintained connections
    max_overflow=20,     # burst capacity
    pool_timeout=30,     # wait time before error
    pool_recycle=1800,   # recycle stale connections
)
```

```java
// Java — HikariCP (fastest JDBC pool)
HikariConfig config = new HikariConfig();
config.setJdbcUrl(DB_URL);
config.setMaximumPoolSize(20);
config.setMinimumIdle(5);
config.setConnectionTimeout(30_000);
HikariDataSource pool = new HikariDataSource(config);
```

### 7.3 Object Pooling for Non-Thread-Safe Objects

```java
// Apache Commons Pool for objects that can't be shared
GenericObjectPool<ExpensiveObject> pool = new GenericObjectPool<>(
    new ExpensiveObjectFactory(),
    poolConfig
);

ExpensiveObject obj = pool.borrowObject();
try {
    obj.doWork();
} finally {
    pool.returnObject(obj);
}
```

### 7.4 Dependency Injection Scoping

```csharp
// ASP.NET Core — correct DI scopes
services.AddSingleton<IHttpClientFactory>();    // ✅ shared, thread-safe
services.AddSingleton<IS3Client, S3Client>();  // ✅ shared SDK client
services.AddScoped<IDbContext, AppDbContext>(); // ✅ one per HTTP request
services.AddTransient<IEmailSender, SmtpSender>(); // ⚠️ only if truly stateless
```

### 7.5 Precompile Expensive Objects

```python
# Python — compile regex once at module level
PHONE_PATTERN = re.compile(r'^\+?1?\d{9,15}$')  # compiled once

def validate_phone(number: str) -> bool:
    return bool(PHONE_PATTERN.match(number))     # reused every call
```

---

## 8. Framework-Specific Gotchas

### HttpClient in .NET
```csharp
// ❌ WRONG — exhausts sockets (classic .NET antipattern)
using var client = new HttpClient();
await client.GetAsync(url);

// ✅ CORRECT — IHttpClientFactory manages pooled handlers
public class MyService {
    private readonly HttpClient _client;
    public MyService(IHttpClientFactory factory) {
        _client = factory.CreateClient("myApi");
    }
}
```

### boto3 in AWS Lambda
```python
# ❌ WRONG — recreated on every invocation inside handler
def lambda_handler(event, context):
    s3 = boto3.client('s3')  # expensive re-init
    return s3.get_object(...)

# ✅ CORRECT — initialized at module scope (reused across warm invocations)
s3 = boto3.client('s3')  # runs once per container

def lambda_handler(event, context):
    return s3.get_object(...)
```

### gRPC Channel Reuse
```go
// ❌ WRONG — new channel per call
func callService() {
    conn, _ := grpc.Dial("service:50051", grpc.WithInsecure())
    client := pb.NewServiceClient(conn)
    // ...
}

// ✅ CORRECT — channel created once
var conn, _ = grpc.Dial("service:50051", grpc.WithInsecure())
var grpcClient = pb.NewServiceClient(conn)
```

---

## 9. Pool Sizing Guidelines

Getting pool size wrong is almost as bad as not pooling at all.

```
Optimal Pool Size ≈ Number of CPU cores × (1 + Wait time / Service time)

Example:
  - 8 CPU cores
  - DB query takes 10ms, waits 90ms for I/O
  - Pool size = 8 × (1 + 90/10) = 8 × 10 = 80 connections
```

**HikariCP recommendation**: Pool size = `(core_count * 2) + effective_spindle_count`

| Signal | Action |
|---|---|
| Connection wait timeouts | Increase pool size or reduce query time |
| DB server connection limit hit | Introduce PgBouncer / ProxySQL |
| Low CPU, high latency | Pool undersized |
| High memory, low throughput | Pool oversized |

---

## 10. Real-World Systems & Applications

### 10.1 Netflix — HttpClient Instantiation Bug
Netflix's Hystrix documentation cites improper `HttpClient` instantiation as a primary source of latency in early microservice deployments. Each thread was creating its own client, exhausting ephemeral ports under load. The fix: a single shared `CloseableHttpClient` with a `PoolingHttpClientConnectionManager`.

### 10.2 AWS Lambda — Cold Start Optimization
AWS explicitly documents this pattern. Lambda containers are reused across invocations ("warm starts"). SDK clients (`boto3`, `aws-sdk`) initialized **outside** the handler function are reused across warm invocations — reducing per-invocation overhead by 50–300ms depending on the SDK. This is a core Lambda performance best practice.

### 10.3 Shopify — ActiveRecord Connection Pool Tuning
Shopify engineering has documented connection pool exhaustion as a recurring incident cause during traffic spikes. Each Rails process has a `connection_pool` — if requests exceed the pool size, they queue and timeout. Their fix involved carefully tuning `pool` in `database.yml` relative to Puma thread count, and introducing PgBouncer as a proxy to fan out connections.

### 10.4 Stripe — gRPC Channel Reuse
Stripe's internal services use gRPC extensively. Their engineering blog notes that creating a new channel per RPC call is catastrophically expensive — each channel bootstraps HTTP/2 connection, TLS negotiation, and flow control state. Their internal framework enforces singleton channel references per service endpoint.

### 10.5 .NET / ASP.NET Apps — HttpClient Socket Exhaustion
This is so common in the .NET ecosystem that Microsoft made it a documented antipattern. Apps creating `new HttpClient()` per request exhaust the socket pool, leading to `SocketException: Address already in use`. Microsoft introduced `IHttpClientFactory` in ASP.NET Core 2.1 explicitly to solve this — it manages a pool of `HttpMessageHandler` instances with controlled lifetimes.

### 10.6 Uber — Database Connection Pool Explosion
Uber's engineering blog describes early-stage issues where each microservice opened connections directly to Postgres, leading to thousands of open connections overwhelming the DB server (Postgres has a hard limit per `max_connections`). The solution: introduce **PgBouncer** as a connection pooler in transaction mode, reducing effective connections to the DB by 10–50x while maintaining high application-level concurrency.

### 10.7 Discord — Python `re` Module Precompilation
Discord's Python services (before their Rust migration) enforced a lint rule: no `re.compile()` inside function bodies. All regex patterns must be module-level constants. At hundreds of thousands of calls per second, even the nanosecond overhead of regex compilation accumulates measurably.

---

## 11. Decision Framework

```
Is the object expensive to create?
  ├── YES → Can it be safely shared across threads/requests?
  │           ├── YES → Singleton / module-level instance
  │           └── NO  → Object Pool (borrow/return pattern)
  └── NO  → Instantiate freely (no optimization needed)

Is the object a connection to external resource (DB, cache, HTTP)?
  └── YES → Use a Connection Pool, never raw instantiation

Is the object stateful per-request by design?
  └── YES → Scoped lifetime (one per request), NOT per-method

Is init cost only paid occasionally (e.g., Lambda cold start)?
  └── YES → Move init outside the hot path (module/global scope)
```

---

## 12. Monitoring & Observability

| Metric | Tool | What to Watch |
|---|---|---|
| Connection pool wait time | HikariCP JMX, PgBouncer stats | >5ms avg = undersized pool |
| Active vs. idle connections | DB `pg_stat_activity`, Redis `INFO clients` | idle >> active = oversized pool |
| Heap allocation rate | JFR, pprof, memray | Spikes correlate with request rate = inline instantiation |
| TCP `TIME_WAIT` count | `ss -s`, `netstat` | High count = connections not reused |
| GC pause frequency | JVM GC logs, Go runtime stats | Frequent minor GCs = short-lived large objects |
| Request latency p99 | Prometheus, Datadog | Bimodal distribution = cold vs warm path |

---

## 13. Summary

| Principle | Rule |
|---|---|
| **One per app** | HTTP clients, SDK clients, gRPC channels, thread pools |
| **Pooled** | DB connections, Redis connections, expensive non-thread-safe objects |
| **One per request** | DB sessions/transactions, per-user auth context |
| **Precompiled** | Regex, JSON schemas, protobuf descriptors |
| **Never inline** | Anything with a network handshake, TLS, or auth flow |

> The rule of thumb: **if an object talks to a network, holds OS resources, or compiles something — create it once.**