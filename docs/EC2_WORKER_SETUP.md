# EC2 Background Worker Setup

Use EC2 as a dedicated background worker for Syncore. The Vercel app stays responsible for the web UI and API routes; EC2 continuously drains queued lead jobs and provider jobs.

The worker runs:

```bash
npm run worker:background -- --loop 60000
```

That means it checks for queued work every 60 seconds. You set this up once. After that, `systemd` keeps it running and restarts it after crashes or server reboot.

## AWS Console Steps

1. Open AWS Console > EC2 > Launch instance.
2. Region: `us-east-1` / N. Virginia.
3. Name: `syncore-background-worker`.
4. AMI: Amazon Linux 2023.
5. Instance type: start with `t3.micro` or `t3.small`.
6. Key pair: create or select one you can SSH with.
7. Network settings:
   - Inbound SSH `22`: your current IP only.
   - Do not open HTTP/HTTPS inbound for this worker.
   - Outbound: allow default outbound traffic.
8. Storage: 20 GB gp3 is enough to start.
9. Launch instance.

## Server Setup

SSH into the instance:

```bash
ssh -i path/to/key.pem ec2-user@YOUR_EC2_PUBLIC_IP
```

Install system packages and Node.js:

```bash
sudo dnf update -y
sudo dnf install -y git
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
node --version
npm --version
```

Clone the repo:

```bash
sudo mkdir -p /opt/syncore
sudo chown ec2-user:ec2-user /opt/syncore
git clone YOUR_GIT_REPO_URL /opt/syncore/lead-engine-crm
cd /opt/syncore/lead-engine-crm
```

Install the worker service:

```bash
sudo bash deploy/ec2/install-worker.sh
```

Edit the worker environment file:

```bash
sudo nano /etc/syncore/worker.env
```

Use the same production values as Vercel for:

- `DATABASE_URL`
- `SYNCORE_AUTH_SECRET`
- `SYNCORE_CREDENTIAL_ENCRYPTION_KEY`
- `SYNCORE_CREDENTIAL_KEY_ID`
- `SYNCORE_APP_URL`
- `SYNCORE_ENABLE_LIVE_PROVIDERS`
- provider keys if live provider execution is enabled

Start the worker:

```bash
sudo systemctl start syncore-worker
sudo systemctl status syncore-worker
```

Watch logs:

```bash
sudo journalctl -u syncore-worker -f
```

## Updating The Worker

After pushing new code:

```bash
cd /opt/syncore/lead-engine-crm
git pull --ff-only
sudo npm ci
sudo systemctl restart syncore-worker
sudo systemctl status syncore-worker
```

## Health Checks

Check whether queued work is draining:

```bash
sudo journalctl -u syncore-worker --since "15 minutes ago"
```

You should see lines like:

```txt
provider-mock=0/0 provider-live=0 lead-jobs=1/1 failed=0
```

If CSV uploads stay queued, check:

1. `sudo systemctl status syncore-worker`
2. `sudo journalctl -u syncore-worker -n 100`
3. `/etc/syncore/worker.env` has the production `DATABASE_URL`
4. The EC2 security group allows outbound internet access
5. Neon allows the connection from EC2

## Cost Notes

Start with `t3.micro` or `t3.small`. Move up only if imports, enrichment, or provider jobs become CPU bound.

The worker should be in `us-east-1` because your database is already in AWS US East 1. This keeps database latency low.
