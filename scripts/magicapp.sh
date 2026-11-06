#!/usr/bin/env bash
set -euo pipefail
script_path=$(readlink -f -- "${BASH_SOURCE[0]}")
project_dir=${MAGICAPP_PROJECT_DIR:-$(dirname -- "$(dirname -- "$script_path")")}
project_dir=$(realpath -- "$project_dir")
service=${MAGICAPP_SERVICE:-magicapp.service}
port=${MAGICAPP_PORT:-6001}
[[ "$service" =~ ^[a-zA-Z0-9_-]+\.service$ ]] || { echo 'Invalid service name.' >&2; exit 1; }
[[ "$port" =~ ^[0-9]+$ ]] && ((port > 0 && port < 65536)) || { echo 'Invalid port.' >&2; exit 1; }
command=${1:-help}
case "$command" in start|restart|stop|status|logs|help|--help|-h) ;; *) echo 'Usage: magicapp {start|restart|stop|status|logs}' >&2; exit 2 ;; esac
if [[ "$command" == help || "$command" == --help || "$command" == -h ]]; then
    echo 'Usage: magicapp {start|restart|stop|status|logs}'
    echo 'Starts the existing production build; build new changes separately with npm run build.'
    exit 0
fi
state_dir=${XDG_STATE_HOME:-$HOME/.local/state}/magicapp
mkdir -p -- "$state_dir"
chmod 700 "$state_dir"
exec 9>"$state_dir/$service.lock"
flock -w 60 9 || { echo 'Another magicapp command is still running.' >&2; exit 1; }
systemctl --user show-environment >/dev/null || { echo 'Cannot contact your user service manager. Run from your normal Linux login terminal.' >&2; exit 1; }
systemctl --user cat "$service" >/dev/null 2>&1 || { echo 'Service is not installed. Run: bash scripts/install-magicapp.sh' >&2; exit 1; }
if [[ "$command" == logs ]]; then
    flock -u 9
    exec journalctl --user -u "$service" -n 100 -f
fi
if [[ "$command" == status ]]; then
    systemctl --user status "$service" --no-pager --lines=0 || true
    echo 'Port listener:'
    ss -H -ltnp "sport = :$port"
    exit 0
fi
# Identify listeners by port and verify both ownership and project directory.
# Never use broad pkill/node/npm matching: other apps run on this server.
listener_pids() {
    ss -H -ltnp "sport = :$port" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true
}
check_listener() {
    local pid=$1 process_dir owner executable title
    process_dir=$(readlink -f -- "/proc/$pid/cwd" 2>/dev/null || true)
    owner=$(stat -c %u -- "/proc/$pid" 2>/dev/null || true)
    executable=$(readlink -f -- "/proc/$pid/exe" 2>/dev/null || true)
    title=$(cat "/proc/$pid/comm" 2>/dev/null || true)
    [[ "$process_dir" == "$project_dir" && "$owner" == "$EUID" && "${executable##*/}" == node && "$title" == next-server* ]]
}
stop_manual() {
    local pid identity now
    for pid in $(listener_pids); do
        check_listener "$pid" || { echo "Port $port belongs to a different process; refusing to stop it." >&2; return 1; }
        identity=$(cat "/proc/$pid/stat")
        echo "Stopping the terminal-launched MagicWebApp (PID $pid)…"
        kill -TERM "$pid"
        for _ in $(seq 1 30); do
            [[ -e "/proc/$pid/stat" ]] || break
            # The process start time prevents acting on a reused PID.
            now=$(cat "/proc/$pid/stat" 2>/dev/null || true)
            [[ "${now##*) }" == '' ]] && break
            [[ $(awk '{print $20}' <<< "${identity##*) }") == $(awk '{print $20}' <<< "${now##*) }") ]] || break
            [[ "${now##*) }" == Z\ * ]] && break
            sleep 1
        done
        if listener_pids | grep -Fxq "$pid"; then
            echo 'The app did not stop gracefully. Inspect it before retrying; no force-kill was sent.' >&2
            return 1
        fi
    done
}
wait_ready() {
    local main_pid
    for _ in $(seq 1 30); do
        main_pid=$(systemctl --user show "$service" -p MainPID --value)
        if [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] && listener_pids | grep -Fxq "$main_pid" && systemctl --user is-active --quiet "$service" && curl --noproxy '*' --fail --silent --max-time 2 "http://127.0.0.1:$port/" >/dev/null; then
            echo "MagicApp is running on port $port."
            echo 'Open http://mernamagicapp.local'
            return 0
        fi
        sleep 1
    done
    echo 'The app did not become ready. Recent logs:' >&2
    journalctl --user -u "$service" -n 25 --no-pager >&2
    return 1
}
if [[ "$command" == stop ]]; then
    systemctl --user stop "$service"
    stop_manual
    echo 'MagicApp stopped.'
    exit 0
fi
[[ -f "$project_dir/.next/BUILD_ID" ]] || { echo 'No production build. Run npm run build from the project directory first.' >&2; exit 1; }
if [[ "$command" == start ]] && systemctl --user is-active --quiet "$service"; then
    wait_ready
    exit 0
fi
if [[ "$command" == restart ]]; then
    systemctl --user stop "$service"
    stop_manual
else
    pids=$(listener_pids)
    if [[ -n "$pids" ]]; then
        for pid in $pids; do
            check_listener "$pid" || { echo "Port $port belongs to another application; it was left running." >&2; exit 1; }
        done
        echo "MagicApp is already running from a terminal on port $port."
        echo 'Run magicapp restart to move it into the managed background service.'
        exit 0
    fi
    if [[ -n $(ss -H -ltn "sport = :$port") ]]; then
        echo "Port $port is occupied by a process whose owner cannot be verified. Start refused." >&2
        exit 1
    fi
fi
systemctl --user reset-failed "$service" >/dev/null 2>&1 || true
systemctl --user start "$service"
wait_ready
