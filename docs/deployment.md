# Deployment & Operations Guide (`deployment.md`)
## Web VNC Java Game Platform (CloudJava VNC)

---

## 1. Prerequisites & Server Requirements

* **Operating System:** Ubuntu 22.04 LTS / Debian 12
* **Minimum Specifications:** 4 vCPU, 8GB RAM, 50GB NVMe SSD
* **Required Software:** Docker Engine v24+, Docker Compose v2.20+, Nginx, Certbot (SSL)

---

## 2. Step-by-Step Deployment

### 2.1 Clone Repository & Environment Setup
```bash
git clone https://github.com/Shalltear99/projectvnc.git
cd projectvnc
cp .env.example .env
```

### 2.2 Build Worker Image
```bash
docker build -t cloudjava-worker:latest ./worker-node
```

### 2.3 Launch System Stack via Docker Compose
```bash
docker-compose up -d --build
```

### 2.4 SSL Certificate Setup (Let's Encrypt)
```bash
sudo certbot --nginx -d vnc.yourdomain.com
```