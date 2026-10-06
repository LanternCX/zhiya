FROM postgres:17.11-alpine

# Keep the existing Alpine PostgreSQL data directory and add only pgvector.
RUN apk add --no-cache --virtual .vector-build build-base git \
    && git clone --branch v0.8.2 --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector with_llvm=no \
    && make -C /tmp/pgvector with_llvm=no install \
    && rm -rf /tmp/pgvector \
    && apk del .vector-build
