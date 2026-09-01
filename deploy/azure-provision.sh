#!/bin/bash
# Azure App Service provisioning script for QFundation.
#
# You run this yourself, on your own `az login` session — it creates billed
# Azure resources. Read it first, then run section by section (recommended
# for a first deploy) or as a whole with `bash deploy/azure-provision.sh`.
#
# Prerequisites:
#   - Azure CLI installed and `az login` already done, an Azure subscription
#     with an active `az account set --subscription <...>`.
#   - deploy/azure-provision.env created from deploy/azure-provision.env.example
#     with real secrets filled in. That file is gitignored — NEVER put real
#     secrets directly in this script, it's tracked in git.

set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Resource names — not secret, safe to commit. Edit if you like, but the
#    globally-unique ones (APP_NAME, ACR_NAME, DB_SERVER_NAME, REDIS_NAME)
#    will need changing if these are already taken.
# ---------------------------------------------------------------------------
RESOURCE_GROUP="qfundation-rg"
LOCATION="westeurope"                     # az account list-locations -o table

APP_NAME="qfundation-app"                 # must be globally unique -> https://$APP_NAME.azurewebsites.net
ACR_NAME="qfundationacr"                  # must be globally unique, alnum only
PLAN_NAME="qfundation-plan"

DB_SERVER_NAME="qfundation-db"            # must be globally unique
DB_ADMIN_USER="qfadmin"
DB_NAME="crisis_db"

REDIS_NAME="qfundation-redis"             # must be globally unique

# ---------------------------------------------------------------------------
# 2. Secrets — loaded from a gitignored file, never hardcoded here.
# ---------------------------------------------------------------------------
ENV_FILE="$(dirname "$0")/azure-provision.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy deploy/azure-provision.env.example to" >&2
  echo "deploy/azure-provision.env and fill in real values first." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${DB_ADMIN_PASSWORD:?Set DB_ADMIN_PASSWORD in deploy/azure-provision.env}"
: "${NEXTAUTH_SECRET:?Set NEXTAUTH_SECRET in deploy/azure-provision.env (generate with: openssl rand -base64 32)}"

# Optional (leave empty in azure-provision.env to skip — matches .env.example semantics)
RECAPTCHA_SECRET_KEY="${RECAPTCHA_SECRET_KEY:-}"
NEXT_PUBLIC_RECAPTCHA_SITE_KEY="${NEXT_PUBLIC_RECAPTCHA_SITE_KEY:-}"
SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_SECURE="${SMTP_SECURE:-false}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASSWORD="${SMTP_PASSWORD:-}"
SMTP_FROM="${SMTP_FROM:-QFundation <no-reply@example.com>}"

# ---------------------------------------------------------------------------
# 3. Resource group
# ---------------------------------------------------------------------------
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

# ---------------------------------------------------------------------------
# 4. Container registry + build image (built in Azure, no local Docker needed)
# ---------------------------------------------------------------------------
az acr create --resource-group "$RESOURCE_GROUP" --name "$ACR_NAME" --sku Basic --admin-enabled true

az acr build --registry "$ACR_NAME" --image qfundation:v1 .

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

# ---------------------------------------------------------------------------
# 5. Postgres (Flexible Server) + database + firewall
# ---------------------------------------------------------------------------
az postgres flexible-server create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$DB_SERVER_NAME" \
  --location "$LOCATION" \
  --admin-user "$DB_ADMIN_USER" \
  --admin-password "$DB_ADMIN_PASSWORD" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --yes

az postgres flexible-server db create \
  --resource-group "$RESOURCE_GROUP" \
  --server-name "$DB_SERVER_NAME" \
  --database-name "$DB_NAME"

# Special rule 0.0.0.0-0.0.0.0 = "allow access from Azure services"
az postgres flexible-server firewall-rule create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$DB_SERVER_NAME" \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# ---------------------------------------------------------------------------
# 6. Redis (Basic tier — bump to Standard for production HA later)
# ---------------------------------------------------------------------------
az redis create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$REDIS_NAME" \
  --location "$LOCATION" \
  --sku Basic \
  --vm-size c0

