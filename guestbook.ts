import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// kind has no cloud LoadBalancer, so we set isMinikube=true (ClusterIP only).
const config = new pulumi.Config();
const isMinikube = config.getBoolean("isMinikube");

// Sidecar that translates Redis stats into Prometheus format (port 9121)
const redisExporter: k8s.types.input.core.v1.Container = {
    name: "redis-exporter",
    image: "oliver006/redis_exporter:v1.67.0",
    ports: [{ name: "metrics", containerPort: 9121 }],
    env: [{ name: "REDIS_ADDR", value: "redis://localhost:6379" }],
    resources: { requests: { cpu: "25m", memory: "32Mi" }, limits: { memory: "64Mi" } },
};

// Shared container settings: memory limits (no CPU limit, to avoid throttling) and generous probes,
// because slow machines make tight probes fail and restart healthy pods.
const redisRuntime: Partial<k8s.types.input.core.v1.Container> = {
    resources: { requests: { cpu: "100m", memory: "100Mi" }, limits: { memory: "256Mi" } },
    readinessProbe: { exec: { command: ["redis-cli", "ping"] }, initialDelaySeconds: 5, periodSeconds: 10, timeoutSeconds: 5 },
    livenessProbe: { exec: { command: ["redis-cli", "ping"] }, initialDelaySeconds: 15, periodSeconds: 20, timeoutSeconds: 5, failureThreshold: 6 },
};
const frontendRuntime: Partial<k8s.types.input.core.v1.Container> = {
    resources: { requests: { cpu: "100m", memory: "100Mi" }, limits: { memory: "256Mi" } },
    readinessProbe: { httpGet: { path: "/", port: 80 }, initialDelaySeconds: 5, periodSeconds: 10, timeoutSeconds: 5 },
    livenessProbe: { tcpSocket: { port: 80 }, initialDelaySeconds: 15, periodSeconds: 20, timeoutSeconds: 5, failureThreshold: 6 },
};

// ---------- Redis leader (writes) ----------
const redisLeaderLabels = { app: "redis-leader" };
const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
    metadata: { name: "redis-leader", labels: redisLeaderLabels },
    spec: {
        selector: { matchLabels: redisLeaderLabels },
        template: {
            metadata: { labels: redisLeaderLabels },
            spec: {
                containers: [{
                    name: "redis-leader",
                    image: "redis:7.2",
                    ...redisRuntime,
                    ports: [{ containerPort: 6379 }],
                }, redisExporter],
            },
        },
    },
});
const redisLeaderService = new k8s.core.v1.Service("redis-leader", {
    metadata: { name: "redis-leader", labels: redisLeaderLabels },
    spec: {
        ports: [
            { name: "redis", port: 6379, targetPort: 6379 },
            { name: "metrics", port: 9121, targetPort: 9121 },
        ],
        selector: redisLeaderLabels,
    },
});

// ---------- Redis replica (reads) ----------
const redisReplicaLabels = { app: "redis-replica" };
const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
    metadata: { name: "redis-replica", labels: redisReplicaLabels },
    spec: {
        selector: { matchLabels: redisReplicaLabels },
        template: {
            metadata: { labels: redisReplicaLabels },
            spec: {
                containers: [{
                    name: "replica",
                    image: "redis:7.2",
                    command: ["redis-server", "--replicaof", "redis-leader", "6379"],
                    ...redisRuntime,
                    ports: [{ containerPort: 6379 }],
                }, redisExporter],
            },
        },
    },
});
const redisReplicaService = new k8s.core.v1.Service("redis-replica", {
    metadata: { name: "redis-replica", labels: redisReplicaLabels },
    spec: {
        ports: [
            { name: "redis", port: 6379, targetPort: 6379 },
            { name: "metrics", port: 9121, targetPort: 9121 },
        ],
        selector: redisReplicaLabels,
    },
});

// ---------- Frontend (PHP) ----------
const frontendLabels = { app: "frontend" };
const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    metadata: { name: "frontend", labels: frontendLabels },
    spec: {
        selector: { matchLabels: frontendLabels },
        replicas: 3,
        template: {
            metadata: { labels: frontendLabels },
            spec: {
                containers: [{
                    name: "frontend",
                    image: "pulumi/guestbook-php-redis@sha256:f21cbff35c0bad29d0c480f741e19919fb135d7c7941b8b5fc7240503d0a1c4f",
                    ...frontendRuntime,
                    env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                    ports: [{ containerPort: 80 }],
                }],
            },
        },
    },
});
const frontendService = new k8s.core.v1.Service("frontend", {
    metadata: { name: "frontend", labels: frontendLabels },
    spec: {
        type: isMinikube ? "ClusterIP" : "LoadBalancer",
        ports: [{ port: 80 }],
        selector: frontendLabels,
    },
});

export const frontendIp = isMinikube
    ? frontendService.spec.clusterIP
    : frontendService.status.loadBalancer.ingress[0].ip;
