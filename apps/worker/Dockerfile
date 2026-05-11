FROM ghcr.io/osgeo/gdal:ubuntu-small-latest
WORKDIR /app
COPY package.json .
RUN apt-get update && apt-get install -y nodejs npm postgresql-client && npm i
COPY src ./src
COPY ../.. /repo
CMD ["npm", "run", "dev"]
