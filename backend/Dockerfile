# Use Chainguard Python image for development (includes shell and pip)
FROM cgr.dev/chainguard/python:latest-dev

# Set working directory
WORKDIR /app

# Copy dependency manifest + lockfile first so the deps install layer is
# cached independently of source changes.
COPY --chown=nonroot:nonroot pyproject.toml uv.lock ./

# Install uv, then sync the locked deps into a project venv at /app/.venv.
# --frozen requires uv.lock to be in sync with pyproject.toml; build fails
# loudly if someone forgets to commit a lockfile update.
# --no-install-project skips installing the project itself (we only need deps).
RUN pip install --no-cache-dir uv && \
    uv sync --frozen --no-install-project

# Copy application code
COPY --chown=nonroot:nonroot src/ /app/src/

# Set environment variables
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"

# Expose port
EXPOSE 8000

# Reset entrypoint (Chainguard image sets python as entrypoint)
ENTRYPOINT []

# Run the application with hot-reload for development
CMD ["/bin/sh", "-c", ". /app/.venv/bin/activate && python -m uvicorn src.main:app --host 0.0.0.0 --port 8000"]
