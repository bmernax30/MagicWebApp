#!/usr/bin/env bash
# Install the reviewed configuration for this Linux server's LAN address.
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then
    echo 'Run from the project directory: sudo bash scripts/setup-lan-name.sh' >&2
    exit 1
fi
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
server_ip=192.168.86.175
lan_interface=enp2s0f0
lan_subnet=192.168.86.0/24
caddy_config=/etc/caddy/Caddyfile
name_unit=/etc/systemd/system/mernamagicapp-name.service
for dependency in caddy systemctl avahi-publish-address avahi-resolve-host-name curl python3 ip ss systemd-analyze; do
    command -v "$dependency" >/dev/null || { echo "Missing prerequisite: $dependency" >&2; exit 1; }
done
ip -o -4 address show dev "$lan_interface" | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "$server_ip" || {
    echo "Expected $server_ip on $lan_interface; review deploy/lan before installation." >&2; exit 1;
}
systemctl is-active --quiet avahi-daemon
systemctl is-active --quiet caddy
curl --noproxy '*' --fail --silent --show-error "http://127.0.0.1:6001/" >/dev/null
if [[ -f "$name_unit" ]] && ! grep -Fq '# Managed by MagicWebApp LAN setup' "$name_unit"; then
    echo "An unmanaged service already exists at $name_unit; refusing to replace it." >&2; exit 1
fi
listeners=$(ss -H -ltnp 'sport = :80')
if [[ -n "$listeners" ]] && [[ "$listeners" != *'"caddy"'* ]]; then
    echo 'Port 80 is already used by another service; no configuration changed.' >&2; exit 1
fi
existing_ip=$(avahi-resolve-host-name -4 mernamagicapp.local 2>/dev/null | awk '{print $2}' || true)
if [[ -n "$existing_ip" && "$existing_ip" != "$server_ip" ]]; then
    echo "mernamagicapp.local already belongs to $existing_ip; no configuration changed." >&2; exit 1
fi
staging_dir=$(mktemp -d /tmp/magicweb-lan.XXXXXX)
chmod 700 "$staging_dir"
trap 'rm -rf -- "$staging_dir"' EXIT
cp -- "$caddy_config" "$staging_dir/original.Caddyfile"
python3 - "$staging_dir/original.Caddyfile" "$project_dir/deploy/lan/mernamagicapp.caddy" "$staging_dir/Caddyfile" <<'PY'
from pathlib import Path
import sys
original = Path(sys.argv[1]).read_text()
begin, end = '# BEGIN MagicWebApp LAN', '# END MagicWebApp LAN'
if begin in original:
    if original.count(begin) != 1 or original.count(end) != 1:
        raise SystemExit('Invalid managed Caddy block; refusing to edit.')
    a = original.index(begin)
    b = original.index(end, a) + len(end)
    original = original[:a] + original[b:]
elif 'mernamagicapp.local' in original:
    raise SystemExit('An unmanaged Caddy route already uses this hostname; refusing to edit.')
Path(sys.argv[3]).write_text(original.rstrip() + '\n\n' + Path(sys.argv[2]).read_text())
PY
caddy validate --config "$staging_dir/Caddyfile" --adapter caddyfile
systemd-analyze verify "$project_dir/deploy/lan/mernamagicapp-name.service"
cmp --silent "$caddy_config" "$staging_dir/original.Caddyfile" || {
    echo 'The Caddyfile changed during preparation; retry after reviewing it.' >&2; exit 1;
}
backup_dir=$(mktemp -d /etc/caddy/magicweb-backup.XXXXXX)
chmod 700 "$backup_dir"
cp -a -- "$caddy_config" "$backup_dir/Caddyfile"
if [[ -f "$name_unit" ]]; then cp -a -- "$name_unit" "$backup_dir/mernamagicapp-name.service"; fi
echo "Original configuration saved in $backup_dir"
install -o root -g root -m 644 "$staging_dir/Caddyfile" "$caddy_config"
install -o root -g root -m 644 "$project_dir/deploy/lan/mernamagicapp-name.service" "$name_unit"
systemctl daemon-reload
systemctl enable mernamagicapp-name.service
systemctl restart mernamagicapp-name.service
systemctl reload caddy
if command -v ufw >/dev/null && LC_ALL=C ufw status | grep -q '^Status: active'; then
    ufw allow in on "$lan_interface" from "$lan_subnet" to "$server_ip" port 80 proto tcp
    ufw allow in on "$lan_interface" from "$lan_subnet" to any port 5353 proto udp
fi
systemctl is-active --quiet mernamagicapp-name.service
resolved_ip=''
for attempt in 1 2 3 4 5; do
    resolved_ip=$(avahi-resolve-host-name -4 mernamagicapp.local 2>/dev/null | awk '{print $2}' || true)
    [[ "$resolved_ip" == "$server_ip" ]] && break
    sleep 1
done
[[ "$resolved_ip" == "$server_ip" ]] || { echo 'Name service started, but hostname verification failed; inspect its journal.' >&2; exit 1; }
curl --noproxy '*' --fail --silent --show-error --resolve "mernamagicapp.local:80:$server_ip" http://mernamagicapp.local/ >/dev/null
echo 'Ready: http://mernamagicapp.local (also http://mernamagicapp.local:6001)'
echo 'Keep the app running on port 6001 and reserve 192.168.86.175 for this server in the router.'
