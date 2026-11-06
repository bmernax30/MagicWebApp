#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -ne 0 ]] || { echo 'Run this installer as your normal user, without sudo.' >&2; exit 1; }
script_path=$(readlink -f -- "${BASH_SOURCE[0]}")
project_dir=${MAGICAPP_PROJECT_DIR:-$(dirname -- "$(dirname -- "$script_path")")}
project_dir=$(realpath -- "$project_dir")
service=${MAGICAPP_SERVICE:-magicapp.service}
port=${MAGICAPP_PORT:-6001}
[[ "$service" =~ ^[a-zA-Z0-9_-]+\.service$ ]] || { echo 'Invalid service name.' >&2; exit 1; }
[[ "$port" =~ ^[0-9]+$ ]] && ((port > 0 && port < 65536)) || { echo 'Invalid port.' >&2; exit 1; }
node_bin=$(command -v node)
[[ -f "$project_dir/node_modules/next/dist/bin/next" ]] || { echo 'Install project dependencies first with npm ci.' >&2; exit 1; }
unit_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
bin_dir=$HOME/.local/bin
mkdir -p -- "$unit_dir" "$bin_dir"
if [[ -f "$unit_dir/$service" ]] && ! grep -Fq '# Managed by MagicWebApp command installer' "$unit_dir/$service"; then
    echo 'An unmanaged unit already uses this service name; refusing to replace it.' >&2; exit 1
fi
if [[ -e "$bin_dir/magicapp" || -L "$bin_dir/magicapp" ]]; then
    [[ $(readlink -f -- "$bin_dir/magicapp") == "$(dirname -- "$script_path")/magicapp.sh" ]] || { echo 'An existing magicapp command belongs to another installation.' >&2; exit 1; }
fi
python3 - "$project_dir" "$node_bin" "$port" "$unit_dir/$service" "$(dirname -- "$script_path")/../deploy/systemd/magicapp.service.in" <<'PY'
from pathlib import Path
import sys
project, node, port, destination, template = sys.argv[1:]
def quote(value):
    if '\n' in value or '\r' in value: raise SystemExit('Paths may not contain newlines.')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
text = Path(template).read_text()
for key, value in {'@PROJECT@': project.replace('%', '%%'), '@NODE@': quote(node), '@NEXT@': quote(project + '/node_modules/next/dist/bin/next'), '@PORT@': port}.items():
    text = text.replace(key, value)
Path(destination).write_text(text)
PY
ln -sfn -- "$(dirname -- "$script_path")/magicapp.sh" "$bin_dir/magicapp"
systemctl --user daemon-reload
if ! loginctl --no-ask-password enable-linger "$(id -un)"; then
    echo "For service operation after logout, run once: sudo loginctl enable-linger $(id -un)" >&2
fi
echo "Installed magicapp command: $bin_dir/magicapp"
echo "Installed user unit: $unit_dir/$service"
echo 'Then use: magicapp start | magicapp restart | magicapp stop'
