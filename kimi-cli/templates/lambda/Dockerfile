FROM public.ecr.aws/lambda/nodejs:20

WORKDIR ${LAMBDA_TASK_ROOT}

COPY package.json ./
RUN npm install --omit=dev

# Bundle DuckDB spatial extension into the image (no runtime download needed)
# The duckdb npm package v1.4.3 uses DuckDB engine v1.4.4
# Extension is pre-downloaded and decompressed locally
COPY duckdb_extensions/ /var/task/duckdb_extensions/

COPY index.js ./

CMD ["index.handler"]
