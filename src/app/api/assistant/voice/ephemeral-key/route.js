import { NextResponse } from "next/server";

/**
 * Ephemeral Key Endpoint
 * 
 * Generates a short-lived token from Luna backend for secure WebRTC connections.
 */
export async function POST() {
  const backendUrl = process.env.BACKEND_URL?.replace(/\/$/, "");
  const authKey = process.env.AUTH_KEY;

  
  if (!backendUrl) {
    
    if (!authKey) {
      return NextResponse.json(
        { error: "AUTH_KEY environment variable is required for local backend" },
        { status: 500 }
      );
    }
    
    
    return NextResponse.json({
      token: authKey, 
    });
  }


  if (!authKey) {
    return NextResponse.json(
      { error: "AUTH_KEY environment variable is not set" },
      { status: 500 }
    );
  }

  const targetUrl = `${backendUrl}/api/ephemeral-key`;

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Luna-Key": `Bearer ${authKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to generate ephemeral key", details: error.message },
      { status: 502 }
    );
  }
}

