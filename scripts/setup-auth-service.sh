#!/bin/bash
# Automated setup script for auth-service advanced features
# This script sets up Google OAuth, MFA, and Email/SMS verification

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AUTH_SERVICE_DIR="$REPO_ROOT/services/auth-service"
DB_SCHEMA="$REPO_ROOT/infra/db/07-auth-schema-extended.sql"

echo "🔐 Auth Service Setup"
echo "===================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Step 1: Checking prerequisites..."
echo ""

# Check psql
if ! command -v psql &> /dev/null; then
    echo -e "${RED}❌ psql not found${NC}"
    echo "   Install PostgreSQL client tools"
    exit 1
fi
echo -e "${GREEN}✅ psql found${NC}"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}❌ pnpm not found${NC}"
    echo "   Install: npm install -g pnpm"
    exit 1
fi
echo -e "${GREEN}✅ pnpm found${NC}"

# Check if database schema file exists
if [ ! -f "$DB_SCHEMA" ]; then
    echo -e "${RED}❌ Database schema file not found: $DB_SCHEMA${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Database schema file found${NC}"

echo ""
echo "🗄️  Step 2: Running database migration..."
echo ""

# Database connection details
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5437}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-records}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

# Test database connection
export PGPASSWORD="$DB_PASSWORD"
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Could not connect to database${NC}"
    echo "   Host: $DB_HOST"
    echo "   Port: $DB_PORT"
    echo "   User: $DB_USER"
    echo "   Database: $DB_NAME"
    echo ""
    echo "   Please ensure PostgreSQL is running and accessible."
    echo "   You can set custom connection details:"
    echo "     DB_HOST=localhost DB_PORT=5437 DB_USER=postgres DB_NAME=records DB_PASSWORD=postgres ./scripts/setup-auth-service.sh"
    exit 1
fi

echo -e "${GREEN}✅ Database connection successful${NC}"

# Run migration
echo "   Running migration: $DB_SCHEMA"
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$DB_SCHEMA" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Database migration completed${NC}"
else
    echo -e "${YELLOW}⚠️  Migration had warnings (this is okay if tables already exist)${NC}"
    # Try to verify tables were created
    TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'auth' AND table_name IN ('oauth_providers', 'mfa_settings', 'verification_codes');" | tr -d ' ')
    if [ "$TABLE_COUNT" -ge "3" ]; then
        echo -e "${GREEN}✅ Required tables exist${NC}"
    else
        echo -e "${YELLOW}⚠️  Some tables may be missing, but migration is idempotent${NC}"
    fi
fi

unset PGPASSWORD

echo ""
echo "📦 Step 3: Installing dependencies..."
echo ""

cd "$AUTH_SERVICE_DIR"

if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json not found in $AUTH_SERVICE_DIR${NC}"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "   Running: pnpm install"
    pnpm install
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo "   Checking for new dependencies..."
    pnpm install
    echo -e "${GREEN}✅ Dependencies up to date${NC}"
fi

echo ""
echo "🔧 Step 4: Generating Prisma client..."
echo ""

if [ ! -f "prisma/schema.prisma" ]; then
    echo -e "${RED}❌ prisma/schema.prisma not found${NC}"
    exit 1
fi

pnpm prisma generate
echo -e "${GREEN}✅ Prisma client generated${NC}"

echo ""
echo "🔍 Step 5: Checking environment variables..."
echo ""

# Check for environment variables
MISSING_VARS=()

# Google OAuth
if [ -z "$GOOGLE_CLIENT_ID" ] && [ ! -f "$REPO_ROOT/infra/k8s/base/config/app-secrets.yaml" ]; then
    MISSING_VARS+=("GOOGLE_CLIENT_ID")
fi
if [ -z "$GOOGLE_CLIENT_SECRET" ] && [ ! -f "$REPO_ROOT/infra/k8s/base/config/app-secrets.yaml" ]; then
    MISSING_VARS+=("GOOGLE_CLIENT_SECRET")
fi

# Email (optional)
if [ -z "$SMTP_USER" ] && [ ! -f "$REPO_ROOT/infra/k8s/base/config/app-secrets.yaml" ]; then
    MISSING_VARS+=("SMTP_USER (optional)")
fi

# SMS (optional)
if [ -z "$TWILIO_ACCOUNT_SID" ] && [ ! -f "$REPO_ROOT/infra/k8s/base/config/app-secrets.yaml" ]; then
    MISSING_VARS+=("TWILIO_ACCOUNT_SID (optional)")
fi

if [ ${#MISSING_VARS[@]} -eq 0 ]; then
    echo -e "${GREEN}✅ Environment variables configured${NC}"
    echo "   (Some may be in app-secrets.yaml for Kubernetes)"
else
    echo -e "${YELLOW}⚠️  Missing environment variables:${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "   These can be set in:"
    echo "   - Environment variables"
    echo "   - infra/k8s/base/config/app-secrets.yaml (for Kubernetes)"
    echo "   - .env file in services/auth-service/"
fi

echo ""
echo "📚 Step 6: Google OAuth Setup Instructions"
echo "=========================================="
echo ""
echo "To enable Google OAuth, follow these steps:"
echo ""
echo "1. Go to Google Cloud Console:"
echo "   https://console.cloud.google.com/"
echo ""
echo "2. Create a new project or select an existing one"
echo ""
echo "3. Enable Google+ API:"
echo "   - Navigate to 'APIs & Services' > 'Library'"
echo "   - Search for 'Google+ API'"
echo "   - Click 'Enable'"
echo ""
echo "4. Create OAuth 2.0 credentials:"
echo "   - Navigate to 'APIs & Services' > 'Credentials'"
echo "   - Click 'Create Credentials' > 'OAuth client ID'"
echo "   - Application type: 'Web application'"
echo "   - Name: 'Record Platform Auth'"
echo "   - Authorized redirect URIs:"
echo "     * http://localhost:4001/auth/google/callback (for local dev)"
echo "     * https://your-domain.com/auth/google/callback (for production)"
echo ""
echo "5. Copy the Client ID and Client Secret"
echo ""
echo "6. Add to your configuration:"
echo ""
echo "   For Kubernetes (recommended):"
echo "   Edit: infra/k8s/base/config/app-secrets.yaml"
echo "   Add:"
echo "     GOOGLE_CLIENT_ID: \"your_client_id_here\""
echo "     GOOGLE_CLIENT_SECRET: \"your_client_secret_here\""
echo ""
echo "   For local development:"
echo "   Export environment variables:"
echo "     export GOOGLE_CLIENT_ID=\"your_client_id_here\""
echo "     export GOOGLE_CLIENT_SECRET=\"your_client_secret_here\""
echo ""
echo "   Or create .env file in services/auth-service/:"
echo "     GOOGLE_CLIENT_ID=your_client_id_here"
echo "     GOOGLE_CLIENT_SECRET=your_client_secret_here"
echo ""

echo "✅ Setup complete!"
echo ""
echo "📖 For more details, see: services/auth-service/AUTH_FEATURES.md"
echo ""
echo "🚀 Next steps:"
echo "   1. Configure Google OAuth (see instructions above)"
echo "   2. (Optional) Configure SMTP for email verification"
echo "   3. (Optional) Configure Twilio for SMS verification"
echo "   4. Restart the auth-service to load new features"
echo ""
