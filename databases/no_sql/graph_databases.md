# NoSQL: Graph Databases

---

## 1. What is a Graph Database?

A **graph database** is a NoSQL database that uses **graph structures** — nodes, edges, and properties — to store, map, and query relationships. Unlike relational databases that use foreign keys and JOIN operations to represent relationships, graph databases treat relationships as **first-class citizens**, stored explicitly alongside the data.

### Core Primitives

| Primitive  | Description                                                   | Example                         |
|------------|---------------------------------------------------------------|---------------------------------|
| **Node**   | An entity or object                                           | `User`, `Product`, `Location`   |
| **Edge**   | A directed relationship between two nodes                     | `FOLLOWS`, `PURCHASED`, `LIVES_IN` |
| **Property** | Key-value pair attached to a node or edge                  | `{name: "Alice"}`, `{since: 2021}` |
| **Label**  | A category tag for a node (in labeled property graph models)  | `:Person`, `:Movie`             |

### Graph Models

- **Labeled Property Graph (LPG)** — Nodes and edges both carry properties and labels. Used by Neo4j, Amazon Neptune (LPG mode), JanusGraph.
- **RDF (Resource Description Framework)** — Triples of `(subject, predicate, object)`. Used by Amazon Neptune (RDF mode), Apache Jena. W3C standard.

---

## 2. How Graph Databases Work

### Storage Layer
Graph DBs store adjacency lists natively. Each node holds direct pointers to its adjacent edges, enabling **O(1) local traversal** regardless of total graph size — called **index-free adjacency**. This is fundamentally different from SQL JOINs which scan foreign key indexes at query time.

```
Node(Alice) --> [FOLLOWS --> Node(Bob), FOLLOWS --> Node(Carol)]
Node(Bob)   --> [FOLLOWS --> Node(Dave)]
```

### Query Language
- **Cypher** (Neo4j, Amazon Neptune LPG) — Declarative, ASCII-art syntax for pattern matching
- **Gremlin** (Apache TinkerPop, JanusGraph, Amazon Neptune) — Imperative, traversal-based
- **SPARQL** (RDF stores) — SQL-like syntax for triple stores

#### Cypher Example
```cypher
-- Find all friends-of-friends of Alice, who are not direct friends
MATCH (alice:User {name: "Alice"})-[:FOLLOWS*2]->(fof:User)
WHERE NOT (alice)-[:FOLLOWS]->(fof)
RETURN fof.name, COUNT(*) AS mutuals
ORDER BY mutuals DESC
LIMIT 10
```

#### Gremlin Example
```groovy
g.V().has('name', 'Alice')
  .out('FOLLOWS').out('FOLLOWS')
  .dedup()
  .values('name')
```

---

## 3. Graph Database Algorithms

Graph databases are optimized for these algorithmic patterns:

| Algorithm                   | Use Case                                 |
|-----------------------------|------------------------------------------|
| **BFS / DFS traversal**     | Finding connections, reachability checks |
| **Shortest path** (Dijkstra, A*) | Routing, navigation, degrees of separation |
| **PageRank**                | Ranking nodes by influence               |
| **Community Detection**     | Clustering users, fraud ring discovery   |
| **Betweenness Centrality**  | Finding critical nodes/bridges           |
| **Triangle Counting**       | Social network density, fraud detection  |
| **Louvain / Label Propagation** | Modularity-based clustering          |

---

## 4. Graph Databases vs. Relational Databases

| Dimension              | Relational (SQL)                         | Graph DB                                  |
|------------------------|------------------------------------------|-------------------------------------------|
| **Relationship model** | Foreign keys, JOIN tables                | Native edges, index-free adjacency        |
| **Query depth**        | Performance degrades with JOIN depth     | Constant-time traversal regardless of depth |
| **Schema**             | Rigid, pre-defined schema                | Flexible, schema-optional                 |
| **Traversal**          | O(log n) per JOIN via index scan         | O(1) per hop via pointer chasing          |
| **Best for**           | Structured, tabular data with aggregates | Highly connected, relationship-centric data |
| **Multi-hop queries**  | Expensive (self-JOINs compound)          | Natural and efficient                     |

### SQL vs. Graph: Friends-of-Friends at depth 3
```sql
-- SQL: 3 self-joins, each hitting the full table index
SELECT u3.name FROM users u1
JOIN friendships f1 ON u1.id = f1.user_id
JOIN users u2 ON f1.friend_id = u2.id
JOIN friendships f2 ON u2.id = f2.user_id
JOIN users u3 ON f2.friend_id = u3.id
JOIN friendships f3 ON u3.id = f3.user_id
WHERE u1.name = 'Alice';
```

