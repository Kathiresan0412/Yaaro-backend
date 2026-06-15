# Requirements Document

## Introduction

This document defines the requirements for scaling the Yaaro backend from a single-server architecture to a distributed system capable of serving 2 million users. The current stack (Express.js, Prisma, PostgreSQL, Socket.IO, Redis) will be extended with read replicas, infrastructure-level connection pooling, horizontal scaling, distributed real-time messaging, background job processing, CDN-based media delivery, dedicated search infrastructure, and traffic management.

## Glossary

- **API_Gateway**: The load balancer and reverse proxy layer (e.g., NGINX or AWS ALB) that distributes incoming HTTP and WebSocket traffic across multiple Application_Server instances.
- **Application_Server**: A stateless Express.js process that handles HTTP requests and WebSocket connections. Multiple instances run behind the API_Gateway.
- **Primary_Database**: The PostgreSQL writer instance that handles all INSERT, UPDATE, and DELETE operations.
- **Read_Replica**: A PostgreSQL read-only follower that receives replicated data from Primary_Database and serves read queries.
- **Connection_Pooler**: An infrastructure-level connection pooling service (PgBouncer) placed between Application_Server instances and the PostgreSQL cluster that multiplexes thousands of application connections into a smaller set of database connections.
- **Cache_Layer**: The Redis cluster used for caching hot data (profiles, discovery results, session data) with cache-aside patterns.
- **Job_Queue**: A Redis-backed background job processing system (BullMQ) that offloads expensive computations and asynchronous tasks from the request-response cycle.
- **Socket_Adapter**: The Redis-based adapter (@socket.io/redis-adapter) that enables Socket.IO events to be broadcast across multiple Application_Server instances.
- **CDN**: A content delivery network (e.g., Cloudinary or CloudFront) used to serve user photos and media assets from edge locations globally.
- **Search_Index**: A dedicated search engine (Elasticsearch or equivalent) optimized for geospatial queries and candidate filtering in the discovery flow.
- **Rate_Limiter**: A distributed rate limiting service backed by Redis that enforces per-user and per-endpoint request quotas across all Application_Server instances.
- **Health_Check_Service**: A lightweight endpoint and monitoring system that reports the status of each Application_Server instance to the API_Gateway.

## Requirements

### Requirement 1: Database Read/Write Splitting

**User Story:** As the platform operator, I want database reads distributed across read replicas, so that the Primary_Database is not overwhelmed by the read-heavy discovery and profile-loading workloads at 2M-user scale.

#### Acceptance Criteria

1. WHEN a read-only query is issued by the Application_Server, THE Connection_Pooler SHALL route the query to an available Read_Replica using round-robin distribution across all healthy replicas.
2. WHEN a write query is issued by the Application_Server, THE Connection_Pooler SHALL route the query to the Primary_Database.
3. THE system SHALL support a minimum of 2 and a maximum of 5 Read_Replicas for horizontal read scaling.
4. IF a Read_Replica fails to respond to a health check within 3 consecutive attempts at 1-second intervals, THEN THE Connection_Pooler SHALL mark the replica as unavailable and route queries to the remaining healthy Read_Replicas within 5 seconds.
5. WHILE replication lag exceeds 1 second as measured by polling replica state every 500 milliseconds, THE Application_Server SHALL route time-sensitive reads (auth verification, swipe deduplication) to the Primary_Database.
6. IF all Read_Replicas become unavailable, THEN THE Connection_Pooler SHALL route read queries to the Primary_Database until at least one Read_Replica recovers.

### Requirement 2: Infrastructure Connection Pooling

**User Story:** As the platform operator, I want connection pooling managed at the infrastructure level, so that hundreds of Application_Server processes share a bounded set of database connections without exhausting PostgreSQL limits.

#### Acceptance Criteria

