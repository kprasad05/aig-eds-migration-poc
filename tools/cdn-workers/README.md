# Video Sitemap — CDN Worker Setup

This folder contains edge worker implementations for serving `/video-sitemap.xml`
dynamically at the CDN layer, without requiring a file to be committed to the repo.

## How it works

```
Googlebot / user
      │
      ▼
  CDN edge  ──  /video-sitemap.xml ──► worker fetches /video-index.json
      │                                  from AEM Live, builds XML, returns it
      │
  all other paths ────────────────────► AEM origin (normal EDS flow)
```

The worker reads `/video-index.json` produced by the `video-index` query defined
in `helix-query.yaml`. That index contains one row per page that has a
`video-feature` block, with the fields `videourl`, `videothumbnail`, `title`,
`description`, and `image`.

The XML output follows the
[Google video sitemap schema](https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps).

---

## robots.txt

`robots.txt` lives at the repo root and is committed directly — it is served by
EDS from the root of the site:

```
User-agent: *
Allow: /

Sitemap: https://www.aig.com/sitemap.xml
Sitemap: https://www.aig.com/video-sitemap.xml
```

Update the domain to the production hostname before go-live.

---

## Choosing an approach

| | CDN Worker | GitHub Action → Object Storage | GitHub Action → repo commit |
|---|---|---|---|
| Freshness | Real-time | Daily (scheduled) | Daily (scheduled) |
| CDN dependency | Required (BYO CDN) | Required (BYO CDN to proxy storage URL) | None |
| Adobe-managed CDN | ❌ | ❌ | ✅ Works |
| `video-sitemap.xml` in repo | ❌ Never | ❌ Never | ✅ Must be committed |
| Object storage needed | ❌ | ✅ S3 / Azure Blob / GCS | ❌ |
| Complexity | Medium | Low-medium | Low |

### Approach B — GitHub Action → Object Storage (keep file out of repo)

If you want the sitemap **out of the repo** but don't need a BYO CDN worker,
upload it to object storage from the GitHub Action and point your CDN at the
storage URL.

```
GitHub Action (daily)
  └─ generates video-sitemap.xml
  └─ uploads to S3 / Azure Blob / GCS
           │
           ▼
  BYO CDN proxies  /video-sitemap.xml  →  storage public URL
  https://www.aig.com/video-sitemap.xml  ✅  (file never in the repo)
```

The workflow (`.github/workflows/video-sitemap.yaml`) already contains
**commented-out steps** for all three storage providers. To activate:

1. Comment out the `Commit if changed` step.
2. Uncomment the relevant upload step (S3, Azure Blob, or GCS).
3. Add the required secrets to GitHub repo **Settings → Secrets and variables → Actions**.

#### Amazon S3

| Secret | Example value |
|---|---|
| `AWS_ACCESS_KEY_ID` | `AKIA…` |
| `AWS_SECRET_ACCESS_KEY` | `…` |
| `AWS_REGION` | `us-east-1` |
| `SITEMAP_S3_BUCKET` | `my-aig-sitemaps` |
| `SITEMAP_S3_KEY` | `video-sitemap.xml` |

Make the object publicly readable via a bucket policy:

```json
{
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::my-aig-sitemaps/video-sitemap.xml"
}
```

Then configure your BYO CDN to proxy `/video-sitemap.xml` to:
`https://my-aig-sitemaps.s3.amazonaws.com/video-sitemap.xml`

Or serve through **CloudFront** in front of the bucket for better performance.

#### Azure Blob Storage

| Secret | Example value |
|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | `DefaultEndpointsProtocol=https;…` |
| `AZURE_CONTAINER` | `sitemaps` |
| `SITEMAP_BLOB_NAME` | `video-sitemap.xml` |

Set the container access level to **Blob (anonymous read)** in the Azure portal,
then proxy `/video-sitemap.xml` to:
`https://<account>.blob.core.windows.net/sitemaps/video-sitemap.xml`

#### Google Cloud Storage

| Secret | Example value |
|---|---|
| `GCS_CREDENTIALS_JSON` | Service account key JSON |
| `GCS_BUCKET` | `my-aig-sitemaps` |
| `SITEMAP_GCS_KEY` | `video-sitemap.xml` |

