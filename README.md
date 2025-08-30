# AI Photo Editor

An AI-powered photo editing application that allows users to edit photos using natural language descriptions.

## Features

- **Google OAuth Authentication**: Secure sign-in with Google accounts
- **AI Photo Editing**: Edit photos using natural language prompts
- **Multiple Image Support**: Upload and process multiple images at once
- **Credit System**: Pay-per-use credit system for AI operations
- **Responsive Design**: Modern UI that works on all devices

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or pnpm
- Google OAuth credentials

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd ai-photo-editor
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy `env.example` to `.env.local`
   - Fill in your Google OAuth credentials

### Google OAuth Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to "Credentials" and create an "OAuth 2.0 Client ID"
5. Set the authorized redirect URI to: `http://localhost:3000/api/auth/callback/google`
6. Copy the Client ID and Client Secret to your `.env.local` file

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-here-change-in-production

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### Running the Application

1. Start the development server:
```bash
npm run dev
```

2. Open [http://localhost:3000](http://localhost:3000) in your browser
3. Sign in with your Google account
4. Start editing photos!

## Usage

1. **Sign In**: Use your Google account to authenticate
2. **Upload Images**: Drag and drop or select multiple images
3. **Describe Edit**: Write a natural language description of what you want
4. **Generate**: Click generate to create your AI-edited image
5. **Download**: Save your edited image

## API Routes

- `/api/auth/[...nextauth]` - NextAuth.js authentication endpoints
- `/api/edit-image` - AI image editing endpoint (protected)
- `/api/create-payment-intent` - Payment processing (protected)

## Technologies Used

- **Next.js 15** - React framework
- **NextAuth.js** - Authentication
- **Google OAuth** - Google sign-in
- **Tailwind CSS** - Styling
- **Radix UI** - UI components
- **Google Gemini AI** - Image processing

## Security Features

- Protected API routes with authentication middleware
- Secure session management
- OAuth 2.0 authentication flow
- Environment variable protection

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License.
