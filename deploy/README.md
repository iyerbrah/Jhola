# Jhola's server

Jhola runs at **https://jhola.ramiyer.tech** on a Hostinger VPS running Ubuntu. It moved there from Vercel on Nov 8, 2026. Upstash Redis was kept, so the rate limits and answer cache carried over.

```
Browser ──HTTPS──▶ nginx (ports 80/443, Let's Encrypt certificate)
                     │  sets X-Real-IP, caps /api/chat, /api/solve and /api/share per address
                     ▼
                   Next.js on 127.0.0.1:3000 (systemd service "jhola", user "jhola")
                     ├──▶ OpenRouter (openai/gpt-5.4-mini)
                     ├──▶ Upstash Redis (HTTPS): rate limits, first-answer cache
                     └──▶ PostgreSQL on 127.0.0.1:5432: request log, feedback, /stats
```

| What | Where |
| --- | --- |
| Live site | https://jhola.ramiyer.tech |
| Server | Hostinger VPS, Ubuntu, nginx 1.28, Node.js 24 (NodeSource) |
| SSH login | `<you>@jhola.ramiyer.tech`, your own sudo user; `sudo` asks for **that user's** password, not root's |
| DNS | Hostinger DNS: an A record for `jhola` pointing at the VPS, TTL 300 |
| App code | `/opt/jhola`, owned by the `jhola` user, which has no login and no admin rights |
| Secrets | `/opt/jhola/.env.production.local` (only on the server; deploys never copy or overwrite it) |
| Service | `/etc/systemd/system/jhola.service`, from [jhola.service](jhola.service) and refreshed on every deploy |
| nginx | `/etc/nginx/sites-available/jhola`, from [nginx/jhola.conf](nginx/jhola.conf) plus certbot's HTTPS lines |
| Certificate | Let's Encrypt, renews itself (first one expires Feb 6, 2027) |
| Logs | `sudo journalctl -u jhola` |
| Deploys | GitHub Actions ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)) after CI passes on `main` |
| Deploy user | `deploy`: no password; its one SSH key can only run `/usr/local/sbin/jhola-deploy` (from [server/jhola-deploy](server/jhola-deploy)) |
| Deploy state | `/var/lib/jhola-deploy`: a clone of the repo, `current` (the live commit) and `history` (every deploy) |
| Staging copy | `~/jhola-src` in your home (only the manual `deploy/deploy.sh` uses it) |
| Request log | PostgreSQL on this machine (127.0.0.1:5432), database `jhola`; the app creates its tables itself. Backups nightly in `/var/backups/jhola` |

## Day to day

### Ship a change

Merge a pull request into `main`. CI runs on `main` again, and when it passes the **Deploy** workflow:

1. connects to the server as `deploy` (the server's host key is pinned, so it can't be fooled into talking to another machine);
2. runs `jhola-deploy <commit>`, which fetches that commit from GitHub, refuses anything that isn't on `main`, copies it into `/opt/jhola` (never touching the secrets file), runs `npm ci` and the build as the `jhola` user, restarts the app and waits for it to answer;
3. checks the public site answers.

Follow it under **Actions → Deploy** on GitHub; each run also shows up under **Deployments** on the repo page. A deploy takes about two minutes, and the site is down only for the second or two of the restart.

To see which commit is live, on the server:

```bash
cat /var/lib/jhola-deploy/current
```

### Roll back

On GitHub, open **Actions → Deploy → Run workflow**, paste the full SHA of an earlier commit on `main` (from `git log` or the commits page) and run it. Leaving the box empty redeploys the latest `main`. On the server, `cat /var/lib/jhola-deploy/history` lists every deploy with its time.

The same works on the server by hand:

```bash
sudo /usr/local/sbin/jhola-deploy <commit SHA>
```

### Deploy by hand from the Mac

`deploy/deploy.sh` still works and is needed in two cases: after changing [jhola.service](jhola.service) (only this script installs it), and if GitHub Actions is down. It copies the code from your Mac, including uncommitted changes, so prefer merging a PR.

```bash
deploy/deploy.sh
```

It runs the tests, copies the code (never secrets), installs packages and builds on the server, installs the service file, then restarts the app. The server asks once for your password. The `npm warn` lines during the install are harmless.

### Change the deploy script itself

Deploys never update `/usr/local/sbin/jhola-deploy`, the service file or nginx, so a merged PR can't give itself more access to the server. After changing [server/jhola-deploy](server/jhola-deploy), install it by hand, from the project folder on your Mac:

```bash
scp deploy/server/jhola-deploy deploy/server/setup-github-deploy.sh ~/.ssh/jhola_deploy.pub <you>@jhola.ramiyer.tech:
```

