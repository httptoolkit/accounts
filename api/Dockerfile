FROM node:20

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY custom-typings/ custom-typings/
COPY src/ src/

# Set the image version at build time, and persist it in the environment
ARG VERSION=dev
ENV VERSION=$VERSION

CMD ["npm", "start"]
