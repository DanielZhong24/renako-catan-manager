FROM python:3.12-slim

WORKDIR /app/catan-clanker

COPY catan-clanker/requirements.txt ./

RUN python -m pip install --upgrade pip

RUN python -m pip install --no-cache-dir \
    torch==2.14.1 \
    --index-url https://download.pytorch.org/whl/cpu

RUN python -m pip install --no-cache-dir -r requirements.txt

COPY catan-clanker/ ./
COPY models/ /app/models/

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "bot_api:app", "--host", "0.0.0.0", "--port", "8000"]
