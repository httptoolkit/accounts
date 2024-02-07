FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY custom-typings/ custom-typings/
COPY src/ src/

# We cache the BunnyCDN IP list at build time, so it's definitely available (without a
# dynamic update) at runtime. Should match update logic in src/trusted-xff-ip-setup.ts.
RUN wget 'https://bunnycdn.com/api/system/edgeserverlist' -O .bunny-ipv4-ips.json && \
    wget 'https://bunnycdn.com/api/system/edgeserverlist/IPv6' -O .bunny-ipv6-ips.json

# Set the image version at build time, and persist it in the environment
ARG VERSION=dev
ENV VERSION=$VERSION

CMD ["npm", "start"]
