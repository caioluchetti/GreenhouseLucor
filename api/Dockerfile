FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    locales \
    && sed -i '/pt_BR.UTF-8/s/^# //' /etc/locale.gen \
    && locale-gen pt_BR.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=pt_BR.UTF-8
ENV LC_TIME=pt_BR.UTF-8

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 6001

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "6001"]
