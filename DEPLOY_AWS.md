# AWS Free Tier Deployment Guide for Data Logger Webserver

This step-by-step guide is designed for **first-time AWS users**. It walks you through setting up a **100% Free Tier** cloud server on Amazon Web Services (AWS EC2) to host your Data Logger Webserver for 1,000+ simultaneous users and ESP32 IoT devices.

---

## 💡 Key AWS Free Tier Rules (Avoid Surprises!)
1. **EC2 Instance**: You get **750 hours/month** of `t2.micro` (or `t3.micro` depending on region) for 12 months. Since 1 month has ~720 hours, **1 server running 24/7 is 100% FREE**.
2. **Storage (EBS)**: Up to **30 GB** of General Purpose SSD (gp3) storage is FREE. Keep disk size at **20 GB** to stay safe.
3. **Elastic IP (Static IP)**: FREE **only while attached** to a running EC2 instance. (Do not leave an Elastic IP unattached, or AWS charges ~$0.005/hr).
4. **Data Transfer**: 100 GB/month out to the internet is free (more than enough for data logger traffic).

---

## 🗺️ High-Level Deployment Architecture

```
[ ESP32 Devices ] --(HTTP Ingest)---+
                                    |
[ User Browsers ] --(HTTPS / HTTP)--+---> [ AWS Elastic IP ]
                                               |
                                        [ Security Group (Firewall) ]
                                        (Port 80 HTTP, Port 22 SSH)
                                               |
                                        [ Nginx Reverse Proxy ]
                                        (Listens on Port 80, routes WebSockets)
                                               |
                                        [ PM2 Process Manager ]
                                        (Runs Express.js App on Port 8080)
                                               |
                                        [ SQLite Database ]
```

---

## 🚀 Step 1: Push Local Code to GitHub

Before creating your cloud server, make sure all your latest code is saved on GitHub:

```bash
git add .
git commit -m "feat: complete RBAC and AWS production prep"
git push origin main
```

---

## ☁️ Step 2: Sign Up for AWS Free Tier

