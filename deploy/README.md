# Jhola's server

Jhola runs at **https://jhola.ramiyer.tech** on a Hostinger VPS running Ubuntu. It moved there from Vercel on Nov 8, 2026. Upstash Redis was kept, so the rate limits, answer cache and history carried over.

```
Browser ──HTTPS──▶ nginx (ports 80/443, Let's Encrypt certificate)
                     │  sets X-Real-IP, caps /api/build-carts per address
                     ▼
                   Next.js on 127.0.0.1:3000 (systemd service "jhola", user "jhola")
                     ├──▶ OpenAI API
                     └──▶ Upstash Redis (HTTPS)
```

| What | Where |
| --- | --- |
| Live site | https://jhola.ramiyer.tech |
| Server | Hostinger VPS `srv2139468`, Ubuntu, nginx 1.28, Node.js 24 (NodeSource) |
| SSH login | `ram@jhola.ramiyer.tech`; `sudo` asks for **ram's** password, not root's |
| DNS | Hostinger DNS: an A record for `jhola` pointing at the VPS, TTL 300 |
| App code | `/opt/jhola`, owned by the `jhola` user, which has no login and no admin rights |
| Secrets | `/opt/jhola/.env.production.local` (only on the server; deploys never copy or overwrite it) |
| Service | `/etc/systemd/system/jhola.service`, from [jhola.service](jhola.service) and refreshed on every deploy |
| nginx | `/etc/nginx/sites-available/jhola`, from [nginx/jhola.conf](nginx/jhola.conf) plus certbot's HTTPS lines |
| Certificate | Let's Encrypt, renews itself (first one expires Feb 6, 2027) |
| Logs | `sudo journalctl -u jhola` |
| Staging copy | `~/jhola-src` in ram's home (deploys copy here first) |

## Day to day

### Ship a change

From the project folder on your Mac:

```bash
deploy/deploy.sh
```

It runs the tests, copies the code (never secrets), installs packages and builds on the server, then restarts the app. It ends with:

```
→ App answered on the server: HTTP 200
→ Public site: HTTP 200 in 0.2s
✓ Deployed
```

The server asks once for ram's password. A deploy takes about a minute. The site is down for the second or two of the restart, and the cache and history aren't affected.

The `npm warn` lines during the install (a deprecated eslint, two `install-scripts`, a newer npm) are harmless.

### Watch the logs

```bash
sudo journalctl -u jhola -f
```

Each cart request logs one `build_carts` line with its query, time, tokens and whether it came from the cache. Ctrl+C stops watching.

### Change a secret or setting

```bash
sudo -u jhola nano /opt/jhola/.env.production.local
```

Save with Ctrl+O, Enter, Ctrl+X, then:

```bash
sudo systemctl restart jhola
```

The exception is `SITE_URL`: it's read at build time, so after changing it, run `deploy/deploy.sh` instead of only restarting.

The file holds `SITE_URL`, `OPENAI_API_KEY`, `LLM_MODEL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMIT_PER_HOUR`, `DAILY_REQUEST_CAP` and `HISTORY_KEY`. [.env.example](../.env.example) explains each one.

### Rotate a key

