# Expense Tracker — production container
# Node 24 (node:sqlite built in, matches local dev version)

FROM node:24-slim

WORKDIR /app

# install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# app code
COPY . .

# SQLite database lives here — attach a volume at /data in production
ENV NODE_ENV=production \
    DATA_DIR=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