REDIS_KEY=$(az redis list-keys --resource-group "$RESOURCE_GROUP" --name "$REDIS_NAME" --query primaryKey -o tsv)

# ---------------------------------------------------------------------------
# 7. App Service plan (Linux, B1 — minimum tier that supports Always On)
# ---------------------------------------------------------------------------
az appservice plan create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$PLAN_NAME" \
  --is-linux \
  --sku B1

# ---------------------------------------------------------------------------
# 8. Web App for Containers
# ---------------------------------------------------------------------------
az webapp create \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$PLAN_NAME" \
  --name "$APP_NAME" \
  --deployment-container-image-name "$ACR_LOGIN_SERVER/qfundation:v1"

az webapp config container set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_NAME" \
  --docker-custom-image-name "$ACR_LOGIN_SERVER/qfundation:v1" \
  --docker-registry-server-url "https://$ACR_LOGIN_SERVER" \
  --docker-registry-server-user "$ACR_USERNAME" \
  --docker-registry-server-password "$ACR_PASSWORD"
# NOTE: this uses ACR admin credentials for simplicity on the first deploy.
# Follow-up hardening: switch to `az webapp identity assign` + an AcrPull role
# assignment on the ACR, then drop the admin user/password above.

# ---------------------------------------------------------------------------
# 9. App settings (environment variables)
# ---------------------------------------------------------------------------
az webapp config appsettings set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_NAME" \
  --settings \
    DATABASE_URL="postgresql://$DB_ADMIN_USER:$DB_ADMIN_PASSWORD@$DB_SERVER_NAME.postgres.database.azure.com:5432/$DB_NAME?sslmode=require" \
    REDIS_URL="rediss://:$REDIS_KEY@$REDIS_NAME.redis.cache.windows.net:6380" \
    NEXTAUTH_URL="https://$APP_NAME.azurewebsites.net" \
    NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
    WEBSITES_PORT="3000" \
    RECAPTCHA_SECRET_KEY="$RECAPTCHA_SECRET_KEY" \
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY="$NEXT_PUBLIC_RECAPTCHA_SITE_KEY" \
    SMTP_HOST="$SMTP_HOST" \
    SMTP_PORT="$SMTP_PORT" \
    SMTP_SECURE="$SMTP_SECURE" \
    SMTP_USER="$SMTP_USER" \
    SMTP_PASSWORD="$SMTP_PASSWORD" \
    SMTP_FROM="$SMTP_FROM"

# ---------------------------------------------------------------------------
# 10. Always On + keep this at exactly 1 instance
# ---------------------------------------------------------------------------
# The retention-cleanup cron job (instrumentation.ts) runs in-process and is
# NOT safe to run on more than one instance at once. Do not attach an
# autoscale rule to $PLAN_NAME.
az webapp config set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$APP_NAME" \
  --always-on true

echo ""
echo "Deployed. Watch startup + migration logs with:"
echo "  az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME"
echo ""
echo "App URL: https://$APP_NAME.azurewebsites.net"
echo ""
echo "One-time admin seed (run once, then remove ADMIN_EMAIL/ADMIN_PASSWORD"
echo "from app settings again). Set real values in your shell first, e.g.:"
echo "  read -rp 'Admin email: ' SEED_ADMIN_EMAIL"
echo "  read -rsp 'Admin password: ' SEED_ADMIN_PASSWORD; echo"
echo "  az webapp config appsettings set --resource-group $RESOURCE_GROUP --name $APP_NAME \\"
echo "    --settings ADMIN_EMAIL=\"\$SEED_ADMIN_EMAIL\" ADMIN_PASSWORD=\"\$SEED_ADMIN_PASSWORD\""
echo "  az webapp ssh --resource-group $RESOURCE_GROUP --name $APP_NAME"
echo "  # inside the SSH session:"
echo "  npm run prisma:seed"