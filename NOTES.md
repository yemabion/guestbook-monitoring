# Build notes
## Incident 1: entries vanished after refresh
- Symptom: guestbook entries disappeared on refresh
- Diagnosis: replica `info replication` showed link down; logs: "Can't handle RDB format version 15"
- Cause: leader used unpinned `redis` (new), replica used an old custom image
- Fix: pinned both to redis:7.2, replica started with --replicaof redis-leader 6379
## Incident 2: Pulumi Cloud 504 (CloudFront) on `pulumi up`; transient, retry succeeded
## Observation 3: monitoring pods restarting
- Events: liveness/readiness probe failures (context deadline exceeded) for operator, kube-state-metrics, Prometheus, Grafana
- Operator last exit 0 (SIGTERM after failed probe), kube-state-metrics exit 2; no OOMKilled
- Likely cause: CPU starvation on the 2-CPU laptop (not measured); data kept flowing, small gaps in graphs
