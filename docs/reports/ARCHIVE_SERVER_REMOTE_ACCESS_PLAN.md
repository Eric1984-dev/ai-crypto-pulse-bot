# Archive Server Remote Access Plan

**Status:** Planning only — no tunnel, DNS, NGINX, Vercel, or Raspberry Pi configuration was changed.  
**Research checked:** 2026-11-07

## Recommendation

Use **Cloudflare Tunnel + Cloudflare Access Service Auth + the existing Pi bearer-token check**, with NGINX as a loopback-only reverse proxy. This is the preferred production setup because Cloudflare Tunnel is generally available on all plans, requires no inbound port forwarding, supports a stable custom hostname, and can add machine-to-machine Access authentication before the request reaches the Pi. Keep the existing `ARCHIVE_HEALTH_TOKEN` check as a second independent application-level control.

This recommendation assumes that a suitable domain can be managed in Cloudflare and that the account is eligible for the Free offerings. Neither has been confirmed. Cloudflare Access Service Auth also requires a future change to the Vercel proxy: the current proxy sends only the application bearer token, not Cloudflare's separate service-token headers. No such code change is included in this plan.

**Tailscale Funnel** is the simpler domain-free alternative for a personal, non-commercial proof of concept. It is not the first choice for the production recommendation because Tailscale currently labels Funnel beta and documents non-configurable bandwidth limits. The health endpoint's small five-minute polling traffic is likely modest, but account eligibility and beta risk still need to be accepted.

## Proposed request path

```text
Dashboard browser
    │ same-origin authenticated request
    ▼
Vercel /api/dashboard-data?view=archive-health
    │ HTTPS + Cloudflare Access service-token headers
    │ Authorization: Bearer <ARCHIVE_HEALTH_TOKEN>
    ▼
Cloudflare public hostname and Access Service Auth policy
    │ outbound-initiated encrypted Tunnel
    ▼
cloudflared on Raspberry Pi
    ▼
NGINX on 127.0.0.1:8080
    │ exact GET /api/health route only
    ▼
Archive health service on 127.0.0.1:3001
    │ read-only query over certificate-verified PostgreSQL TLS
    ▼
Archive PostgreSQL
```

The existing service already binds to loopback by default, accepts only `GET /api/health`, validates `ARCHIVE_HEALTH_TOKEN`, and performs its PostgreSQL connection with certificate verification enabled. See [`archive-server/src/server.mjs`](../../archive-server/src/server.mjs), [`archive-server/src/config.mjs`](../../archive-server/src/config.mjs), and the [connectivity report](./ARCHIVE_SERVER_CONNECTIVITY.md). The current Vercel route reuses `/api/dashboard-data`; do not add another `/api` file.

## Raspberry Pi and NGINX design

1. Run the Node health service as a dedicated, unprivileged Linux service account. Keep database credentials and `ARCHIVE_HEALTH_TOKEN` in a root-owned environment file outside the repository, readable only by the service account. Configure service restart-on-failure and start the service after networking is available.
2. Leave the health app bound to `127.0.0.1:3001`. Configure NGINX to listen only on `127.0.0.1:8080`.
3. Configure one exact `location = /api/health`. Allow only `GET`; proxy to `http://127.0.0.1:3001`; preserve the application's `Authorization` header; set short upstream connect/read timeouts; and return `404` for all other paths. Do not log Authorization or Cloudflare Access credential headers.
4. Apply a conservative rate limit and small request/response size bounds at NGINX. Because the tunnel-to-NGINX connection is local, NGINX may see all external requests as the same local source; tune limits to permit normal concurrent dashboard polling and do not treat NGINX IP limits as caller authentication.
5. Do not expose ports 3001, 8080, or PostgreSQL to the public Internet. Do not configure router port forwarding. If PostgreSQL runs on the same Pi, prefer loopback for its connection and bind PostgreSQL to loopback; otherwise restrict its firewall to the health service host and trusted archive clients.
6. Keep PostgreSQL TLS verification enabled. The certificate must validate against the Pi's trust store or the configured CA, and the certificate name must match the configured host or `ARCHIVE_DB_SSL_SERVERNAME`.

NGINX is an optional additional local boundary, not the public TLS endpoint. Cloudflare Tunnel or Tailscale Funnel provides the public HTTPS front door; the private loopback hop to NGINX and Node does not need a second public listener. NGINX's standard reverse-proxy mechanism supports a local upstream and explicit forwarded headers ([NGINX documentation](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/)).

## Provider comparison