Make the object public: `gsutil acl ch -u AllUsers:R gs://my-aig-sitemaps/video-sitemap.xml`

Then proxy `/video-sitemap.xml` to:
`https://storage.googleapis.com/my-aig-sitemaps/video-sitemap.xml`

---

### Why `video-sitemap.xml` must be in the repo (Approach A — Adobe-managed CDN)

AEM Edge Delivery Services has **no runtime** — it serves only files committed to the
GitHub repository. There is no server-side rendering, no lambda, and no hook for
custom logic on the Adobe-managed CDN layer.

The GitHub Action generates `video-sitemap.xml` and commits it to `main`. EDS then
serves that committed file at `/video-sitemap.xml`. **You cannot remove the file from
the repo and keep it served by EDS.**

```
GitHub Action (daily)
  └─ generates video-sitemap.xml
  └─ git commit → main branch
           │
           ▼
  Adobe EDS reads repo, serves committed file
  https://www.aig.com/video-sitemap.xml  ✅
```

### How to keep `video-sitemap.xml` out of the repo

Use a **BYO CDN worker** (Cloudflare, Fastly, or Akamai). The worker fetches
`/video-index.json` at request time, builds the XML at the edge, and returns it
directly. Nothing is ever committed.

```
Googlebot → CDN edge worker → fetches /video-index.json → returns XML on the fly
                                                            (never touches the repo)
```

This requires you to manage your own CDN in front of AEM Edge Delivery
(documented in the Cloudflare / Fastly / Akamai sections below).

Use the **GitHub Action** (`tools/generate-video-sitemap.js` +
`.github/workflows/video-sitemap.yaml`) if you are on the Adobe-managed CDN and
are comfortable with the generated file living in the repo.

Use a **CDN worker** if you need real-time output **or** want the generated artifact
out of the repo entirely.

---

## Folder structure

```
tools/cdn-workers/
├── shared/
│   └── build-xml.js          Shared XML-builder logic (reference / Node.js tests)
├── cloudflare/
│   └── worker.js             Cloudflare Worker (ES modules, Wrangler)
├── fastly/
│   └── src/
│       └── index.js          Fastly Compute@Edge (JS SDK)
└── akamai/
    ├── main.js               Akamai EdgeWorker (responseProvider entry point)
    └── edgeworker.json       EdgeWorker bundle manifest
```

> **Note:** Each worker is self-contained and inlines the XML helpers.  
> `shared/build-xml.js` is the canonical source used for reference and for
> local Node.js tests — it is **not** imported at runtime by the CDN workers
> because each CDN has its own module system.

---

## Cloudflare

### Prerequisites
- Cloudflare account with Workers enabled.
- Your site is on a **BYO Cloudflare** CDN in front of AEM Edge Delivery.

### Deploy

```bash
npm install -g wrangler
wrangler login

# deploy as a standalone worker
wrangler deploy tools/cdn-workers/cloudflare/worker.js \
  --name aig-video-sitemap \
  --compatibility-date 2024-01-01
```

### wrangler.toml (minimal)

```toml
name = "aig-video-sitemap"
main = "tools/cdn-workers/cloudflare/worker.js"
compatibility_date = "2024-01-01"

[vars]
AEM_LIVE_HOST = "https://main--aig-eds-migration-poc--kprasad05.aem.live"
```

### Worker Route

In the Cloudflare dashboard → Workers & Pages → your zone → Routes, add:

```
www.aig.com/video-sitemap.xml  →  aig-video-sitemap
```

### Integrating with an existing proxy worker

If you already have a Cloudflare Worker proxying AEM requests, paste the
`handleVideoSitemap` function from `worker.js` into that worker's `fetch`
handler and add the path branch:

```js
if (pathname === '/video-sitemap.xml') {
  return handleVideoSitemap(request, env);
}
```

### Cache invalidation

The worker sets `Cache-Control: public, max-age=3600`.  
To purge the cached sitemap immediately from Cloudflare's edge:

