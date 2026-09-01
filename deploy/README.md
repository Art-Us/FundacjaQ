# Deploying to Azure App Service

## Before you run anything

- **This creates billed Azure resources.** Read `azure-provision.sh` fully first.
- **Secrets go in a separate, gitignored file — never in the script.** Copy `deploy/azure-provision.env.example` to `deploy/azure-provision.env` and fill in a real DB password and `NEXTAUTH_SECRET` (`openssl rand -base64 32`). `azure-provision.sh` refuses to run without it. The resource *names* at the top of the script (app name, ACR name, etc.) aren't secret and are fine to edit in place — just make sure the globally-unique ones aren't already taken.
- Prerequisites: [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed, then `az login` and `az account set --subscription <your-subscription>`.
- **Always On + exactly 1 instance, permanently.** The retention-cleanup job (`instrumentation.ts`) runs in-process via `node-cron` and is only safe on a single warm instance. Never attach an autoscale rule to the App Service plan this script creates, and never drop below Basic (B1) tier (Free/Shared don't support Always On).

## Running it

Section by section is safer for a first deploy — copy/paste each numbered block from `azure-provision.sh` into your shell so you can check each step's output. Or run the whole thing:

```bash
bash deploy/azure-provision.sh
```

It provisions, in order: resource group → Azure Container Registry (and builds the image from the repo's `Dockerfile` directly in Azure — no local Docker needed) → Postgres Flexible Server + database → Azure Cache for Redis → App Service plan → the Web App, wired to the built container image and all required app settings.

## After the first deploy

1. Tail logs to confirm `prisma migrate deploy` applied cleanly and the server started:
   ```bash
   az webapp log tail --resource-group qfundation-rg --name qfundation-app
   ```
2. Visit `https://<app-name>.azurewebsites.net`.
3. Seed the admin account once (commands printed at the end of the script), then remove `ADMIN_EMAIL`/`ADMIN_PASSWORD` from the app settings again.

## Redeploying after a code change

```bash
az acr build --registry <acr-name> --image qfundation:v2 .
az webapp config container set --resource-group qfundation-rg --name qfundation-app \
  --docker-custom-image-name <acr-login-server>/qfundation:v2
```

## Known follow-ups (not done by this script)

- ACR auth uses admin username/password for simplicity — switch to `az webapp identity assign` + an `AcrPull` role assignment when you have time.
- No CI/CD yet — every deploy above is manual.
- Postgres and Redis are on public endpoints with SSL/firewall rules, not VNET-private — fine to start, revisit if this needs to be locked down further.
- The `X-Forwarded-For` client-IP trust issue tracked separately in this project is still open. Once this deployment is live, revisit it: Azure App Service's front-end appends exactly one trusted hop to `X-Forwarded-For`, so the fix is to read the *last* entry instead of the first.
