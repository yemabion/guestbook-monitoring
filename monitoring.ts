import * as fs from "fs";
import * as path from "path";
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const cfg = new pulumi.Config();
const adminPassword = cfg.requireSecret("grafanaAdminPassword");
const grafanaHost = cfg.get("grafanaHost") ?? "localhost";
const grafanaPort = cfg.getNumber("grafanaPort") ?? 3000;

const ns = new k8s.core.v1.Namespace("monitoring", {
    metadata: { name: "monitoring" },
});

// Prometheus + Grafana via the kube-prometheus-stack Helm chart (version pinned).
// Trimmed for a small local cluster: no Alertmanager, no node-exporter, no control-plane targets.
export const kps = new k8s.helm.v3.Release("kube-prometheus-stack", {
    name: "kube-prometheus-stack",
    chart: "kube-prometheus-stack",
    version: "92.14.1",
    namespace: ns.metadata.name,
    repositoryOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
    timeout: 1800,
    values: {
        alertmanager: { enabled: false },
        nodeExporter: { enabled: false },
        kubeEtcd: { enabled: false },
        kubeScheduler: { enabled: false },
        kubeControllerManager: { enabled: false },
        kubeProxy: { enabled: false },
        defaultRules: { create: false },
        prometheusOperator: { admissionWebhooks: { enabled: false }, tls: { enabled: false } },
        prometheus: {
            // NodePort 30090 is mapped to localhost:9090 by kind-config.yaml
            service: { type: "NodePort", nodePort: 30090 },
            prometheusSpec: {
                // pick up our ServiceMonitors even without the Helm release label
                serviceMonitorSelectorNilUsesHelmValues: false,
                podMonitorSelectorNilUsesHelmValues: false,
                retention: "12h",
                resources: { requests: { cpu: "100m", memory: "400Mi" } },
            },
        },
        grafana: {
            adminUser: "admin",
            adminPassword: adminPassword,
            defaultDashboardsEnabled: false,
            // NodePort 30300 is mapped to localhost:3000 by kind-config.yaml
            service: { type: "NodePort", nodePort: 30300 },
            sidecar: { dashboards: { enabled: true, label: "grafana_dashboard" } },
        },
    },
});

export const grafanaUrl = `http://${grafanaHost}:${grafanaPort}`;
export const grafanaAdminUser = "admin";
export const grafanaAdminPassword = adminPassword;   // stays a Pulumi secret
export const prometheusUrl = "http://localhost:9090";

// Tell Prometheus to scrape the Redis exporters (Service chosen by label, port chosen by name)
const redisMonitor = (name: string) =>
    new k8s.apiextensions.CustomResource(`${name}-sm`, {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "ServiceMonitor",
        metadata: { name, namespace: "monitoring" },
        spec: {
            selector: { matchLabels: { app: name } },
            namespaceSelector: { matchNames: ["default"] },
            endpoints: [{ port: "metrics", interval: "15s" }],
        },
    }, { dependsOn: [kps] });
redisMonitor("redis-leader");
redisMonitor("redis-replica");

// Basic Grafana dashboard, loaded automatically by the Grafana sidecar (label grafana_dashboard)
new k8s.core.v1.ConfigMap("guestbook-dashboard", {
    metadata: { name: "guestbook-dashboard", namespace: "monitoring", labels: { grafana_dashboard: "1" } },
    data: { "guestbook.json": fs.readFileSync(path.join(__dirname, "dashboards", "guestbook-dashboard.json"), "utf8") },
}, { dependsOn: [kps] });