```bash
# via Wrangler
wrangler purge --zone <ZONE_ID> --url https://www.aig.com/video-sitemap.xml

# or via Cloudflare API
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/purge_cache" \
  -H "Authorization: Bearer <API_TOKEN>" \
  -H "Content-Type: application/json" \
  --data '{"files":["https://www.aig.com/video-sitemap.xml"]}'
```

---

## Fastly

### Prerequisites
- Fastly account with **Compute@Edge** (JavaScript) entitlement.
- Your site is on a **BYO Fastly** CDN in front of AEM Edge Delivery.

### Deploy

```bash
npm install -g @fastly/cli
fastly login

cd tools/cdn-workers/fastly
fastly compute init   # choose JavaScript, accept defaults
# Replace the generated src/index.js with the one in this folder, then:
fastly compute publish
```

### fastly.toml (backend block to add/merge)

```toml
[setup.backends]
[setup.backends.aem_origin]
  address = "main--aig-eds-migration-poc--kprasad05.aem.live"
  port    = 443
```

### Routing from an existing VCL service

If your main Fastly service is VCL-based, the easiest route is to keep the VCL
service for everything except the sitemap and send only that path to the Compute
service:

```vcl
# In vcl_recv
if (req.url ~ "^/video-sitemap\.xml") {
  set req.backend = F_compute_video_sitemap;
}
```

Alternatively, convert the whole service to Compute@Edge and use the passthrough
branch in `src/index.js` for all other requests.

### Cache invalidation

```bash
# Instant purge by Surrogate-Key
fastly purge --service-id=<SERVICE_ID> --key=video-sitemap
```

---

## Akamai

### Prerequisites
- **EdgeWorkers** entitlement on your Akamai contract.
- Your site uses an Akamai delivery property pointing at AEM Edge Delivery.

### Bundle and upload

```bash
# Install the Akamai CLI + EdgeWorkers plugin
npm install -g @akamai/cli
akamai install edgeworkers

# Bundle
cd tools/cdn-workers/akamai
zip edgeworker.zip main.js edgeworker.json

# Create an EdgeWorker ID (first time only)
akamai edgeworkers create --name "AIG Video Sitemap" --group-id <GROUP_ID>
# Note the returned <EDGEWORKER_ID>

# Upload the bundle
akamai edgeworkers upload \
  --bundle=edgeworker.zip \
  --edgeworker-id=<EDGEWORKER_ID>

# Activate on staging
akamai edgeworkers activate \
  --edgeworker-id=<EDGEWORKER_ID> \
  --network=STAGING \
  --version=1.0.0
```

### Property Manager rule

Add a new rule **above** the default origin rule:

| Setting | Value |
|---|---|
| Match | Path → `/video-sitemap.xml` |
| Behavior: EdgeWorkers | EdgeWorker ID = `<EDGEWORKER_ID>` |
| Behavior: Origin Server | Hostname = `main--aig-eds-migration-poc--kprasad05.aem.live` |
| Behavior: Caching | Honor origin cache headers (Surrogate-Control drives TTL) |

### Cache invalidation

```bash
# Fast Purge by CP code (fastest — seconds)
akamai purge invalidate --cpcode <CPCODE>

# Or by URL
akamai purge invalidate --url https://www.aig.com/video-sitemap.xml
```

---

## Environment variables reference

| Variable | Used by | Purpose |
|---|---|---|
| `AEM_LIVE_HOST` | Cloudflare worker, build script | Full AEM Live preview origin |
| `DM_DELIVERY_DOMAIN` | Build script only | Dynamic Media delivery domain (optional) |
| `DM_API_KEY` | Build script only | DM API key (optional) |
| `SITE_HOST` | Build script | Override production origin for local testing |

---

## Local testing (build-script approach)

```bash
# Generate video-sitemap.xml locally against the AEM Live preview host
node tools/generate-video-sitemap.js

# Override the host (e.g. stage)
SITE_HOST=https://stage--aig-eds-migration-poc--kprasad05.aem.live \
  node tools/generate-video-sitemap.js
```

The generated file is committed to the repo root as `video-sitemap.xml` and
served directly by EDS. The GitHub Action (`.github/workflows/video-sitemap.yaml`)
runs this automatically on a daily schedule and commits any changes.
