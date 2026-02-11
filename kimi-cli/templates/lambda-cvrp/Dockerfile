# Use AWS Lambda Python runtime as base
FROM public.ecr.aws/lambda/python:3.11-x86_64

# Install dependencies
RUN pip install ortools==9.8.3296 requests==2.31.0 numpy==1.26.0 -t ${LAMBDA_TASK_ROOT}

# Copy function code
COPY app.py ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler
CMD ["app.handler"]
