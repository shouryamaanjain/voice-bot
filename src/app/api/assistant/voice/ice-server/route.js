import { NextResponse } from "next/server";

/**
 * ICE Servers Endpoint
 * 
 * Fetches STUN/TURN servers from Luna backend for WebRTC connection establishment.
 * 
 * What are ICE servers?
 * - STUN servers help discover your public IP address
 * - TURN servers relay traffic when direct connection isn't possible
 * - Required for WebRTC to work across different network configurations
 * 
 * This endpoint proxies the request to keep backend URL server-side only.
 */
export async function GET() {
  // If BACKEND_URL is not set, assume local backend (same Next.js app)
  // In that case, we can return default ICE servers or call local implementation
  const backendUrl = process.env.BACKEND_URL?.replace(/\/$/, "");
  
  // If no backend URL, use default ICE servers with TURN servers for NAT traversal
  if (!backendUrl) {
    const defaultIceServers = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // Add public TURN servers for NAT traversal (for testing)
        // In production, use TURN servers from LUNA API or your own TURN server
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    };

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");

    return NextResponse.json(defaultIceServers, { headers });
  }

  // If BACKEND_URL is set, proxy to external LUNA backend
  const targetUrl = `${backendUrl}/api/ice-servers`;

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: errorText },
        { status: response.status }
      );
    }

    const iceServers = await response.json();

    // Set CORS headers
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");

    return NextResponse.json(iceServers, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to connect to backend", details: error.message },
      { status: 502 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