- **Upstash:** in [console.upstash.com](https://console.upstash.com), open the database and use **Reset Password**. That replaces the REST token; the URL stays the same. Copy the new token from **Connect → REST**, put it in the secrets file and restart. Until you do, the site keeps working but without limits, cache or history.
- **OpenAI:** create the new key first, put it in the secrets file, restart, check a cart builds, then revoke the old key.

### Other checks

| To | Run (on the server) |
| --- | --- |
| See if the app is running | `systemctl status jhola` |
| Test certificate renewal | `sudo certbot renew --dry-run` |
| See the certificate's expiry | `sudo certbot certificates` |
| Install Ubuntu and Node.js updates | `sudo apt update && sudo apt upgrade`, then `sudo systemctl restart jhola` |
| Read generations and their cost | open `https://jhola.ramiyer.tech/history?key=<HISTORY_KEY>` |

## Setting up a server from scratch

These are the steps that set up the current server. Use them to rebuild it or move to another one. Commands run on the server unless they say "on your Mac".

### 1. Point the domain at the server

In Hostinger, open **Domains → ramiyer.tech → DNS / Nameservers** and add:

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| A | `jhola` | the VPS's IPv4 address (hPanel → VPS → Overview) | 300 |

Delete any other A or AAAA records for the same name (Hostinger's parking records), or some visitors reach the wrong server. Only add an AAAA record if the VPS has IPv6.

Check it from your Mac or the server. It must print the VPS's IP:

```bash
dig +short jhola.ramiyer.tech
```

### 2. Install Node.js, rsync and certbot

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
```

```bash
sudo apt-get install -y nodejs rsync certbot python3-certbot-nginx
```

`node -v` should print `v24…`. This Ubuntu uses a newer `sudo` that doesn't accept `-E`; if a guide online uses `sudo -E`, leave the `-E` out.

### 3. Open the firewall for SSH and the web only

Allow SSH first, so you don't lock yourself out:

```bash
sudo ufw allow OpenSSH
```

```bash
sudo ufw allow 'Nginx Full'
```

```bash
sudo ufw enable
```

If Hostinger's own firewall is on (hPanel → **VPS → Security → Firewall**), it must allow ports 22, 80 and 443 as well.

### 4. Create the app user and folder

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin jhola
```

```bash
sudo mkdir -p /opt/jhola && sudo chown jhola:jhola /opt/jhola
```

### 5. Add the secrets

```bash
sudo -u jhola nano /opt/jhola/.env.production.local
```

```
SITE_URL=https://jhola.ramiyer.tech
OPENAI_API_KEY=
LLM_MODEL=gpt-5.4-mini
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
RATE_LIMIT_PER_HOUR=10
DAILY_REQUEST_CAP=300
HISTORY_KEY=
```

Fill in the values with no quote marks. For `HISTORY_KEY`, `openssl rand -hex 16` prints a good one. Then lock the file down:

```bash
sudo chmod 600 /opt/jhola/.env.production.local
```

### 6. First deploy (on your Mac)

```bash
deploy/deploy.sh
```

If you're logging in to a different server or user, pass it: `deploy/deploy.sh user@host`. The first SSH connection to a new name asks you to confirm the server's fingerprint; type `yes`.

### 7. Put nginx in front

```bash
sudo cp /opt/jhola/deploy/nginx/jhola.conf /etc/nginx/sites-available/jhola
```

```bash
sudo ln -s /etc/nginx/sites-available/jhola /etc/nginx/sites-enabled/jhola && sudo rm -f /etc/nginx/sites-enabled/default
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` should say `syntax is ok` and `test is successful`. `http://jhola.ramiyer.tech` should then show Jhola, without the padlock yet. For a different domain, change the `server_name` line in `/etc/nginx/sites-available/jhola` before reloading.

### 8. Turn on HTTPS

Get the certificate first:

```bash
sudo certbot --nginx -d jhola.ramiyer.tech --redirect
```

The first time, it asks for an email address (for expiry warnings) and asks you to accept the terms. It should end with "Successfully deployed certificate". Only after that will this test renewal; before a certificate exists it reports "No simulated renewals were attempted":

```bash
sudo certbot renew --dry-run
```

## If something goes wrong

| What you see | Cause and fix |
| --- | --- |
| `sudo: Authentication failed` | It wants the password of the user you're logged in as (`ram`), not root's. If that's forgotten, become root with `su -` (root's password) and run `passwd ram`. |
| `ssh: Could not resolve hostname` | The SSH target is wrong. It should be `ram@jhola.ramiyer.tech`, or the VPS's IP. |
| certbot: `Invalid Location header` or an IP that isn't the VPS | The domain in the command or in `server_name` doesn't point to this server. Check `dig +short <domain>` and `grep server_name /etc/nginx/sites-available/jhola`. Five failed tries block that domain for an hour. |
| certbot: timeout during connect | Port 80 is blocked. Check `sudo ufw status` shows `Nginx Full`, and check Hostinger's firewall. |
| nginx shows "502 Bad Gateway" | The app isn't running. `systemctl status jhola` and `sudo journalctl -u jhola -n 50` show why; usually a missing or misspelled value in the secrets file. |
| Every visitor gets "Too many requests" quickly | The app sees everyone as one address. The nginx file must keep its `X-Real-IP $remote_addr` line. |
| Carts fail with "trouble answering" | The logs give a reason: `missing_key`, `bad_key` or `quota` come from OpenAI. |
| The build stops with `Killed` | The server ran out of memory. Add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' \| sudo tee -a /etc/fstab` |
| Local dev server shows errors after a build | `npm run build` was run on your Mac while `npm run dev` was running; both use `.next`. Stop the dev server, delete `.next`, start it again. Deploys build on the server, so they never cause this. |
