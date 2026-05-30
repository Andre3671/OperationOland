# Deploy till Unraid

Operation Öland körs som en enda Docker-container — Node 24 alpine bygger
Vite-bundlen, nginx-alpine serverar `dist/` på port 80 inuti containern.
En reverse proxy (NginxProxyManager) framför containern sköter SSL +
80/443 publikt.

Det här projektet följer exakt samma deploy-mönster som WeatherCompare så
att samma Unraid-runner och samma SCP-script funkar.

## TL;DR — automatiskt via GitHub Actions

`git push` till `main` triggar deploy. Workflowen
(`.github/workflows/deploy.yml`) kör på den självhostade runnern
**VeckansVaderRunner** på Unraid och gör:

1. Checkout av repot
2. Stoppar gamla containern, bygger ny image (med ORS-nyckel som build-arg)
3. Startar containern
4. Väntar tills servern svarar på `localhost:8091/`
5. Kör smoke-tester mot `/`, `/admin`, `/index.html`
6. Prunar dangling images

Manuell trigger: GitHub → **Actions** → "Deploy" → **Run workflow**.

### Förutsättningar för att CI ska funka

- Runnern måste vara igång på Unraid
- Runner-användaren måste vara i `docker`-gruppen
- Docker-nätverket `authentik_network` måste finnas
- **Secret `VITE_ORS_API_KEY`** måste vara satt i repo-settings →
  *Secrets and variables* → *Actions* → *New repository secret*. Utan den
  faller routing tillbaka till raka linjer (appen funkar fortfarande, men
  inga vägbaserade rutter).

---

## TL;DR — manuellt med `npm run deploy`

```powershell
npm run deploy
```

Scriptet (`scripts/deploy.ps1`):
1. Dödar lokala `node`-processer (släpper file locks)
2. Rensar `node_modules`, `dist`
3. Läser `VITE_ORS_API_KEY` från env eller `.env.local`
4. SCPar projektet + dot-filer till Unraid
5. Stoppar gammal container, bygger ny image (med nyckeln som build-arg)
6. Kör smoke-tester

Varianter:
- `npm run deploy:fast` — hoppar över clean
- `pwsh scripts/deploy.ps1 -SkipBuild` — bara starta om containern utan rebuild

Editera **`scripts/deploy.ps1`** överst om Unraid-IP, port eller nätverk
ändras. Default: `root@192.168.0.6`, port `8091`, nätverk `authentik_network`.

---

## Manuellt — om scriptet failar

```powershell
# Lokalt
cd C:\Users\babyb\Desktop\Projekt\OperationOland
Remove-Item -Recurse -Force node_modules,dist -ErrorAction SilentlyContinue
scp -r * root@192.168.0.6:/mnt/user/appdata/operationoland/
scp .dockerignore .gitignore root@192.168.0.6:/mnt/user/appdata/operationoland/
```

```bash
# På Unraid
ssh root@192.168.0.6
cd /mnt/user/appdata/operationoland

docker stop operationoland 2>/dev/null
docker rm operationoland 2>/dev/null

docker build \
  --build-arg VITE_ORS_API_KEY="eyJv...din-nyckel-här..." \
  -t operationoland:latest .

docker run -d \
  --name operationoland \
  --restart unless-stopped \
  --network authentik_network \
  -p 8091:80 \
  operationoland:latest

docker logs -f operationoland
```

### Smoke-test efter deploy

```bash
curl -s -o /dev/null -w "/: %{http_code}\n"           http://localhost:8091/
curl -s -o /dev/null -w "/admin: %{http_code}\n"      http://localhost:8091/admin
curl -s -o /dev/null -w "/index.html: %{http_code}\n" http://localhost:8091/index.html
```

Förväntat: tre `200`-koder. `/admin` returnerar `index.html` (SPA-fallback i
nginx-konfigen).

---

## docker-compose (alternativ till `docker run`)

Compose-filen ligger redan i repo-roten. På Unraid:

```bash
cd /mnt/user/appdata/operationoland
export VITE_ORS_API_KEY="eyJv..."
docker compose up -d --build
```

Den läser nyckeln från host-shellens env via `${VITE_ORS_API_KEY:-}` i
`docker-compose.yml`. Utan env-variabeln byggs imagen utan nyckel.

---

## Reverse proxy + SSL

Containern lyssnar på host-port `8091`. NginxProxyManager (på
`authentik_network`) framför:

| Fält | Värde |
| --- | --- |
| Domain Names | (din domän — t.ex. `operationoland.se`) |
| Scheme | `http` |
| Forward Hostname / IP | `192.168.0.6` |
| Forward Port | `8091` |
| Block Common Exploits | ✓ |
| Websockets Support | ✓ |

SSL-tabben: Request a new SSL certificate (Let's Encrypt). Force SSL ✓,
HTTP/2 ✓.

Om DNS pekar via Cloudflare proxy — sätt SSL/TLS-läget till **Full** så
snart NPM:s cert utfärdats.

---

## Felsökning

**Container startar inte:**
```bash
docker logs operationoland
```
Vanliga orsaker:
- Network `authentik_network` finns inte → `docker network create authentik_network`
- Port `8091` används redan → ändra första talet i `-p 8091:80`

**Vägrutter ritas som raka linjer:** ORS-nyckeln saknas i imagen. Kolla
i browsern att admin-sidan visar ideal-rutter som följer vägnätet. Om inte:
sätt `VITE_ORS_API_KEY` (env eller GitHub secret) och bygg om imagen —
nyckeln är inbakad i bundle vid build-tid, så en omstart räcker inte.

**`/admin` returnerar 404:** `nginx.conf` saknar SPA-fallback. Verifiera
att `try_files $uri $uri/ /index.html;` finns i `location /`.

**Bygget fail-ar på `npm ci`:** glömt SCP:a `.dockerignore` eller
`package-lock.json`. Kör SCP-stegen igen.

---

## Filöversikt

| Fil | Roll |
| --- | --- |
| `Dockerfile` | Multi-stage build: node 24 bygger Vite → nginx 1.27 serverar `dist/` |
| `nginx.conf` | SPA-fallback, asset-cache, gzip |
| `.dockerignore` | Stänger ute `node_modules`, `dist`, `.git`, `.claude`, `memory`, etc. |
| `docker-compose.yml` | Compose-variant, läser `VITE_ORS_API_KEY` från host-env |
| `scripts/deploy.ps1` | `npm run deploy` på Windows — SCP + remote rebuild + smoke-tests |
| `.github/workflows/deploy.yml` | CI som kör på Unraid-runnern |
