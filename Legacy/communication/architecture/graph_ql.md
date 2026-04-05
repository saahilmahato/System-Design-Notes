# GraphQL

## Table of Contents
1. [What is GraphQL?](#what-is-graphql)
2. [Core Concepts](#core-concepts)
3. [Architecture](#architecture)
4. [Schema Design](#schema-design)
5. [Operations](#operations)
6. [Resolvers](#resolvers)
7. [DataLoader & N+1 Problem](#dataloader--n1-problem)
8. [Caching](#caching)
9. [Pagination](#pagination)
10. [Security](#security)
11. [Federation & Microservices](#federation--microservices)
12. [Trade-offs](#trade-offs)
13. [GraphQL vs REST vs gRPC](#graphql-vs-rest-vs-grpc)
14. [Real-World Systems & Applications](#real-world-systems--applications)
15. [Decision Framework](#decision-framework)
16. [Anti-Patterns](#anti-patterns)
17. [Monitoring & Observability](#monitoring--observability)

---

## What is GraphQL?

GraphQL is a **query language for APIs** and a **runtime for executing those queries**, developed by Facebook in 2012 and open-sourced in 2015. Unlike REST, which exposes multiple fixed endpoints, GraphQL exposes a **single endpoint** through which clients declare exactly what data they need.

### The Core Problem GraphQL Solves

| Problem | REST | GraphQL |
|---|---|---|
| Over-fetching | Returns all fields even if client needs 2 | Client specifies exactly which fields |
| Under-fetching | Multiple round trips for related data | Single query fetches nested relations |
| Versioning | `/v1/`, `/v2/` sprawl | Schema evolves; deprecated fields are annotated |
| Discoverability | External docs (Swagger/OpenAPI) | Introspection built into the protocol |

### Key Properties
- **Strongly typed** — every field has a declared type; schema is the source of truth
- **Hierarchical** — queries mirror the shape of the response
- **Client-driven** — the client, not the server, controls the response shape
- **Single endpoint** — typically `POST /graphql`
- **Introspective** — clients can query the schema itself

---

## Core Concepts

### Type System

```graphql
# Scalar types: Int, Float, String, Boolean, ID
# Object types
type User {
  id: ID!
  name: String!
  email: String!
  posts: [Post!]!
  createdAt: String!
}

type Post {
  id: ID!
  title: String!
  body: String
  author: User!
  tags: [String!]
  publishedAt: String
}

# ! denotes non-nullable
# [Post!]! means non-null list of non-null Post objects
```

### Input Types
Used for mutations to group arguments cleanly:

```graphql
input CreatePostInput {
  title: String!
  body: String!
  tags: [String!]
}

type Mutation {
  createPost(input: CreatePostInput!): Post!
}
```

### Enums, Interfaces, Unions

```graphql
enum PostStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

interface Node {
  id: ID!
}

union SearchResult = User | Post | Comment
```

---

## Architecture

### Execution Flow

```
Client Request
      │
      ▼
┌─────────────────┐
│  GraphQL Layer  │  ← Single endpoint (POST /graphql)
│  ─────────────  │
│  1. Parse       │  ← Tokenize & build AST
│  2. Validate    │  ← Check against schema
│  3. Execute     │  ← Walk AST, call resolvers
└────────┬────────┘
         │
   ┌─────┴──────┐
   │  Resolvers │
   └─────┬──────┘
         │
   ┌─────┴────────────────────────────────┐
   │ Data Sources                         │
   │  ┌──────────┐ ┌──────┐ ┌─────────┐  │
   │  │ Database │ │ REST │ │  Cache  │  │
   │  └──────────┘ └──────┘ └─────────┘  │
   └──────────────────────────────────────┘
```

### Gateway Pattern
In large systems, a **GraphQL Gateway** (BFF — Backend For Frontend) sits in front of multiple downstream services:

```
Mobile Client ──┐
Web Client    ──┼──► GraphQL Gateway ──► User Service (REST/gRPC)
IoT Client    ──┘                    ──► Order Service (REST/gRPC)
                                     ──► Inventory Service (gRPC)
                                     ──► Notification Service
```

The gateway stitches together responses from multiple services into a single GraphQL response.

---

## Schema Design

### Schema-First vs Code-First

| Approach | Description | Tools | When to Use |
|---|---|---|---|
| **Schema-First** | Write SDL, generate types | graphql-tools, Apollo | Team collaboration, contract-driven |
| **Code-First** | Write resolvers, generate SDL | Nexus, TypeGraphQL | Rapid iteration, type-safe backends |

### Schema Design Principles

**1. Model the domain, not the database**
```graphql
# BAD — leaks internal data model
type User {
  user_id: Int
  first_nm: String
  last_nm: String
}

# GOOD — clean domain model
type User {
  id: ID!
  firstName: String!
  lastName: String!
  fullName: String!   # computed field
}
```

**2. Use connections for lists (Relay spec)**
```graphql
type UserConnection {
  edges: [UserEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type UserEdge {
  node: User!
  cursor: String!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}
```

**3. Design mutations around intent**
```graphql
# BAD — generic CRUD
mutation {
  updateUser(id: "1", data: { status: "ACTIVE" })
}

# GOOD — intent-driven
mutation {
  activateUser(id: "1") { id status }
  suspendUser(id: "1", reason: "Policy violation") { id status }
}
```

**4. Consistent error handling**
```graphql
type CreateOrderPayload {
  order: Order
  errors: [UserError!]!
}

type UserError {
  field: String
  message: String!
  code: ErrorCode!
}
```

### Schema Versioning & Evolution
GraphQL favors **additive evolution** over versioning:
- Add new fields freely; never remove them immediately
- Deprecate with `@deprecated(reason: "Use newField instead")`
- Monitor field usage before removal via field-level tracing
- Avoid breaking changes: changing argument types, removing fields, changing nullability

---

## Operations

### Query — Read Data

```graphql
query GetUserWithPosts($userId: ID!, $first: Int = 10) {
  user(id: $userId) {
    id
    name
    email
    posts(first: $first) {
      edges {
        node {
          id
          title
          publishedAt
        }
      }
    }
  }
}
```

### Mutation — Write Data

```graphql
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    id
    title
    author {
      name
    }
    errors {
      field
      message
    }
  }
}
```

### Subscription — Real-Time Data

```graphql
subscription OnCommentAdded($postId: ID!) {
  commentAdded(postId: $postId) {
    id
    body
    author {
      name
      avatar
    }
  }
}
```

Subscriptions are typically implemented over **WebSockets** (graphql-ws protocol) or **Server-Sent Events (SSE)**.

### Fragments — Reusable Field Sets

```graphql
fragment PostSummary on Post {
  id
  title
  publishedAt
  author { name }
}

query {
  featuredPosts { ...PostSummary }
  recentPosts { ...PostSummary }
}
```

---

## Resolvers

### Resolver Chain

Every field in a GraphQL schema has a corresponding resolver. Resolvers are invoked recursively as the execution engine walks the query AST.

```
Query.user(id)             → fetches User row
  └── User.posts           → fetches Posts for user
        └── Post.author    → fetches User for each post (N+1 risk!)
              └── User.name → trivially resolved
```

### Resolver Anatomy

```javascript
const resolvers = {
  Query: {
    user: async (parent, { id }, context, info) => {
      // parent  — result of the parent resolver
      // args    — arguments passed to this field
      // context — shared object (auth, dataloaders, db)
      // info    — AST info, field selection set
      return context.db.users.findById(id);
    }
  },
  User: {
    posts: (user, { first }, context) => {
      return context.db.posts.findByUserId(user.id, { limit: first });
    },
    fullName: (user) => `${user.firstName} ${user.lastName}` // trivial
  }
};
```

### Context — Dependency Injection
The context object is constructed **per request** and injected into every resolver:

```javascript
const server = new ApolloServer({
  schema,
  context: ({ req }) => ({
    user: authenticate(req),           // current user
    db: dataSources.db,                // database client
    loaders: createDataLoaders(),      // per-request DataLoaders
    cache: redisClient,                // shared cache
  })
});
```

---

## DataLoader & N+1 Problem

### The N+1 Problem

```graphql
query {
  posts {           # 1 query → 10 posts
    author {        # 10 queries → 1 user each = 11 total queries!
      name
    }
  }
}
```

### DataLoader Solution

DataLoader **batches** and **caches** individual loads within a single tick of the event loop:

```javascript
const userLoader = new DataLoader(async (userIds) => {
  // Called once with [id1, id2, ..., id10]
  const users = await db.users.findByIds(userIds);
  // Must return results in same order as keys
  return userIds.map(id => users.find(u => u.id === id));
});

// In resolver:
User: {
  author: (post, _, { loaders }) => loaders.user.load(post.authorId)
  // 10 calls to .load() → batched into 1 DB query
}
```

### DataLoader Mechanics

```
Tick 1:  .load(1) .load(2) .load(3)   → batched → SELECT WHERE id IN (1,2,3)
                                          → cached per-request
Tick 2:  .load(2)                      → served from in-memory cache (no DB hit)
```

**Key properties:**
- **Batching** — coalesces multiple loads into one query per tick
- **Per-request caching** — deduplicates within a single request lifecycle
- **Ordered results** — must return values in the same order as input keys
- **Cache is not shared** across requests (use Redis for that)

---

## Caching

### Why GraphQL Caching is Hard

REST uses URL-based HTTP caching (`Cache-Control`, `ETag`). GraphQL uses a **single POST endpoint**, which makes HTTP caching ineffective by default.

### Caching Strategies

| Level | Strategy | Mechanism | Scope |
|---|---|---|---|
| **CDN / HTTP** | Persisted queries + GET | Hashed query ID as URL param | Public data |
| **Resolver-level** | Cache resolver output | Redis / in-memory | Per entity |
| **Response-level** | Full response cache | Apollo ResponseCache plugin | Per operation |
| **Client-level** | Normalized cache | Apollo Client, Relay | Client-side |

### Persisted Queries
Convert POST to GET by sending a hash instead of the full query body:

```
# Registration (dev/build time):
POST /graphql  { query: "{ user(id: $id) { name } }" }
→ hash: abc123

# Runtime:
GET /graphql?operationName=GetUser&variables={"id":"1"}&extensions={"persistedQuery":{"version":1,"sha256Hash":"abc123"}}
→ CDN-cacheable!
```

### Automatic Persisted Queries (APQ)
Apollo's APQ flow:
1. Client sends hash only
2. Server responds `PersistedQueryNotFound` if unknown
3. Client resends with full query body
4. Server caches hash → query mapping

### Client-Side Normalized Cache (Apollo Client)

Apollo Client normalizes responses into a flat, entity-keyed store:

```
Cache store:
  User:1 → { id: "1", name: "Alice", __typename: "User" }
  Post:5 → { id: "5", title: "GraphQL", author: → User:1 }
```

When any query updates `User:1`, all components subscribed to that entity re-render automatically.

---

## Pagination

### Offset Pagination

```graphql
query {
  posts(offset: 20, limit: 10) { id title }
}
```

**Pros:** Simple, supports random page access  
**Cons:** Inconsistent under insertions/deletions; poor at scale

### Cursor-Based Pagination (Relay Spec)

```graphql
query {
  posts(first: 10, after: "cursor_abc") {
    edges { node { id title } cursor }
    pageInfo { hasNextPage endCursor }
  }
}
```

**Pros:** Stable under mutations; efficient for infinite scroll; works with keyset indexes  
**Cons:** No random page access; more complex client logic

### Cursor Implementation
Cursor is typically an opaque base64-encoded value encoding the sort key:

```
cursor = base64("Post:createdAt:2024-01-15T10:00:00Z:id:abc123")
→ SQL: WHERE (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT 10
```

---

## Security

### Query Depth Limiting

Prevent deeply nested malicious queries:

```graphql
# Attack: exponentially expensive
{ user { friends { friends { friends { friends { name } } } } } }
```

Mitigation: set `maxDepth: 5` — reject queries exceeding depth threshold.

### Query Complexity Analysis

Assign a cost to each field; reject queries exceeding a budget:

```javascript
// Field costs
User: 1
User.posts: 5
User.posts.comments: 10

// Query cost = sum of all field costs × list multipliers
// Reject if cost > 1000
```

### Rate Limiting GraphQL

REST rate limiting (per endpoint) doesn't map cleanly to GraphQL. Prefer:
- **Complexity-based throttling** — rate limit based on query cost, not request count
- **Per-user limits** — track cost consumed per user per time window
- **Persisted queries only** — reject ad-hoc queries in production

### Other Security Concerns

| Threat | Mitigation |
|---|---|
| Introspection abuse | Disable introspection in production |
| Batching attacks | Limit batch operation count |
| Field suggestion leakage | Disable `didYouMean` in production |
| Authorization bypass | Field-level auth in resolvers (never schema-level only) |
| Injection via variables | Parameterized queries; validate input types |

### Authorization Patterns

```javascript
// BAD — schema-level only (bypassed by direct resolver calls)
type Query {
  adminDashboard: Dashboard @auth(role: ADMIN)
}

// GOOD — resolver-level enforcement
Query: {
  adminDashboard: (_, __, { user }) => {
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenError('Insufficient permissions');
    }
    return fetchDashboard();
  }
}
```

---

## Federation & Microservices

### The Problem at Scale
As services grow, a monolithic GraphQL schema becomes a bottleneck — all teams must coordinate changes in one place.

### Apollo Federation

Federation allows multiple GraphQL services to each own a **slice of the schema**, composed into a unified supergraph by a **Router** (gateway):

```
Supergraph (Router)
  ├── User Subgraph     → owns: User type
  ├── Product Subgraph  → owns: Product type
  ├── Order Subgraph    → owns: Order type, references User & Product
  └── Review Subgraph   → owns: Review type, references User & Product
```

### Entity References (Federation)

```graphql
# User subgraph — defines the canonical User type
type User @key(fields: "id") {
  id: ID!
  name: String!
  email: String!
}

# Order subgraph — extends User with order-specific data
type User @key(fields: "id") @extends {
  id: ID! @external
  orders: [Order!]!
}
```

The router stitches these at query time, issuing sub-queries to each subgraph and merging results.

### Federation Query Planning

```
Client: { user(id: "1") { name orders { total } } }

Router plan:
  Step 1: user_subgraph  → { user(id:"1") { name } }
  Step 2: order_subgraph → { _entities(representations:[{__typename:"User",id:"1"}]) { orders { total } } }
  Merge results → return to client
```

### Schema Stitching vs Federation

| Aspect | Schema Stitching | Apollo Federation |
|---|---|---|
| Ownership | Central gateway controls all | Each subgraph owns its types |
| Coupling | High (gateway knows all schemas) | Low (subgraphs declare extensions) |
| Type merging | Manual | Automatic via `@key` directives |
| Failure isolation | Poor | Better |
| Adoption | Legacy | Industry standard |

---

## Trade-offs

### Advantages

| Advantage | Detail |
|---|---|
| **No over/under-fetching** | Client requests exactly what it needs — critical for mobile bandwidth |
| **Single round trip** | Fetch deeply nested relational data in one request |
| **Strongly typed contract** | Schema is a living API contract; mismatches caught at validate time |
| **Rapid UI iteration** | Frontend teams evolve queries without backend changes |
| **Self-documenting** | Introspection provides always-accurate API docs |
| **Ecosystem & tooling** | Apollo, GraphiQL, Relay, code generation, schema registry |

### Disadvantages

| Disadvantage | Detail |
|---|---|
| **Caching complexity** | No URL-based HTTP caching; requires persisted queries or custom cache keys |
| **N+1 query problem** | Naive resolver implementation causes query explosion (requires DataLoader) |
| **Query complexity** | Clients can craft expensive queries; requires depth/complexity limits |
| **File uploads** | Not natively supported; requires multipart spec or presigned URLs |
| **Over-engineering overhead** | Small APIs benefit more from simple REST |
| **Learning curve** | Schema design, resolvers, DataLoader, federation — high initial complexity |
| **Error handling** | Always returns HTTP 200; partial errors embedded in response body |
| **Monitoring difficulty** | All ops share one endpoint; need operation-name-level APM |

### When to Use GraphQL

**Use GraphQL when:**
- Multiple client types (web, mobile, IoT) with divergent data needs
- Highly relational domain where clients often fetch nested entities
- Rapidly evolving frontend that outpaces backend API changes
- You need a unified API facade over multiple microservices

**Avoid GraphQL when:**
- Simple CRUD APIs with predictable access patterns
- Streaming large binary/file payloads
- Public APIs where cacheability is paramount
- Small teams without bandwidth to invest in the tooling overhead

---

## GraphQL vs REST vs gRPC

| Dimension | GraphQL | REST | gRPC |
|---|---|---|---|
| **Protocol** | HTTP (POST) | HTTP 1.1/2 | HTTP/2 |
| **Format** | JSON | JSON / XML | Protobuf (binary) |
| **Contract** | SDL Schema | OpenAPI / informal | `.proto` files |
| **Typing** | Strong | Weak (OpenAPI adds it) | Strong |
| **Caching** | Hard (custom) | Easy (HTTP native) | Hard |
| **Streaming** | Subscriptions (WS) | SSE / WebSocket | Bidirectional streaming |
| **Performance** | Moderate | Moderate | High |
| **Browser support** | Native | Native | Needs grpc-web |
| **Best for** | Client-facing APIs | Public/simple APIs | Internal service-to-service |
| **Learning curve** | High | Low | Medium |

---

## Real-World Systems & Applications

### Facebook / Meta
The origin of GraphQL. Used to power the Facebook News Feed — mobile clients in 2012 suffered from REST over-fetching over slow 3G connections. GraphQL enabled mobile clients to specify exactly the fields needed, dramatically reducing payload sizes.

### GitHub API v4
GitHub migrated from REST (v3) to GraphQL (v4). Key motivations: REST responses returned ~30KB even when clients needed ~2KB. With GraphQL, clients fetch exactly the repository, PR, and issue fields they need. The GitHub GraphQL API also uses cursor-based Relay pagination.

### Shopify
Shopify's Storefront API and Admin API are both GraphQL. Shopify adopted GraphQL to support their diverse merchant ecosystem — storefronts, apps, and mobile clients all have radically different data requirements. Shopify also uses Apollo Federation internally.

### Twitter / X
Used GraphQL internally for powering the Twitter for Web experience. Tweet threads, timelines, and user cards involve deeply nested relational data — a strong GraphQL use case.

### Netflix
Netflix uses GraphQL Federation to power their API gateway. Different domain teams (user profiles, recommendations, billing, streaming quality) each own their subgraph. The Federated Router composes queries across subgraphs for the client-facing API.

### Airbnb
Airbnb adopted GraphQL for their listing pages. A single listing query fetches the property details, host profile, pricing calendar, reviews, and nearby experiences — data that would require 5–6 REST round trips — in a single request.

### Stripe
Stripe's Dashboard is powered internally by GraphQL. Stripe uses it to support multiple client surfaces (web dashboard, mobile app, CLI) with different data needs, without maintaining multiple dedicated endpoints.

### Atlassian (Jira, Confluence)
Atlassian's cloud platform uses GraphQL as the integration layer between their products. Jira and Confluence data is federated into a single graph, enabling cross-product queries ("show me Confluence pages linked to this Jira issue").

---

## Decision Framework

### Should You Use GraphQL?

```
1. Do you have multiple client types (web, mobile, TV)?
   YES → strong GraphQL signal
   NO  → REST may be simpler

2. Do clients frequently request deeply nested relational data?
   YES → GraphQL avoids multiple round trips
   NO  → REST is predictable enough

3. Is your frontend team iterating faster than your backend?
   YES → GraphQL decouples frontend from backend API changes
   NO  → REST contract is fine

4. Do you need a unified facade over multiple microservices?
   YES → GraphQL Federation / BFF Gateway
   NO  → Service-specific REST APIs

5. Is caching and CDN distribution critical?
   YES → REST or consider persisted queries in GraphQL
   NO  → GraphQL caching is manageable

6. Is this an internal service-to-service API?
   YES → gRPC (better performance, bidirectional streaming)
   NO  → GraphQL or REST
```

### Schema Design Checklist

- [ ] Model domain objects, not database tables
- [ ] All lists use cursor-based pagination (Relay spec)
- [ ] Mutations return a payload type with both result and errors
- [ ] Errors use typed UserError (not generic strings)
- [ ] Deprecated fields annotated with `@deprecated` before removal
- [ ] Input types used for complex mutation arguments
- [ ] Query depth and complexity limits configured
- [ ] Field-level authorization enforced in resolvers
- [ ] DataLoaders wired for all relational resolver paths
- [ ] Introspection disabled in production

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **Resolvers hitting DB directly** | No batching, N+1 explosion | Use DataLoaders for all entity loads |
| **Exposing internal DB schema** | Tight coupling, security risk | Design domain-oriented types |
| **Ignoring query complexity** | DoS via expensive nested queries | Implement depth + complexity limits |
| **Skipping authorization in resolvers** | Directive-only auth is bypassable | Always enforce auth in resolver logic |
| **Shared DataLoader across requests** | Cache poisoning between users | Create fresh DataLoader instances per request |
| **Mutation-per-CRUD-field** | Loses semantic intent, hard to validate | Model mutations around business operations |
| **Giant monolithic schema** | All teams blocked on one schema | Migrate to Federation; divide by domain |
| **Returning HTTP 400/500 for domain errors** | Breaks GraphQL contract | Embed domain errors in response payload |
| **Unrestricted introspection** | Schema leakage in production | Disable or restrict introspection |
| **Over-using subscriptions** | WebSocket overhead for infrequent data | Use polling or webhooks instead |

---

## Monitoring & Observability

### Key Metrics to Track

| Metric | Description | Alert Threshold |
|---|---|---|
| **Operation error rate** | % of operations returning errors | > 1% for critical operations |
| **Resolver latency (p99)** | Per-resolver execution time | > 500ms |
| **Query complexity score** | Avg/p99 complexity of accepted queries | Monitor for spikes |
| **DataLoader batch size** | Avg batch size per request | Low batch size = N+1 leaking |
| **DataLoader cache hit rate** | % of loads served from cache | < 50% may indicate duplicate loads |
| **WebSocket connection count** | Active subscription connections | Capacity planning |
| **Field usage rate** | How often each field is requested | Enables safe deprecation |

### Tooling

| Tool | Purpose |
|---|---|
| **Apollo Studio** | Schema registry, operation tracing, field usage analytics |
| **GraphQL Armor** | Security middleware (depth, complexity, rate limits) |
| **DataDog APM** | Trace per-operation, per-resolver latency |
| **OpenTelemetry** | Vendor-neutral distributed tracing across resolvers |
| **GraphQL Hive** | Open-source schema registry & usage analytics |

### Distributed Tracing
Each GraphQL operation should carry a `x-request-id` / `traceparent` header, propagated through all resolver calls and downstream service calls. This enables tracing a single client query end-to-end through resolvers, DataLoaders, and microservices.

```
Client Request (trace-id: abc)
  └── Query.posts (resolver span)
        └── DataLoader.batch (span: DB query)
        └── Post.author (resolver span)
              └── DataLoader.batch (span: DB query)
```