| Area | Cloudflare Tunnel | Tailscale Funnel |
|---|---|---|
| Exposure model | `cloudflared` initiates outbound connections; no inbound origin port or public origin IP is needed. A published hostname is Internet-accessible unless an Access policy protects it. | Funnel publishes a local service to anyone on the Internet. Its public relay hides the Pi's IP and carries an encrypted proxy to the Pi. Funnel itself does not authenticate HTTP callers. |
| Caller authentication | Optional Cloudflare Access Service Auth uses `CF-Access-Client-Id` and `CF-Access-Client-Secret`; keep the app's separate bearer token as defense in depth. Requires an Access application and a Service Auth policy. | No Cloudflare-style caller policy at the public Funnel URL. Keep the app bearer token mandatory; tailnet policy controls who may enable Funnel, not who may call the public endpoint. |
| TLS and trust boundary | Public HTTPS is served through Cloudflare; traffic then travels over the encrypted Tunnel to the Pi. Cloudflare is part of the application trust boundary. | Tailscale provisions HTTPS for the tailnet hostname. Its docs describe the relay as unable to decrypt the encrypted proxy; TLS terminates on the Pi's Tailscale node before local proxying. |
| Hostname | Stable custom hostname requires an active domain/zone in Cloudflare. | Uses the tailnet's `*.ts.net` DNS name; Funnel cannot use an arbitrary custom domain directly. |
| Limits | Firewall must permit outbound port `7844` over TCP (`http2`) or UDP (`quic`). No inbound port is required. Cloudflare Tunnel docs describe four persistent connections to two Cloudflare data centers per tunnel; the Pi and ISP remain single points of failure. | Funnel is currently beta; only public ports 443, 8443, and 10000; only `*.ts.net`; requires Tailscale 1.38.3+, MagicDNS, HTTPS certificates, and a `funnel` node attribute. Bandwidth limits are non-configurable and no numerical allowance is published in the cited docs. |
| Setup complexity | Moderate: domain/zone, tunnel, DNS/public-hostname route, `cloudflared` service, Access app/policy/service token, NGINX, and Vercel header integration. | Low to moderate: tailnet, Pi enrollment, MagicDNS/HTTPS, policy permission, Funnel command, NGINX, and app bearer token. No purchased domain required. |
| Maintenance | Patch `cloudflared`, NGINX, Node, and Pi OS; monitor tunnel status; renew/rotate Cloudflare service tokens before their configured expiry; maintain domain registration and Cloudflare account access. | Patch Tailscale, NGINX, Node, and Pi OS; monitor Funnel and tailnet policy; maintain account/device authorization and HTTPS/DNS status. Automatic certificate management reduces certificate work. |
| Published price | Tunnel is available on all Cloudflare plans. Cloudflare lists Access Free at $0 for teams under 50 users; its published paid Access tier starts at $7/user/month billed annually. Domain registration/renewal is separate and variable. Confirm the account's plan eligibility and service-token billing treatment. | Funnel is available on all plans. Personal is $0 for up to six users and unlimited user devices, but Tailscale says it is only suitable for non-commercial use. Standard is currently $8/user/month. No custom domain purchase is needed. |
| Fit for this health endpoint | Strong production fit if a Cloudflare-managed domain and Access integration are acceptable. | Attractive low-cost personal POC, but beta and non-configurable bandwidth limits are disadvantages for a production dependency. |

These are provider-published terms checked on 2026-11-07; plan limits and prices may change. The Cloudflare Free plan is described for personal/hobby projects that are not business-critical. The health card is non-critical to trading, but account eligibility and intended use still require owner confirmation. Tailscale Personal's non-commercial condition also requires owner confirmation; do not infer eligibility merely from Vercel Hobby.

## Cloudflare production setup sequence

This is the preferred sequence if the account/domain prerequisites are accepted:

1. **Confirm domain and plan:** Confirm an active domain/zone can be managed in Cloudflare. If not, compare the cost and ownership of registering one; do not use a temporary `trycloudflare.com` Quick Tunnel as the production URL.
2. **Harden the Pi:** Install supported Node.js, NGINX, and `cloudflared`; run the health app and `cloudflared` as restricted services. Store the `cloudflared` tunnel credential and health/database environment values outside the repository with restrictive file permissions.
3. **Configure NGINX:** Bind to loopback only; proxy only the exact health path to the Node service; preserve the application bearer header; return 404 elsewhere; redact auth headers from logs.
4. **Create a Cloudflare Tunnel:** Create a remotely managed tunnel and publish one hostname, such as `archive-health.<owned-domain>`, to `http://127.0.0.1:8080`. Use a catch-all 404 ingress rule. Allow outbound TCP/UDP 7844 as required by the selected tunnel transport; block inbound Internet traffic.
5. **Add Cloudflare Access:** Protect only the health hostname/path with an Access application and a **Service Auth** policy accepting a dedicated service token. Set an expiry and rotation reminder. Do not use the same secret as `ARCHIVE_HEALTH_TOKEN`.
6. **Plan the Vercel integration:** In a later approved implementation, add server-side environment variables for the Cloudflare Access client ID and secret, and have the existing dashboard proxy send those two headers as well as `Authorization: Bearer <ARCHIVE_HEALTH_TOKEN>`. Keep all three out of client code and logs. Until this change is deployed, an Access-protected hostname will reject the existing Vercel request.
7. **Set the archive URL:** Set `ARCHIVE_SERVER_URL` to the Cloudflare hostname base URL and keep `ARCHIVE_HEALTH_TOKEN` identical on Vercel and the Pi. Do not put PostgreSQL connection variables in Vercel.
8. **Validate in stages:** From the Pi, test service status, NGINX allow/deny paths, valid and invalid bearer tokens, PostgreSQL TLS verification, and response fields. From outside the LAN, verify the Cloudflare Access service token and application bearer token are both required, only `/api/health` works, and the response does not reveal host, username, password, SQL error, or tunnel configuration. Then verify the authenticated Dashboard card and failure/offline behavior.

