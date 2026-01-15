# Voice Bot - upGrad School of Technology

A real-time voice chat application powered by WebRTC and LUNA AI, featuring RAG (Retrieval Augmented Generation) with Qdrant vector database for intelligent context-aware responses.

## Features

- 🎤 Real-time voice conversation using WebRTC
- 🤖 AI-powered responses with Indian English accent
- 🔍 RAG-based context retrieval from Qdrant vector database
- ⚡ Local embeddings for fast query processing
- 💬 Dynamic context enrichment based on user questions
- 🎨 Theme customization support

## Prerequisites

- Node.js 18+ and npm
- Qdrant vector database (local or remote)
- LUNA AI API key (for voice AI backend)

## Installation

1. **Clone the repository** (if applicable) or navigate to the project directory:
   ```bash
   cd voice-bot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env.local` file in the root directory with the following variables:
   ```env
   # Qdrant Configuration
   QDRANT_URL=http://localhost:6333
   QDRANT_API_KEY=your_qdrant_api_key_optional
   QDRANT_COLLECTION_NAME=document_chunks

   # LUNA AI Configuration
   PIXA_API_KEY=your_luna_ai_api_key

   # Optional: Backend URL (if using external backend)
   BACKEND_URL=https://your-backend-url.com
   AUTH_KEY=your_auth_key
   ```

## Running the Application

### Development Mode

```bash
npm run dev
```

The application will start on `http://localhost:3000`

### Production Build

```bash
npm run build
npm start
```

## Usage

1. **Open the application** in your browser at `http://localhost:3000`

2. **Click the microphone button** (bottom-right corner) to open the voice chat window

3. **Allow microphone access** when prompted by your browser

4. **Start speaking** - The AI will:
   - Transcribe your speech
   - Search Qdrant for relevant context
   - Generate contextual responses with Indian English accent
   - Speak the response back to you

## Project Structure

```
voice-bot/
├── src/
│   ├── app/
│   │   └── api/
│   │       └── assistant/
│   │           └── voice/
│   │               ├── offer/          # WebRTC SDP offer/answer exchange
│   │               ├── ice-server/      # ICE servers for WebRTC
│   │               ├── rag-context/     # RAG context retrieval endpoint
│   │               └── save/            # Conversation saving
│   ├── components/
│   │   ├── VoiceChat.jsx               # Main WebRTC voice chat component
│   │   ├── voiceChatWindows.tsx        # Voice chat UI window
│   │   └── VoiceChatWrapper.jsx        # Floating microphone button
│   ├── lib/
│   │   ├── clients/
│   │   │   ├── qdrant.js              # Qdrant client configuration
│   │   │   ├── localEmbedding.js      # Local embedding generation
│   │   │   └── smartEmbedding.js      # Smart embedding with fallback
│   │   ├── rag/
│   │   │   ├── retrieve.js             # RAG retrieval wrapper
│   │   │   └── qdrant-retrieve.js      # Qdrant vector search implementation
│   │   └── webrtc/
│   │       ├── connection.js          # WebRTC connection utilities
│   │       └── events.js               # WebRTC event handlers
│   └── pages/
│       ├── index.js                   # Home page
│       └── _app.js                     # Next.js app wrapper
└── package.json
```

## Key Technologies

- **Next.js 16** - React framework
- **WebRTC** - Real-time voice communication
- **LUNA AI** - Voice AI backend (upgrad.heypixa.ai)
- **Qdrant** - Vector database for RAG
- **@xenova/transformers** - Local embedding generation
- **next-themes** - Theme management

## Configuration

### Qdrant Setup

1. **Install Qdrant** (if running locally):
   ```bash
   docker run -p 6333:6333 qdrant/qdrant
   ```

2. **Or use Qdrant Cloud**: Set `QDRANT_URL` to your cloud instance URL

3. **Collection Setup**: The collection will be created automatically on first use with:
   - Named vector: `content` (1536 dimensions)
   - Distance metric: Cosine similarity

### LUNA AI Setup

1. Get your API key from [LUNA AI](https://heypixa.ai)
2. Add it to `.env.local` as `PIXA_API_KEY`

## Performance Optimizations

The application includes several performance optimizations:

- ✅ **Model warmup** - Embedding model pre-loaded on server startup
- ✅ **Static imports** - No dynamic imports for faster execution
- ✅ **Reduced logging** - Verbose logs only in development mode
- ✅ **Optimized timeouts** - Fast-fail timeouts for better UX
- ✅ **Cached collection info** - Qdrant collection info cached to avoid repeated checks

## Troubleshooting

### Microphone not working
- Check browser permissions for microphone access
- Ensure you're using HTTPS (or localhost) - required for WebRTC

### Connection issues
- Verify `PIXA_API_KEY` is set correctly
- Check network connectivity to LUNA AI backend
- Verify ICE servers are accessible

### Qdrant connection errors
- Ensure Qdrant is running and accessible at `QDRANT_URL`
- Check `QDRANT_API_KEY` if using authenticated Qdrant instance
- Verify collection exists or will be created automatically

### Slow RAG retrieval
- Check Qdrant server performance
- Verify network latency to Qdrant instance
- Consider using a local Qdrant instance for better performance

## Fixes memo

### Issues Fixed

**What was wrong earlier:**

| Problem | Impact |
|---------|--------|
| Huge system prompt sent with every message | Inefficient, slow responses |
| 3-4 duplicate/useless system prompts scattered in code | Confusion, inconsistency |
| Greeting logic calling `session.update` | Was overwriting the original instructions |
| Irrelevant RAG chunks being sent | Low-similarity context confusing the AI |

**Fixes Applied:**

| Fix | Details |
|-----|---------|
| Single source of instruction | `ISHU_VOICE_PROMPT` in `ishu-voice-prompt.js` - hardcoded in offer route |
| Removed useless prompts | Cleaned up duplicate prompts from codebase |
| Removed `session.update` greeting | Greeting trigger kept, but no instruction override |
| Similarity threshold | Only send RAG context if similarity >= 0.25 |

**Key Files Changed:**
- `src/app/api/assistant/voice/offer/route.js` - System prompt + session config
- `src/lib/prompts/ishu-voice-prompt.js` - Single source of instructions
- `src/app/api/assistant/voice/rag-context/route.js` - Similarity threshold
- `src/components/VoiceChat.jsx` - Removed `session.update`, cleaned up context format

**Architecture (After Fix):**
- System prompt: Sent **once** at session creation
- RAG context: Sent **per-message** only when relevant (similarity >= 0.25)

---

## Development

### Running in Development Mode

```bash
npm run dev
```

The app will automatically reload on file changes.

### Building for Production

```bash
npm run build
npm start
```

## License

[Add your license information here]

## Support

For issues or questions, please [create an issue](link-to-issues) or contact the development team.