```cypher
-- Cypher: One pattern match, traverses pointers
MATCH (:User {name: "Alice"})-[:FRIENDS*3]->(fof)
RETURN fof.name
```

---

## 5. Trade-offs

### Advantages
- **Relationship-first performance** — Deep, multi-hop traversals stay fast as data grows; relational DBs slow exponentially with JOIN depth.
- **Expressive queries** — Pattern matching queries are natural and readable for relationship problems.
- **Flexible schema** — Nodes and edges can carry different properties; no need for `NULL` columns or sparse tables.
- **Real-time recommendations** — Collaborative filtering and similarity queries run efficiently.
- **Fraud detection** — Graph patterns (rings, velocities, shared attributes) are intuitive to query.

### Disadvantages
- **Poor for aggregate/analytical workloads** — Summing revenue, computing averages, or running GROUP BY operations across large tables is slower than OLAP/SQL.
- **Limited horizontal scalability** — Graph partitioning is NP-hard; cutting a graph into shards creates cross-shard edges that require expensive network hops. Most graph DBs scale vertically better than horizontally.
- **Smaller ecosystem** — Fewer BI tools, less SQL tooling familiarity, smaller talent pool compared to RDBMS.
- **Memory-intensive** — Many graph DBs keep graph topology in memory for fast traversals.
- **Write throughput at scale** — High-concurrency writes with complex consistency guarantees are harder than in key-value or document stores.
- **Data modeling curve** — Thinking in graphs requires a mental shift; over-normalizing or under-normalizing the graph is a common mistake.

### When to Use vs. Avoid

| Use Graph DB when...                                     | Avoid / Use SQL when...                            |
|----------------------------------------------------------|----------------------------------------------------|
| Relationships are the primary query concern              | Primary access pattern is tabular aggregations     |
| Traversal depth is variable or deep (≥3 hops)           | Well-defined, flat schema with predictable queries |
| Schema is evolving and heterogeneous                     | Joins are shallow and infrequent                   |
| Real-time social, recommendation, or fraud queries needed | Strong ACID transactional requirements             |
| Connected component or path-finding is needed            | Large-scale analytics / data warehousing           |

---

## 6. Architecture Patterns

