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

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
EOF

echo "✅ Created .env.local file with generated secret"
echo ""
echo "Next steps:"
echo "1. Go to https://console.cloud.google.com/"
echo "2. Create a new project or select existing one"
echo "3. Enable Google+ API"
echo "4. Go to Credentials → Create OAuth 2.0 Client ID"
echo "5. Set authorized redirect URI to: http://localhost:3000/api/auth/callback/google"
echo "6. Copy Client ID and Client Secret to .env.local"
echo "7. Run 'npm run dev' to start the application"
echo ""
echo "⚠️  IMPORTANT: Never commit .env.local to version control!"