```bash
ssh -t <you>@jhola.ramiyer.tech 'sudo bash setup-github-deploy.sh jhola_deploy.pub'
```

### Apply an nginx change

Deploys never change nginx, so a change to [nginx/jhola.conf](nginx/jhola.conf) has to be copied into the live file by hand. The live file also has certbot's HTTPS lines, so edit it rather than replacing it:

```bash
sudo nano /etc/nginx/sites-available/jhola
```

Make the same change there: a new `limit_req_zone` line goes next to the existing one at the top, and a new `location` block goes inside the `server` block that has `listen 443`, above `location / {`. Save with Ctrl+O, Enter, Ctrl+X, then check and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` must say `syntax is ok` and `test is successful` before the reload; if it doesn't, the live site keeps running on the old config. Fix the file and try again.

### Watch the logs

```bash
sudo journalctl -u jhola -f
```

Each cart request logs one `build_carts` line with its query, time, tokens and whether it came from the cache. Each agent turn logs one `agent_step` line per model or tool call and one `agent_turn` line, all sharing a `trace_id`. To follow one turn: `sudo journalctl -u jhola | grep <trace_id>`. Ctrl+C stops watching.

### Look at the request log

Every cart build and agent turn is saved in Postgres (`requests`, with `carts`, `cart_items` and `trace_steps`). For a quick look on the server:

```bash
sudo -u postgres psql jhola -c "select kind, status, count(*), round(avg(latency_ms)) as avg_ms from requests where created_at > now() - interval '1 day' group by 1, 2 order by 1, 2"
```

One request's model and tool calls, slowest first (paste a `request_id` from a response or the logs):

```bash
sudo -u postgres psql jhola -c "select step, kind, name, attempt, ok, ms from trace_steps where request_id = '<request_id>' order by ms desc"
```

Backups run nightly to `/var/backups/jhola` (7 days kept). To restore one into the live database (it replaces what's there):

```bash
sudo -u postgres pg_restore --clean --if-exists -d jhola /var/backups/jhola/jhola-2026-11-09.dump
```

### Change a secret or setting

```bash
sudo -u jhola nano /opt/jhola/.env.production.local
```

Save with Ctrl+O, Enter, Ctrl+X, then:

```bash
sudo systemctl restart jhola
```

The exception is `SITE_URL`: it's read at build time, so after changing it, run `deploy/deploy.sh` instead of only restarting.

The file holds `SITE_URL`, `LLM_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (plus `OPENAI_API_KEY` and `OPENAI_MODEL` only to call OpenAI directly), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMIT_PER_HOUR`, `DAILY_REQUEST_CAP`, `HISTORY_KEY`, `DATABASE_URL` and `VISITOR_SECRET`. [.env.example](../.env.example) explains each one.

### Rotate a key

- **Upstash:** in [console.upstash.com](https://console.upstash.com), open the database and use **Reset Password**. That replaces the REST token; the URL stays the same. Copy the new token from **Connect → REST**, put it in the secrets file and restart. Until you do, the site keeps working but without rate limits or the answer cache.
- **OpenRouter** (or OpenAI, if you call it directly): create the new key first, put it in the secrets file, restart, check a cart builds, then revoke the old key.

### Other checks

| To | Run (on the server) |
| --- | --- |
| See if the app is running | `systemctl status jhola` |
| Test certificate renewal | `sudo certbot renew --dry-run` |
| See the certificate's expiry | `sudo certbot certificates` |
| Install Ubuntu and Node.js updates | `sudo apt update && sudo apt upgrade`, then `sudo systemctl restart jhola` |
| Read recent builds and their cost | open `https://jhola.ramiyer.tech/history?key=<HISTORY_KEY>` |
| See volume, speed, cost and feedback | open `https://jhola.ramiyer.tech/stats` (public, totals only) |

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
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-5.4-mini
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
RATE_LIMIT_PER_HOUR=10
DAILY_REQUEST_CAP=300
HISTORY_KEY=
```

Fill in the values with no quote marks (`DATABASE_URL` and `VISITOR_SECRET` are added in step 10). For `HISTORY_KEY`, `openssl rand -hex 16` prints a good one. Then lock the file down:

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

### 9. Let GitHub deploy

All on your Mac, from the project folder. Make a key just for GitHub (no passphrase, since a robot uses it):

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f ~/.ssh/jhola_deploy
```

Copy the setup files and the public key to the server, then run the setup (it asks for your password twice: once to log in, once for sudo):

```bash
scp deploy/server/jhola-deploy deploy/server/setup-github-deploy.sh ~/.ssh/jhola_deploy.pub <you>@jhola.ramiyer.tech:
```

