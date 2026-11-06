#!/usr/bin/env bash
# Lifecycle integration check against an isolated Next.js project and user unit.
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
fixture=$(mktemp -d /tmp/magicapp-control.XXXXXX)
export MAGICAPP_PROJECT_DIR=$fixture
export MAGICAPP_SERVICE=magicapp-control-check-$$.service
export MAGICAPP_PORT=3019
foreign_pid=''
cleanup() {
    systemctl --user stop "$MAGICAPP_SERVICE" >/dev/null 2>&1 || true
    [[ -z "$foreign_pid" ]] || kill -TERM "$foreign_pid" 2>/dev/null || true
    rm -f -- "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$MAGICAPP_SERVICE"
    systemctl --user daemon-reload
    rm -rf -- "$fixture"
}
trap cleanup EXIT
[[ -z $(ss -H -ltn 'sport = :3019') ]] || { echo 'Test port 3019 is already occupied; test skipped.'; exit 1; }
ln -s -- "$repo/.next" "$fixture/.next"
ln -s -- "$repo/node_modules" "$fixture/node_modules"
ln -s -- "$repo/public" "$fixture/public"
cp -- "$repo/package.json" "$repo/next.config.ts" "$fixture/"
# Existing application data is never linked or used.
bash "$repo/scripts/install-magicapp.sh"
helper=$repo/scripts/magicapp.sh
bash "$helper" start
first=$(systemctl --user show "$MAGICAPP_SERVICE" -p MainPID --value)
[[ $first -gt 0 ]]
bash "$helper" start
[[ $(systemctl --user show "$MAGICAPP_SERVICE" -p MainPID --value) == "$first" ]]
bash "$helper" restart
second=$(systemctl --user show "$MAGICAPP_SERVICE" -p MainPID --value)
[[ $second -gt 0 && $second != "$first" ]]
bash "$helper" stop
! systemctl --user is-active --quiet "$MAGICAPP_SERVICE"
[[ -z $(ss -H -ltn 'sport = :3019') ]]
bash "$helper" stop
# A foreign process on the test port must never be terminated by the helper.
node -e 'require("node:http").createServer((req,res)=>res.end("foreign fixture")).listen(3019,"127.0.0.1")' &
foreign_pid=$!
for _ in $(seq 1 30); do
    curl --noproxy '*' --silent --fail http://127.0.0.1:3019/ >/dev/null && break
    sleep 0.2
done
if bash "$helper" restart; then echo 'Incorrectly accepted a foreign listener.' >&2; exit 1; fi
kill -0 "$foreign_pid"
kill -TERM "$foreign_pid"
wait "$foreign_pid" || true
foreign_pid=''
# Hand over a manually launched instance only when it belongs to this fixture.
(
    cd -- "$fixture"
    exec node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3019
) >"$fixture/manual.log" 2>&1 &
foreign_pid=$!
for _ in $(seq 1 30); do
    curl --noproxy '*' --silent --fail http://127.0.0.1:3019/ >/dev/null && break
    sleep 0.2
done
bash "$helper" restart
wait "$foreign_pid" || true
foreign_pid=''
curl --noproxy '*' --silent --fail http://127.0.0.1:3019/ >/dev/null
bash "$helper" stop
echo 'PASS: start, idempotent start, restart, stop, repeated stop, foreign-process protection, and manual handover.'
