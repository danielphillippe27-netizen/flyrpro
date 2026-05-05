FROM public.ecr.aws/lambda/nodejs:22

WORKDIR ${LAMBDA_TASK_ROOT}

RUN dnf install -y \
    gcc-c++ \
    git \
    make \
    sqlite-devel \
    tar \
    zlib-devel \
  && git clone --depth 1 https://github.com/felt/tippecanoe.git /tmp/tippecanoe \
  && make -C /tmp/tippecanoe -j"$(nproc)" \
  && make -C /tmp/tippecanoe install \
  && rm -rf /tmp/tippecanoe \
  && curl -LsSf https://astral.sh/uv/install.sh | sh \
  && mkdir -p /opt/uv-python /opt/uv-tools \
  && UV_PYTHON_INSTALL_DIR=/opt/uv-python UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin /root/.local/bin/uv tool install overturemaps \
  && chmod -R a+rX /opt/uv-python /opt/uv-tools \
  && chmod a+rx /usr/local/bin/overturemaps \
  && dnf clean all

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./
COPY scripts/ ./scripts/

ENV HOME=/tmp
ENV XDG_CACHE_HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp
ENV TIPPECANOE_BIN=/usr/local/bin/tippecanoe
ENV OVERTUREMAPS_BIN=/usr/local/bin/overturemaps
ENV PATH="/usr/local/bin:${PATH}"

CMD ["index.handler"]