1. THE Connection_Pooler SHALL multiplex application connections using transaction-level pooling mode.
2. THE Connection_Pooler SHALL support at least 10,000 concurrent client connections from Application_Server instances.
3. THE Connection_Pooler SHALL maintain a maximum of 100 server connections per PostgreSQL instance.
4. WHEN an application connection has been idle for 30 seconds, THE Connection_Pooler SHALL release the underlying server connection back to the pool.
5. IF all server connections are in use, THEN THE Connection_Pooler SHALL queue incoming requests up to a maximum queue depth of 5,000 and serve them within 2 seconds or return a connection timeout error.
6. IF the Connection_Pooler instance becomes unavailable, THEN THE Application_Server SHALL return an error indicating database unavailability rather than attempting direct database connections.
7. THE Connection_Pooler SHALL validate server connections by discarding connections that have been idle for more than 300 seconds and replacing them with fresh connections on the next client request.

### Requirement 3: Horizontal Application Scaling

**User Story:** As the platform operator, I want multiple stateless Application_Server instances running behind a load balancer, so that the system can handle concurrent requests from 2 million users by scaling horizontally.

#### Acceptance Criteria

1. THE Application_Server SHALL operate statelessly, storing no user session or request-scoped data in process memory beyond the current request lifecycle.
2. THE API_Gateway SHALL distribute HTTP requests across Application_Server instances using least-connections load balancing.
3. THE API_Gateway SHALL route WebSocket connections using sticky sessions based on the Socket.IO session identifier.
4. WHEN a new Application_Server instance is added, THE API_Gateway SHALL include the instance in its rotation within 30 seconds after the Health_Check_Service reports the instance as healthy.
5. IF an Application_Server instance fails its health check 3 consecutive times at 10-second intervals, THEN THE API_Gateway SHALL remove the instance from the rotation and drain in-flight requests for up to 10 seconds before fully disconnecting the instance.
6. THE system SHALL support a minimum of 4 and a maximum of 20 Application_Server instances concurrently, with each instance handling at least 5,000 concurrent connections.
7. WHEN an Application_Server instance is removed from rotation, THE API_Gateway SHALL allow in-flight HTTP requests on that instance up to 10 seconds to complete and SHALL close WebSocket connections with a reconnect-eligible close code so that clients reconnect to a healthy instance.

### Requirement 4: Distributed Real-Time Messaging

**User Story:** As a user, I want my real-time messages, typing indicators, and presence updates delivered reliably regardless of which Application_Server instance I am connected to, so that multi-server deployment does not degrade the messaging experience.

#### Acceptance Criteria

1. THE Socket_Adapter SHALL propagate all Socket.IO events (messages, typing indicators, presence updates, reactions) across all Application_Server instances via Redis Pub/Sub.
2. WHEN a message is sent from a user connected to one Application_Server instance, THE Socket_Adapter SHALL deliver the message to the recipient within 200ms regardless of which instance the recipient is connected to.
3. THE Application_Server SHALL store online presence state in the Cache_Layer instead of in-process memory, with a TTL of 60 seconds that is refreshed on each heartbeat from the connected client.
4. THE Application_Server SHALL store active match room membership in the Cache_Layer instead of in-process memory.
5. IF the Redis Pub/Sub connection is lost, THEN THE Socket_Adapter SHALL attempt reconnection with exponential backoff starting at 500ms, capped at a maximum interval of 30 seconds, for up to 10 attempts before marking the instance as unhealthy.
6. IF the Redis Pub/Sub connection is lost, THEN THE Socket_Adapter SHALL buffer outgoing events in memory up to a maximum of 1000 events and flush them upon successful reconnection, discarding events that exceed the buffer limit.
7. IF an Application_Server instance disconnects without cleaning up presence state, THEN THE Cache_Layer SHALL automatically expire the stale presence entry after the 60-second TTL elapses, causing the user to appear offline.

### Requirement 5: Redis Caching Strategy

**User Story:** As the platform operator, I want a comprehensive caching strategy for hot data, so that the database is protected from repetitive queries generated by 2 million active users.

#### Acceptance Criteria

