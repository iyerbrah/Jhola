#!/bin/bash
# One-time setup that lets GitHub Actions deploy Jhola. Run on the server as root:
#
#   sudo bash setup-github-deploy.sh jhola_deploy.pub
#
# where jhola_deploy.pub is the public half of the key GitHub will use. It:
#   1. installs git if it's missing;
#   2. installs jhola-deploy (from the same folder as this script) to /usr/local/sbin, owned by root;
#   3. creates a "deploy" user with no password, whose only SSH key can run nothing but jhola-deploy;
#   4. lets "deploy" run exactly that one script as root without a password.
#
# Safe to run again, e.g. to install a newer jhola-deploy or replace the key.

set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo "Run this with sudo: sudo bash $0 <public key file>" >&2
  exit 1
fi
PUBKEY_FILE=${1:-}
if [[ -z $PUBKEY_FILE || ! -f $PUBKEY_FILE ]]; then
  echo "Usage: sudo bash $0 <public key file, e.g. jhola_deploy.pub>" >&2
  exit 1
fi
PUBKEY=$(head -n 1 "$PUBKEY_FILE")
if [[ ! $PUBKEY =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]]; then
  echo "$PUBKEY_FILE doesn't look like an ed25519 public key (it should start with ssh-ed25519)." >&2
  exit 1
fi
HERE=$(cd "$(dirname "$0")" && pwd)

echo "→ Checking tools"
if ! command -v git > /dev/null; then
  apt-get install -y git
fi

echo "→ Installing /usr/local/sbin/jhola-deploy"
install -o root -g root -m 755 "$HERE/jhola-deploy" /usr/local/sbin/jhola-deploy

echo "→ Creating the deploy user"
if ! id deploy > /dev/null 2>&1; then
  # /bin/sh (not nologin) because sshd runs the forced command below through the user's shell.
  useradd --system --create-home --shell /bin/sh deploy
fi
passwd -l deploy > /dev/null # no password login, ever

# The key can only run jhola-deploy, with the commit SHA GitHub sends as its one argument
# ($SSH_ORIGINAL_COMMAND is passed as a single quoted word and checked by the script).
# "restrict" turns off terminals, port forwarding and agent forwarding.
# root owns the file, so the deploy user can't change its own key.
install -d -o root -g root -m 755 /home/deploy/.ssh
printf 'restrict,command="sudo -n /usr/local/sbin/jhola-deploy \\"$SSH_ORIGINAL_COMMAND\\"" %s\n' "$PUBKEY" > /home/deploy/.ssh/authorized_keys
chown root:root /home/deploy/.ssh/authorized_keys
chmod 644 /home/deploy/.ssh/authorized_keys

echo "→ Allowing deploy to run jhola-deploy (and nothing else) as root"
RULE=/etc/sudoers.d/jhola-deploy
printf 'deploy ALL=(root) NOPASSWD: /usr/local/sbin/jhola-deploy\n' > "$RULE"
chmod 440 "$RULE"
# A broken sudoers file can lock everyone out of sudo, so check it and remove it if anything's off.
if command -v visudo > /dev/null && ! visudo -cf "$RULE" > /dev/null; then
  rm -f "$RULE"
  echo "The sudo rule didn't pass visudo's check, so it was removed. Nothing else changed in sudo." >&2
  exit 1
fi
if ! sudo -l -U deploy 2>/dev/null | grep -q /usr/local/sbin/jhola-deploy; then
  rm -f "$RULE"
  echo "sudo didn't accept the rule, so it was removed. Nothing else changed in sudo." >&2
  exit 1
fi

echo "✓ GitHub deploy access is set up. Test it from your Mac with the private key."
