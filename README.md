# WiFi Coverage Simulator — container deployment

This repository packages the WiFi coverage simulator as a small Docker image
(`nginx:alpine` serving a single static HTML file).

```
.
├── index.html          # the app itself (single file)
├── Dockerfile          # nginx:alpine + the file
├── nginx.conf          # server config (gzip etc.)
├── docker-compose.yml  # build + run
├── .gitignore
└── README.md
```

> **Internet access is required at runtime:** the app loads Three.js (r128)
> from a CDN (`cdnjs.cloudflare.com`), so the container needs outbound
> internet for the 3D view to work. (To run fully offline later: download
> `three.min.js` into this folder, change the `<script src=...three.min.js...>`
> tag in `index.html` to `src="three.min.js"`, and add
> `COPY three.min.js /usr/share/nginx/html/` to the `Dockerfile`.)

---

## Demo

A demo of the full tool running can be accessed here: https://nevva.github.io/wifi-simulator/

## Quick start (any Docker host)

On a host with Docker + Docker Compose, in this folder:

```bash
docker compose up -d --build
```

Then open: **http://\<host-ip\>:8080**

Stop / restart:

```bash
docker compose down        # stop and remove
docker compose restart     # restart
```

Without compose, if you prefer:

```bash
docker build -t wifi-simulator .
docker run -d --name wifi-simulator --restart unless-stopped -p 8080:80 wifi-simulator
```


## Deploying on Proxmox (from the GitHub repo)

The Proxmox host (PVE) does not run Docker directly — create an **LXC**
or a **VM** that runs Docker, then clone the repo inside it.

1. **Create the container in the Proxmox GUI:** download the
   *Debian 12 standard* template (CT Templates), create a CT with e.g.
   1 vCPU / 512 MB RAM / 4 GB disk.
   - For Docker inside an LXC: either run it as a **privileged** CT, or
     enable *Features → nesting* (and *keyctl*) in the container options.

2. **Install Docker and git inside the container:**

   ```bash
   apt update && apt install -y docker.io docker-compose-plugin git
   systemctl enable --now docker
   ```

3. **Clone the repo and start:**

   ```bash
   git clone https://github.com/<your-user>/wifi-simulator.git /opt/wifi-simulator
   cd /opt/wifi-simulator
   docker compose up -d --build
   ```

4. Open **http://\<container-ip\>:8080** in your browser.

> If you prefer a VM over an LXC you can skip the nesting settings —
> install Docker in the VM and run the same commands.

### Updating a deployed instance

```bash
cd /opt/wifi-simulator
git pull
docker compose up -d --build
```

---

## Changing the port

Edit `8080` in `docker-compose.yml` (`"8080:80"` → e.g. `"80:80"` or
`"9000:80"`) and run `docker compose up -d` again.

## Troubleshooting

- **Page loads but the 3D view is empty/broken:** the container cannot reach
  the CDN. Check outbound internet, or bundle Three.js locally (see the note
  at the top).
- **Port already in use:** change the host port in `docker-compose.yml`.
- **`git clone` fails with authentication errors:** private repo — either make
  it public, or use a personal access token / SSH key inside the container.
- **Logs:** `docker logs wifi-simulator`.
