#!/bin/sh
# Hosting-Plattformen hängen das Daten-Volume oft als root ein. Dann hier die
# Rechte anpassen und anschließend ohne root-Rechte weiterlaufen.
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
