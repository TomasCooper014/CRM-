#!/bin/sh
# Spins up a throwaway Postgres, loads schema.sql, and runs the end-to-end flow test.
# Needs PostgreSQL 15+ installed locally. Usage: sh supabase/tests/run.sh
set -e
here=$(cd "$(dirname "$0")" && pwd)
BIN=${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}
D=$(mktemp -d)
cleanup() { "$BIN/pg_ctl" -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"; }
trap cleanup EXIT
if [ "$(id -u)" = 0 ]; then # Postgres refuses to run as root
  chown postgres "$D"; RUN="su postgres -s /bin/sh -c"; else RUN="sh -c"; fi
$RUN "$BIN/initdb -D $D/data -A trust -U postgres >/dev/null && $BIN/pg_ctl -D $D/data -o '-k $D -p 5499 -c listen_addresses=' -l $D/log start -w >/dev/null"
P="psql -h $D -p 5499 -U postgres -v ON_ERROR_STOP=1 -q"
$P -f "$here/stub-auth.sql"
$P -f "$here/../schema.sql"
status=0
$P -tA -f "$here/flow.sql" >"$D/out" 2>&1 || status=$?
sed 's/^psql:[^:]*:[0-9]*: //' "$D/out" | grep -E '^(NOTICE|ERROR|ALL|FAILED)' | sed 's/^NOTICE:  //'
exit $status
