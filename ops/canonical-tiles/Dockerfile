# Use the reviewed, immutable image digest of the existing tile compiler.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY canonical-builder.cjs canonical-worker.cjs canonical-handler.cjs ${LAMBDA_TASK_ROOT}/
ENV CANONICAL_TILE_BUILDER_PATH=/var/task/canonical-builder.cjs
CMD ["canonical-handler.handler"]
