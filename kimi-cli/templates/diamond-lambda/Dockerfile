FROM public.ecr.aws/lambda/nodejs:22

WORKDIR ${LAMBDA_TASK_ROOT}

RUN dnf install -y \
    gcc-c++ \
    git \
    make \
    sqlite-devel \
    zlib-devel \
  && git clone --depth 1 https://github.com/felt/tippecanoe.git /tmp/tippecanoe \
  && make -C /tmp/tippecanoe -j"$(nproc)" \
  && make -C /tmp/tippecanoe install \
  && rm -rf /tmp/tippecanoe \
  && dnf clean all

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./
COPY scripts/ ./scripts/

ENV HOME=/tmp
ENV XDG_CACHE_HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp
ENV TIPPECANOE_BIN=/usr/local/bin/tippecanoe

CMD ["index.handler"]
