#!/bin/bash

echo "Setting up environment variables for AI Photo Editor..."

# Check if .env.local already exists
if [ -f ".env.local" ]; then
    echo "Warning: .env.local already exists. This will overwrite it."
    read -p "Do you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 1
    fi
fi

# Generate a random secret
SECRET=$(openssl rand -base64 32)

# Create .env.local file
cat > .env.local << EOF
# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$SECRET

# Auth0 OAuth
AUTH0_CLIENT_ID=your-auth0-client-id
AUTH0_CLIENT_SECRET=your-auth0-client-secret
AUTH0_ISSUER=https://your-tenant.us.auth0.com
# AUTH0_AUDIENCE=https://your-api-identifier
EOF

echo "✅ Created .env.local file with generated secret"
echo ""
echo "Next steps:"
echo "1. Go to https://manage.auth0.com/ and create a Regular Web Application"
echo "2. Set Allowed Callback URLs: http://localhost:3000/api/auth/callback/auth0"
echo "3. Set Allowed Logout URLs: http://localhost:3000/"
echo "4. Set Allowed Web Origins: http://localhost:3000"
echo "5. Copy Domain (AUTH0_ISSUER), Client ID, Client Secret into .env.local"
echo "6. (Optional) Add Audience if using custom API"
echo "7. Run 'npm run dev' to start the application"
echo ""
echo "⚠️  IMPORTANT: Never commit .env.local to version control!"