```bash
ssh -t <you>@jhola.ramiyer.tech 'sudo bash setup-github-deploy.sh jhola_deploy.pub'
```

It ends with `✓ GitHub deploy access is set up`. Test the key by deploying the latest `main` with it. This is a real deploy, ending with `✓ Deployed` and the commit:

```bash
git fetch origin && ssh -i ~/.ssh/jhola_deploy -o IdentitiesOnly=yes deploy@jhola.ramiyer.tech "$(git rev-parse origin/main)"
```

Then give GitHub the private key and the server's host key:

```bash
gh secret set DEPLOY_SSH_KEY < ~/.ssh/jhola_deploy
```

```bash
ssh-keyscan -t ed25519 jhola.ramiyer.tech 2>/dev/null | gh variable set DEPLOY_KNOWN_HOSTS
```

The host key's fingerprint should match what your Mac saw when you first connected: `ssh-keygen -F jhola.ramiyer.tech -l` and `ssh-keyscan -t ed25519 jhola.ramiyer.tech 2>/dev/null | ssh-keygen -lf -` print the same `SHA256:…`.

### 10. Add the database (the request log)

Copy the setup script to the server and run it. It installs PostgreSQL (listening on this machine only), creates the `jhola` database, sets up nightly backups, writes `DATABASE_URL` and `VISITOR_SECRET` into the secrets file and restarts the app. From your Mac:

```bash
scp deploy/server/setup-postgres.sh <you>@jhola.ramiyer.tech:
```

```bash
ssh -t <you>@jhola.ramiyer.tech 'sudo bash setup-postgres.sh'
```

It ends with `✓ PostgreSQL is ready`. The app creates its tables the first time it saves a request, so there's nothing else to run. Without the database the site still works; requests just aren't kept.

## If something goes wrong

| What you see | Cause and fix |
| --- | --- |
| `sudo: Authentication failed` | It wants the password of the user you're logged in as, not root's. If that's forgotten, become root with `su -` (root's password) and run `passwd <you>`. |
| `ssh: Could not resolve hostname` | The SSH target is wrong. It should be `<you>@jhola.ramiyer.tech`, or `<you>@` the VPS's IP. |
| certbot: `Invalid Location header` or an IP that isn't the VPS | The domain in the command or in `server_name` doesn't point to this server. Check `dig +short <domain>` and `grep server_name /etc/nginx/sites-available/jhola`. Five failed tries block that domain for an hour. |
| certbot: timeout during connect | Port 80 is blocked. Check `sudo ufw status` shows `Nginx Full`, and check Hostinger's firewall. |
| nginx shows "502 Bad Gateway" | The app isn't running. `systemctl status jhola` and `sudo journalctl -u jhola -n 50` show why; usually a missing or misspelled value in the secrets file. |
| Every visitor gets "Too many requests" quickly | The app sees everyone as one address. The nginx file must keep its `X-Real-IP $remote_addr` line. |
| Carts fail with "trouble answering" | The logs give a reason: `missing_key`, `bad_key` or `quota` come from the model provider (OpenRouter): check the key and the account's credits. |
| The build stops with `Killed` | The server ran out of memory. Add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' \| sudo tee -a /etc/fstab` |
| Deploy workflow: `DEPLOY_SSH_KEY secret or DEPLOY_KNOWN_HOSTS variable is missing` | Step 9's two `gh` commands weren't run, or were run for another repo. `gh secret list` and `gh variable list` should show them. |
| Deploy workflow: `Host key verification failed` | The server's host key changed (e.g. the VPS was rebuilt). Check the new fingerprint on the server with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, then rerun the `ssh-keyscan … \| gh variable set` command. |
| Deploy workflow: `Permission denied (publickey)` | The key in the secret doesn't match `/home/deploy/.ssh/authorized_keys`. Rerun the setup with `~/.ssh/jhola_deploy.pub`, then `gh secret set` again. |
| Deploy workflow: `sudo: a password is required` | The sudo rule is missing. Rerun the setup script; it checks the rule and says if sudo rejected it. |
| Deploy workflow: `isn't on main` | Only commits on `main` can be deployed. Merge the PR first, or pick a SHA from `main`'s history. |
| Logs say `[request-log] couldn't save … request(s)` | The app can't reach Postgres. `systemctl status postgresql`, and check `DATABASE_URL` in the secrets file. The site keeps working; those requests just aren't kept. Rerunning `setup-postgres.sh` resets the password and the secrets line together. |
| Local dev server shows errors after a build | `npm run build` was run on your Mac while `npm run dev` was running; both use `.next`. Stop the dev server, delete `.next`, start it again. Deploys build on the server, so they never cause this. |
