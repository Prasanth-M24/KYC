# AEGIS-KYC — Neo4j Cypher Queries Reference
# All queries used by the backend fraud detection engine

# ─── Schema Setup ─────────────────────────────────────────────────────────────

# Uniqueness constraints (run once)
CREATE CONSTRAINT IF NOT EXISTS FOR (u:User)   REQUIRE u.phone    IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (d:Device) REQUIRE d.deviceId IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS FOR (p:PAN)    REQUIRE p.number   IS UNIQUE;

# Indexes
CREATE INDEX IF NOT EXISTS FOR (u:User) ON (u.sessionId);
CREATE INDEX IF NOT EXISTS FOR (u:User) ON (u.name);


# ─── Insert / Upsert ──────────────────────────────────────────────────────────

# Upsert a user, device, and PAN – link them
MERGE (u:User {phone: $phone})
SET u.name = $name, u.sessionId = $sessionId
MERGE (d:Device {deviceId: $deviceId})
MERGE (p:PAN {number: $panNumber})
MERGE (u)-[:USES]->(d)
MERGE (u)-[:HAS]->(p);


# ─── Fraud Detection Queries ──────────────────────────────────────────────────

# Rule 1: Device linked to more than 3 users (SIM swap / device sharing fraud)
MATCH (d:Device {deviceId: $deviceId})<-[:USES]-(u:User)
RETURN count(u) AS userCount;

# Rule 2: PAN used by more than 1 user (identity theft)
MATCH (p:PAN {number: $panNumber})<-[:HAS]-(u:User)
RETURN collect(u.phone) AS users, count(u) AS userCount;

# Rule 3: Find all users sharing a device
MATCH (d:Device {deviceId: $deviceId})<-[:USES]-(u:User)
RETURN u.phone, u.name, u.sessionId;

# Rule 4: List top fraudulent devices (most shared)
MATCH (d:Device)<-[:USES]-(u:User)
WITH d, count(u) AS userCount
WHERE userCount > 3
RETURN d.deviceId, userCount
ORDER BY userCount DESC
LIMIT 20;

# Rule 5: Full fraud graph for a phone number
MATCH (u:User {phone: $phone})-[r]->(n)
RETURN u, r, n;


# ─── Analytics ────────────────────────────────────────────────────────────────

# Total nodes by type
MATCH (n) RETURN labels(n) AS type, count(n) AS count;

# Most connected users (by device links)
MATCH (u:User)-[:USES]->(d:Device)
WITH u, count(d) AS deviceCount
RETURN u.phone, u.name, deviceCount
ORDER BY deviceCount DESC
LIMIT 10;