1. THE Cache_Layer SHALL cache user profile data with a TTL of 5 minutes.
2. THE Cache_Layer SHALL cache discovery candidate lists with a TTL of 60 seconds.
3. THE Cache_Layer SHALL cache user authentication lookups with a TTL of 60 seconds, replacing the current in-memory auth cache.
4. WHEN a user updates their profile, THE Application_Server SHALL invalidate the corresponding profile cache entry and any discovery candidate list entries that include that user in the Cache_Layer within 1 second.
5. THE Cache_Layer SHALL use a Redis Cluster configuration with a minimum of 3 nodes for high availability.
6. IF the Cache_Layer fails to respond within 200ms or all cluster nodes are unreachable, THEN THE Application_Server SHALL serve requests directly from the database without returning errors to the client.
7. WHEN a cache miss occurs for a read request, THE Application_Server SHALL fetch the data from the database, return it to the client, and populate the Cache_Layer with the fetched data using the applicable TTL.

### Requirement 6: Background Job Processing

**User Story:** As the platform operator, I want expensive computations (compatibility scoring, notification delivery, email sending, boost tracking) processed asynchronously, so that API response times remain low under peak load.

#### Acceptance Criteria

1. THE Job_Queue SHALL process compatibility score calculations outside the HTTP request-response cycle.
2. THE Job_Queue SHALL process push notification delivery asynchronously.
3. THE Job_Queue SHALL process email sending (match notifications, unread message reminders) asynchronously.
4. WHEN a job fails, THE Job_Queue SHALL retry the job with exponential backoff starting at 1 second, up to 3 times before marking the job as permanently failed.
5. THE Job_Queue SHALL support priority queues with the following priority order from highest to lowest: push notifications, match notifications, compatibility score calculations, email delivery, boost tracking.
6. THE Job_Queue SHALL provide visibility into job status, queue depth, and failure rates via a monitoring dashboard, with metrics updated at most every 30 seconds.
7. IF a job has not completed within 60 seconds, THEN THE Job_Queue SHALL mark the job as stalled, terminate its execution, and re-queue it as a new attempt subject to the retry limit.
8. IF a job exhausts all retry attempts, THEN THE Job_Queue SHALL move the job to a dead-letter queue and emit a failure event observable by the monitoring system.
9. THE Job_Queue SHALL process no more than 20 concurrent jobs per worker instance to prevent resource exhaustion.

### Requirement 7: CDN Media Delivery

**User Story:** As a user, I want profile photos to load quickly regardless of my geographic location, so that the discovery and messaging experience feels responsive.

#### Acceptance Criteria

1. THE CDN SHALL serve all user-uploaded photos from edge locations closest to the requesting client.
2. WHEN a photo is uploaded, THE Application_Server SHALL generate optimized variants (thumbnail 150px, card 600px, full 1200px) and store them on the CDN within 10 seconds of upload completion.
3. THE CDN SHALL cache photo assets with a TTL of 24 hours at edge locations.
4. WHEN a user deletes a photo, THE Application_Server SHALL invalidate the CDN cache for that asset within 5 minutes.
5. THE Application_Server SHALL return CDN URLs in all API responses that include photo references.
6. IF a photo upload exceeds 10 MB in file size or is not in JPEG, PNG, or WebP format, THEN THE Application_Server SHALL reject the upload with an error message indicating the size limit or accepted formats.
7. IF variant generation fails for an uploaded photo, THEN THE Application_Server SHALL retry processing up to 3 times via the Job_Queue before marking the upload as failed and notifying the user.
8. WHEN the CDN returns an error or is unreachable during photo upload storage, THE Application_Server SHALL queue the CDN storage operation for retry via the Job_Queue and serve the photo from origin storage until CDN availability is restored.

### Requirement 8: Discovery Search Optimization

**User Story:** As a user, I want discovery results to load within 1 second even with 2 million users in the system, so that browsing potential matches feels instant.

#### Acceptance Criteria

1. THE Search_Index SHALL index user profiles with geospatial coordinates for distance-based filtering.
2. THE Search_Index SHALL support filtering by age (range 18–100), gender, distance (up to 500 km), and verification status without full table scans.
3. WHEN a user requests discovery candidates, THE Application_Server SHALL query the Search_Index and return up to 200 candidate IDs as the initial candidate set.
4. THE Search_Index SHALL return up to 200 candidate IDs within 100ms for a filtered geospatial query against a dataset of 2 million indexed profiles.
5. WHEN a user updates their profile or location, THE Application_Server SHALL update the Search_Index within 30 seconds.
6. THE Search_Index SHALL support at least 1,000 concurrent queries per second.
7. WHEN a user requests discovery candidates, THE Application_Server SHALL return the complete discovery response within 1 second, including Search_Index query time and post-processing.
8. IF the Search_Index is unavailable, THEN THE Application_Server SHALL fall back to a cached candidate list from the Cache_Layer, or return an empty discovery result set with an error indication if no cached list exists.
9. WHEN a new user profile is created, THE Application_Server SHALL add the profile to the Search_Index within 30 seconds.

