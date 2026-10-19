FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/cache/hf
WORKDIR /app

# torch CPU dipasang lebih dulu agar pip tidak menarik build CUDA (beberapa GB)
RUN pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py alignment.py models.py ./

EXPOSE 8001
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]