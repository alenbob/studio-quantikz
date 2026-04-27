FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY api ./api
COPY src ./src
COPY quantikz_symbolic_latex.py ./
COPY quantikz_statevector_evolution.py ./

EXPOSE 10000

CMD ["npm", "run", "start:backend"]