### Architecture Diagram
```
┌────────────────────────────────────────────────────────┐
│                  Application Layer                     │
│           (Cypher / Gremlin / REST API)                │
└────────────────────┬───────────────────────────────────┘
                     │
┌────────────────────▼───────────────────────────────────┐
│               Graph Database Engine                    │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────┐  │
│  │  Query       │  │  Traversal     │  │ Index      │  │
│  │  Planner     │  │  Engine        │  │ (Node/Edge │  │
│  │  (Cypher/    │  │  (BFS/DFS/     │  │  Properties│  │
│  │   Gremlin)   │  │   Dijkstra)    │  │  Lookups)  │  │
│  └──────────────┘  └────────────────┘  └────────────┘  │
└────────────────────┬───────────────────────────────────┘
                     │
┌────────────────────▼───────────────────────────────────┐
│                  Storage Layer                         │
│  ┌──────────────────────┐  ┌──────────────────────┐    │
│  │  Adjacency Lists     │  │  Property Store      │    │
│  │  (Topology / Edges)  │  │  (Node/Edge Data)    │    │
│  └──────────────────────┘  └──────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

### Deployment Patterns

**1. Standalone Graph Store (Primary DB)**
- Graph DB is the system of record for entities and their relationships.
- Best for small-to-medium graphs where all data is highly relational.

**2. Polyglot Persistence (Graph + Primary DB)**
- Primary data lives in SQL/Document DB; graph layer mirrors relationships for traversal queries only.
- Graph is kept in sync via CDC (Change Data Capture) from the primary DB.
- Uber, LinkedIn use this pattern: Postgres as source of truth, graph for recommendations.

**3. Graph + Cache Layer**
- Precompute traversal results (e.g., top-10 recommendations) and cache in Redis.
- Avoids re-traversing large subgraphs on every request.

---

## 7. Scalability Considerations

### Vertical Scaling
Graph DBs like Neo4j scale well vertically. Keep the entire graph in RAM when possible; NVMe SSDs are the next tier for cold graph data.

### Horizontal Scaling (Sharding)
Graph partitioning is fundamentally difficult — cutting a connected graph across nodes creates **cross-partition edges**, which require network round-trips on traversal. Strategies:

| Strategy                    | Description                                                      | Tradeoff                                    |
|-----------------------------|------------------------------------------------------------------|---------------------------------------------|
| **Domain-based partitioning** | Partition by subgraph domain (e.g., US users vs. EU users)      | Works if most traversals stay within a shard |
| **Hash partitioning**        | Hash node ID to a shard                                          | Simple, but cross-shard traversals are expensive |
| **Label-based partitioning** | Separate shards per node type (e.g., Users vs. Products)         | Works if cross-type edges are uncommon      |
| **Replication**              | Replicate entire graph to read replicas                          | Read scalability only; write bottleneck     |

### Replication
- Leader-follower replication is standard (Neo4j Causal Clustering, JanusGraph + Cassandra/HBase backend).
- Read replicas serve traversal-heavy read workloads.
- Writes go to the primary; bookmarks/causal chaining ensures read-after-write consistency.

---

## 8. Data Modeling Best Practices

### Node vs. Edge Design Rules
- **Nouns → Nodes**: Entities with their own properties and identity.
- **Verbs → Edges**: Actions or relationships between entities.
- **Avoid super-nodes**: A node with millions of edges (e.g., a viral celebrity) becomes a traversal bottleneck. Introduce intermediate "fan-out" nodes or skip traversing it directly.

```
❌ Bad: (Celebrity)-[:FOLLOWED_BY]->(1M Users)  -- super-node
✅ Better: Batch/paginate traversal or use interest-based intermediate nodes
```

### Property Placement
- Put properties that filter traversal entry points on **nodes** (for index lookups).
- Put properties describing the relationship itself on **edges** (`since`, `weight`, `type`).

```cypher
-- Edge property: when did Alice follow Bob?
(Alice)-[:FOLLOWS {since: "2022-03-15", source: "mobile"}]->(Bob)
```

---

## 9. Popular Graph Databases

| Database            | Model          | Query Language      | Managed Cloud               | Notes                                            |
|---------------------|----------------|---------------------|-----------------------------|--------------------------------------------------|
| **Neo4j**           | LPG            | Cypher              | Neo4j AuraDB                | Most widely used; strong community; ACID-compliant |
| **Amazon Neptune**  | LPG + RDF      | Gremlin, Cypher, SPARQL | AWS managed              | Serverless option; integrates with AWS ecosystem |
| **JanusGraph**      | LPG (TinkerPop)| Gremlin             | Self-hosted / cloud backends| Pluggable storage (Cassandra, HBase, BerkeleyDB) |
| **TigerGraph**      | LPG            | GSQL                | TigerGraph Cloud            | Designed for large-scale parallel graph analytics |
| **ArangoDB**        | Multi-model    | AQL                 | ArangoDB Cloud              | Graph + Document + Key-Value in one engine       |
| **Dgraph**          | LPG            | GraphQL+            | Dgraph Cloud                | GraphQL-native; distributed by design            |
| **Microsoft Azure Cosmos DB (Gremlin API)** | LPG | Gremlin | Azure managed | Multi-model; graph as an access layer          |

---

## 10. Real-World Systems and Applications

### LinkedIn — People You May Know (PYMK)
- **Problem**: Recommend new connections based on mutual friends, shared companies, and skills.
- **Graph model**: Nodes = Members, Companies, Schools. Edges = CONNECTED_TO, WORKED_AT, ATTENDED.
- **Pattern**: 2nd and 3rd-degree connection traversal, weighted by mutual connection count.
- **Stack**: Custom distributed graph engine (called Expander), Hadoop for batch offline graph computation.
- **Scale**: 900M+ member nodes, billions of edges.

### Facebook — Social Graph
- **Problem**: Power friend recommendations, news feed ranking, and privacy enforcement.
- **Graph model**: TAO (The Associations and Objects) — a distributed key-value store optimized for graph-like access patterns.
- **Pattern**: Fan-out reads (who follows me?), social context computation (how many mutual friends?).
- **Scale**: TAO handles billions of reads/second across a graph of billions of users.

### Netflix — Content Recommendation
- **Problem**: Recommend movies/shows based on viewing history, ratings, and user similarity.
- **Graph model**: Nodes = Users, Movies, Genres, Tags. Edges = WATCHED, RATED, BELONGS_TO.
- **Pattern**: Collaborative filtering via graph traversal — find users similar to me (shared watches), then surface what they watched that I haven't.
- **Outcome**: ~80% of content watched on Netflix is attributed to recommendation engine.

### Uber — Map and ETA Graph
- **Problem**: Shortest-path routing and ETA computation across road networks.
- **Graph model**: Nodes = Road intersections/segments. Edges = Road segments with travel time weights.
- **Pattern**: Dijkstra / A* shortest path on dynamic edge weights (updated in real-time by traffic).
- **Stack**: H3 hexagonal grid system, custom routing engine backed by graph primitives.

### PayPal / Stripe — Fraud Detection
- **Problem**: Detect fraud rings, account takeovers, and money laundering patterns.
- **Graph model**: Nodes = Users, Devices, IP Addresses, Bank Accounts, Cards. Edges = USED, SHARES_DEVICE, TRANSFERRED_TO.
- **Pattern**: Community detection to find clusters of accounts sharing devices/IPs; ring detection to find circular fund transfers.
- **Why graph**: A fraudster using 50 accounts that all share the same device IP is invisible in row-based data but obvious in a graph cluster.

### Google — Knowledge Graph
- **Problem**: Enrich search results with structured facts ("Albert Einstein was a physicist born in 1879").
- **Graph model**: RDF triples — `(subject, predicate, object)` e.g., `(Einstein, bornIn, Ulm)`.
- **Scale**: 500 billion facts, powering Google Search's knowledge panels, Assistant, and Bard.

### Airbnb — Listing Similarity and Trust Graph
- **Problem**: Surface similar listings; compute host/guest trust scores for safety.
- **Graph model**: Nodes = Users, Listings, Locations, Reviews. Edges = STAYED_AT, REVIEWED, SIMILAR_TO.
- **Pattern**: Traversal for similarity scoring; graph-based trust propagation for safety ranking.

---

## 11. Decision Framework

```
Is the primary query pattern relationship traversal?
├── YES → Consider a graph database
│   ├── How deep are the traversals?
│   │   ├── 1-2 hops → Relational DB with good indexing may suffice
│   │   └── 3+ hops or variable depth → Graph DB strongly preferred
│   ├── Do you need full ACID transactions?
│   │   ├── YES → Neo4j, Amazon Neptune
│   │   └── NO → JanusGraph, TigerGraph (better horizontal scale)
│   ├── Is the graph too large for a single machine?
│   │   ├── YES → JanusGraph (Cassandra backend), TigerGraph, Amazon Neptune
│   │   └── NO → Neo4j, Dgraph
│   └── Are you on a cloud provider?
│       ├── AWS → Amazon Neptune
│       ├── Azure → Cosmos DB Gremlin API
│       └── Managed / cloud-agnostic → Neo4j AuraDB
└── NO → Use Relational, Document, or Column-Family DB
```

---

## 12. Anti-Patterns

| Anti-Pattern                       | Problem                                                     | Fix                                               |
|------------------------------------|-------------------------------------------------------------|---------------------------------------------------|
| **Super-node (God node)**          | One node with millions of edges chokes traversal            | Introduce intermediate category nodes; paginate traversal |
| **Putting everything in the graph** | Using graph DB for simple lookups and aggregations         | Use polyglot: SQL for aggregations, graph for traversals |
| **Ignoring direction on edges**    | Undirected edges make query patterns ambiguous              | Always assign meaningful direction to relationships |
| **Over-using generic edge types**  | Single `RELATES_TO` edge type for everything                | Use specific, descriptive edge types (`PURCHASED`, `FOLLOWS`) |
| **No node indexes**                | Traversal entry points require full graph scan              | Index properties used for initial lookup (`name`, `email`) |
| **Modeling time as edge properties only** | Hard to query historical state of the graph         | Use time-versioned nodes or bitemporal graph patterns |

---

## 13. Monitoring and Operational Metrics

| Metric                          | What to Watch For                                        |
|---------------------------------|----------------------------------------------------------|
| **Query execution time**        | Traversal queries with long paths or missing indexes     |
| **Cache hit rate**              | Low hit rate means graph not fitting in memory           |
| **Super-node degree**           | Nodes with degree > 100k; flag for special handling      |
| **Transaction throughput (TPS)**| Write-heavy workloads saturating the primary             |
| **Replication lag**             | Stale reads on read replicas during heavy write batches  |
| **Heap memory utilization**     | Graph DBs are memory-intensive; OOM kills are a risk     |
| **Cross-shard edge ratio**      | For distributed graphs; high ratio = poor partition key  |

---

## Summary

Graph databases excel when **relationships are the query**, not just the join condition. They trade general-purpose analytical capabilities for dramatically better performance on multi-hop traversals, pattern matching, and network-style computations. The core design insight is **index-free adjacency** — each node holds a direct pointer to its neighbors, making traversal cost proportional to the subgraph touched, not the total database size. Use them for social graphs, fraud detection, recommendation engines, knowledge graphs, and routing — and pair them with a relational or document store for the non-relational parts of your data model.