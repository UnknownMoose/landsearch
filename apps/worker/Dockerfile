FROM ghcr.io/osgeo/gdal:ubuntu-small-latest
WORKDIR /app
COPY package.json .
COPY tsconfig.json .
RUN apt-get update && apt-get install -y nodejs npm postgresql-client && npm i
COPY src ./src
COPY sql ./sql
RUN npm run build
CMD ["npm", "run", "start"]
