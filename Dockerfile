FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY docker-entrypoint.sh ./
# Preishistorie (SQLite) liegt in /app/data – dort ein dauerhaftes Volume einhängen, sonst geht sie
# bei jedem Neustart verloren. (Kein VOLUME-Befehl: Railway lässt ihn in Dockerfiles nicht zu.)
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 3000
HEALTHCHECK --interval=1m --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Startet als root, korrigiert die Rechte des Volumes und wechselt dann zum Benutzer "node".
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