Cloudflare Tunnel setup docs state that publishing a public application requires adding a website/domain to Cloudflare and that anyone can access the published hostname unless an Access application/policy restricts it. Tunnel's outbound model does not require opening inbound ports. Access service tokens require the two documented headers and a Service Auth policy.

## Tailscale Funnel alternative

For a proof of concept where the account owner confirms non-commercial Personal-plan eligibility:

1. Enroll the Pi in the owner's tailnet and enable MagicDNS and HTTPS certificates.
2. Add/confirm the `funnel` node attribute in the tailnet policy. Restrict who is allowed to configure Funnel.
3. Publish the NGINX loopback listener (8080) through Funnel's HTTPS front door; use the assigned `*.ts.net` hostname in `ARCHIVE_SERVER_URL`.
4. Keep the application `ARCHIVE_HEALTH_TOKEN` required. Funnel makes the chosen local service public; tailnet membership does not restrict HTTP clients from the Internet.
5. Test the public route from outside the tailnet, the valid/invalid bearer behavior, and the Dashboard offline case. Track the beta status and bandwidth terms before relying on it.

Funnel's public HTTPS certificate and DNS are managed by Tailscale, but the public endpoint remains an Internet service. Do not publish PostgreSQL, SSH, NGINX administration, or any path other than the health endpoint.

## Operational risks and rollback

- **Pi/power/ISP outage:** Both options depend on the single Pi and its Internet connection. The card goes Offline; trading and AI analysis remain independent. Do not treat tunnel redundancy as Pi high availability.
- **Credential theft/replay:** Keep Cloudflare service-token credentials and the app bearer token separate, restrict and rotate both, never log them, and revoke them immediately if exposed.
- **Public abuse:** The service is a minimal, read-only endpoint, but an Internet-reachable hostname can still be probed or flooded. Keep Access enabled for the Cloudflare recommendation, retain app authentication, apply conservative rate limits, and alert on tunnel/service failures.
- **Certificate/configuration errors:** Strict database TLS can leave the database status Offline until the trust chain and hostname are correct. Do not disable certificate verification to make the monitor green.
- **Provider changes:** Funnel is beta with non-configurable bandwidth limits; Cloudflare/Tailscale plans and Access eligibility can change. Recheck official terms at deployment time.

Rollback is non-destructive: disable the public hostname/Funnel route, stop the tunnel service, revoke its service token if applicable, and remove or unset the Vercel archive URL/token configuration. The dashboard should then show Offline; no trading, database, or portfolio state is changed.

## Decisions required before implementation

- Is a Cloudflare-managed domain already available, or should the plan use the owner's Tailscale `*.ts.net` name?
- Is the use personal/non-commercial, and which provider account/plan is eligible?
- Is Cloudflare Access Service Auth approved, including the additional Vercel header and secret integration?
- Is PostgreSQL on the Pi itself, and is verified TLS already configured with a trusted certificate?
- Who will own Pi OS, NGINX, tunnel, certificate, and token-expiry maintenance?

## Official sources

Cloudflare documentation and pricing:

- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) — all-plan availability, outbound-only model, published hostnames, persistent connections.
- [Create a remote-managed Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/) — domain prerequisite, public route, and public-by-default behavior.
- [Tunnel firewall requirements](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/) — outbound TCP/UDP port 7844.
- [Publish a self-hosted application with Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) — Access application and deny-by-default policy.
- [Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) — token lifecycle, Service Auth policy, and request headers.
- [Cloudflare Access pricing](https://www.cloudflare.com/sase/products/access/) and [Cloudflare plans](https://www.cloudflare.com/plans/) — published free and paid plan terms.
- [NGINX reverse proxy documentation](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/).

Tailscale documentation and pricing:

- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) — beta status, public exposure model, encryption, domain/port/bandwidth limits, prerequisites, and policy.
- [Tailscale pricing](https://tailscale.com/pricing) — Personal and Standard pricing and Personal-plan use restrictions.