### Requirement 9: Distributed Rate Limiting

**User Story:** As the platform operator, I want per-user and per-endpoint rate limits enforced consistently across all Application_Server instances, so that no single user or bot can overwhelm the system.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL enforce per-user request limits using a sliding window algorithm stored in Redis.
2. THE Rate_Limiter SHALL limit the discovery endpoint to 30 requests per minute per user.
3. THE Rate_Limiter SHALL limit the swipe endpoint to 60 requests per minute per user.
4. THE Rate_Limiter SHALL limit authentication endpoints to 10 requests per minute per IP address.
5. WHEN a rate limit is exceeded, THE Application_Server SHALL respond with HTTP 429 and include a Retry-After header whose value is the number of seconds remaining until the current sliding window resets for that user/IP and endpoint.
6. THE Rate_Limiter SHALL share state across all Application_Server instances via the Cache_Layer.
7. THE Rate_Limiter SHALL enforce a default rate limit of 120 requests per minute per user for any endpoint not covered by a specific rate limit rule.
8. IF the Cache_Layer is unavailable, THEN THE Rate_Limiter SHALL fail open and allow requests through without rate limit enforcement, while the Application_Server logs the Cache_Layer unavailability to the monitoring system.

### Requirement 10: Health Monitoring and Auto-Recovery

**User Story:** As the platform operator, I want automated health monitoring and recovery, so that failed instances are detected and replaced without manual intervention.

#### Acceptance Criteria

1. THE Health_Check_Service SHALL expose a /health endpoint on each Application_Server that reports database connectivity, Redis connectivity, and memory usage, where the endpoint returns an unhealthy status if any of the following conditions are true: database connection fails or query latency exceeds 2 seconds, Redis connection fails or ping latency exceeds 1 second, or memory usage exceeds 90% of the allocated limit.
2. THE Health_Check_Service SHALL respond to health check requests within 500ms.
3. THE API_Gateway SHALL poll the /health endpoint on each Application_Server instance at an interval of 5 seconds.
4. WHEN the /health endpoint reports an unhealthy status on 3 consecutive checks, THE API_Gateway SHALL stop routing new requests to that instance within 10 seconds and allow in-flight requests up to 30 seconds to complete.
5. THE system SHALL emit metrics (request latency p50/p95/p99, error rate, active connections, queue depth) to a time-series monitoring system at intervals no greater than 10 seconds.
6. IF an Application_Server instance fails to respond to health check requests or returns a non-200 status for 60 consecutive seconds, THEN THE orchestration layer SHALL terminate and replace the instance automatically.

### Requirement 11: Stateless Session and Auth Migration

**User Story:** As the platform operator, I want authentication state shared across all instances via Redis, so that users can be routed to any Application_Server without session loss.

#### Acceptance Criteria

1. THE Application_Server SHALL store auth cache entries in the Cache_Layer instead of in-process memory.
2. WHEN a user is banned or deactivated, THE Application_Server SHALL evict the auth cache entry from the Cache_Layer within 1 second, affecting all instances.
3. THE Application_Server SHALL validate JWT tokens without requiring instance-local state beyond the signing secret.
4. IF a JWT token is expired or has an invalid signature, THEN THE Application_Server SHALL reject the request with an authentication error response without querying the Cache_Layer or database.
5. THE Cache_Layer SHALL store auth entries with a TTL of 60 seconds, matching the current auth cache behavior.
6. WHEN an auth cache entry is not present in the Cache_Layer (cache miss or TTL expiry), THE Application_Server SHALL re-validate the user's auth state from the Primary_Database and repopulate the Cache_Layer entry.
7. IF the Cache_Layer is unavailable during auth validation, THEN THE Application_Server SHALL validate the request directly against the Primary_Database rather than rejecting the request.
