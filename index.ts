import { frontendIp } from "./guestbook";
import * as monitoring from "./monitoring";

export { frontendIp };
export const grafanaUrl = monitoring.grafanaUrl;
export const grafanaAdminUser = monitoring.grafanaAdminUser;
export const grafanaAdminPassword = monitoring.grafanaAdminPassword;
export const prometheusUrl = monitoring.prometheusUrl;