1. Go to **[https://aws.amazon.com/free/](https://aws.amazon.com/free/)**
2. Click **Create an AWS Account**.
3. Complete registration (requires email, password, payment card for ₹2 / $1 temporary verification charge, and phone verification).
4. Select **Basic Support - Free**.
5. Log in to the **AWS Management Console** as the **Root user**.

---

## 🖥️ Step 3: Launch an EC2 Virtual Machine (Server)

1. In the top AWS search bar, type **EC2** and click on **EC2 (Virtual Servers in the Cloud)**.
2. Select your preferred AWS Region in the top right corner (e.g., **ap-south-1 (Mumbai)** or closest to you).
3. Click the orange **Launch instance** button.
4. Fill in the launch form:
   - **Name**: `data-logger-server`
   - **Application and OS Images (AMI)**: Select **Ubuntu** -> **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type** (Make sure it says *Free tier eligible*).
   - **Instance Type**: Select **t2.micro** (or `t3.micro` if t2.micro is unavailable). Must say *Free tier eligible*.
   - **Key Pair (login)**:
     - Click **Create new key pair**.
     - Key pair name: `data-logger-key`
     - Key pair type: `RSA`
     - Private key file format: `.pem` (for Windows PowerShell / SSH)
     - Click **Create key pair** -> A file named `data-logger-key.pem` will download to your PC. **Save this file safely in `C:\Users\YourName\.ssh\` or your project folder!**
   - **Network settings**:
     - Check **Allow SSH traffic from** -> *Anywhere (0.0.0.0/0)*
     - Check **Allow HTTP traffic from the internet**
     - Check **Allow HTTPS traffic from the internet**
   - **Configure Storage**:
     - Default is 8 GB. Change it to **20 GiB** (gp3) (Free tier permits up to 30 GB).
5. Click **Launch Instance** in the right sidebar.
6. Wait 1 minute, then click **View all instances**.

---

## 📌 Step 4: Allocate a Free Static IP (Elastic IP)

By default, an EC2 IP address changes every time the server reboots. An Elastic IP gives you a permanent IP address so your ESP32 devices never lose connection.

1. On the left sidebar in EC2 Console, scroll down to **Network & Security** -> click **Elastic IPs**.
2. Click **Allocate Elastic IP address**.
3. Keep default settings (Amazon's pool of IPv4 addresses) and click **Allocate**.
4. Select the newly created Elastic IP -> click **Actions** -> **Associate Elastic IP address**.
5. Choose:
   - **Resource type**: Instance
   - **Instance**: Choose `data-logger-server`
6. Click **Associate**.
7. Note down your Elastic IP address (e.g., `13.234.xx.xx`).

---

## 🔑 Step 5: Connect to Your AWS Server via SSH

Open **PowerShell** or Command Prompt on your PC and run:

1. Navigate to where you saved `data-logger-key.pem`:
   ```powershell
   cd C:\path\to\your\key\folder
   ```
2. Set file permissions (Windows):
   ```powershell
   icacls .\data-logger-key.pem /inheritance:r
   icacls .\data-logger-key.pem /grant:r "$($env:USERNAME):R"
   ```
3. SSH into your AWS server (replace `YOUR_ELASTIC_IP` with your actual IP):
   ```bash
   ssh -i data-logger-key.pem ubuntu@YOUR_ELASTIC_IP
   ```
4. Type `yes` when asked to confirm fingerprint connection.
5. You are now logged into your Ubuntu AWS server terminal!

---

## 🛠️ Step 6: Install Node.js, Git, PM2 & Tools on Server

Inside your AWS SSH terminal, copy and run these commands one by one:

```bash
# 1. Update system packages
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20 LTS & build essentials (required for SQLite native build)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential git nginx

# 3. Verify Node.js version
node -v # Should show v20.x.x
npm -v  # Should show 10.x.x

# 4. Install PM2 (Process Manager to run your server 24/7)
sudo npm install -g pm2
```

---

## 📦 Step 7: Clone and Build Your App on AWS

Still inside SSH terminal:

```bash
# 1. Clone your repository from GitHub
git clone https://github.com/prathamkatariya7/data-logger.git
cd data-logger

# 2. Install backend dependencies (compiles native SQLite)
npm install --production

# 3. Build frontend static assets
npm run build:frontend

# 4. Create environment file (.env)
cat << 'EOF' > .env
PORT=8080
JWT_SECRET=super_secret_aws_jwt_key_2026_change_me
ADMIN_USER=admin
ADMIN_PASSWORD=admin123
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=admin123
DEVICE_KEY=esp32-secret-key-123
EOF
```

> ⚠️ *Important*: Change `JWT_SECRET`, `ADMIN_PASSWORD`, and `DEVICE_KEY` to secure values.

---

## 🔄 Step 8: Start App with PM2 (24/7 Auto-Restart)

```bash
# 1. Start Express app on port 8080 with PM2
pm2 start server.js --name "data-logger"

# 2. Save PM2 state so it restarts automatically on server reboot
pm2 save

# 3. Configure PM2 to start on system startup
pm2 startup
# (Copy and run the command printed by 'pm2 startup')
```

Check status anytime with:
```bash
pm2 status
pm2 logs data-logger
```

---

## 🌐 Step 9: Configure Nginx Reverse Proxy (Port 80 → Port 8080 + WebSockets)

Nginx receives HTTP requests on standard port 80 and passes them to Node.js on port 8080, handling WebSockets seamlessly.

1. Create Nginx config file:
   ```bash
   sudo nano /etc/nginx/sites-available/data-logger
   ```
2. Paste the following configuration:
   ```nginx
   server {
       listen 80 default_server;
       listen [::]:80 default_server;

       server_name _;

       client_max_body_size 20M;

       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
3. Save and close (`Ctrl + O`, `Enter`, `Ctrl + X`).
4. Enable the site & restart Nginx:
   ```bash
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo ln -s /etc/nginx/sites-available/data-logger /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

---

## ⚡ Step 10: Test Your Dashboard Live in Browser

Open your PC browser and go to:
```
http://YOUR_ELASTIC_IP
```
- You should see the **Data Logger Webserver Login Screen**!
- Log in with `admin` / `admin123` (or your customized password).
- Real-time WebSockets, RBAC user management, logs, and channel settings are active!

---

## 📡 Step 11: Update ESP32 Firmware to Send Data to AWS

In your ESP32 Arduino sketch `DataLogger_ESP32_WebServer.ino`:

1. Update `serverUrl`:
   ```cpp
   const char* serverUrl = "http://YOUR_ELASTIC_IP/api/ingest";
   ```
2. Match `deviceKey`:
   ```cpp
   const char* deviceKey = "esp32-secret-key-123"; // Must match .env DEVICE_KEY
   ```
3. Upload sketch to your ESP32.
4. Monitor Serial Monitor — ESP32 will connect and log readings directly to AWS!

---

## 🔒 Step 12: Add Domain Name & Free SSL Certificate (Optional / Recommended)

To enable HTTPS (`https://yourdomain.com`):

1. Purchase a cheap domain (or use a free DNS like DuckDNS / Cloudflare).
2. Point A record to `YOUR_ELASTIC_IP`.
3. Install Let's Encrypt Certbot on AWS:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com
   ```
4. Certbot will automatically issue a 100% free SSL certificate and update Nginx!

---

## 🛠️ Maintenance Cheat Sheet

| Action | Command (Run on AWS Server) |
|---|---|
| View App Status | `pm2 status` |
| View Live Logs | `pm2 logs data-logger` |
| Restart Server App | `pm2 restart data-logger` |
| Update App Code | `cd ~/data-logger && git pull && npm run build:frontend && pm2 restart data-logger` |
| View Nginx Logs | `sudo tail -f /var/log/nginx/error.log` |
| Backup Database | `cp ~/data-logger/data/datalogger.db ~/datalogger_backup.db` |

---

🎉 **Congratulations!** Your Data Logger Webserver is now running live on AWS EC2 Free Tier, built to handle 1,000+ simultaneous connections with low latency!
