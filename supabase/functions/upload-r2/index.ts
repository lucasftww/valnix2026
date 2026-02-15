const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: validate Firebase token (admin only)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const idToken = authHeader.replace("Bearer ", "");

    // Verify Firebase token AND check admin email
    const ALLOWED_ADMIN_EMAILS = ["valnix@gmail.com"];

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyAaNn-kRBPAMEMWv0MIaMaF5hy9gerVp9g`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!verifyRes.ok) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verifyData = await verifyRes.json();
    const userEmail = verifyData?.users?.[0]?.email?.toLowerCase();

    if (!userEmail || !ALLOWED_ADMIN_EMAILS.includes(userEmail)) {
      console.warn(`⚠️ Unauthorized upload attempt: ${userEmail}`);
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { fileBase64, fileName, contentType } = await req.json();

    if (!fileBase64 || !fileName) {
      return new Response(
        JSON.stringify({ error: "fileBase64 and fileName are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get R2 credentials
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
    const endpoint = Deno.env.get("R2_ENDPOINT");
    const publicUrl = Deno.env.get("R2_PUBLIC_URL");

    if (!accessKeyId || !secretAccessKey || !endpoint || !publicUrl) {
      console.error("R2 credentials not configured");
      return new Response(
        JSON.stringify({ error: "R2 not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decode base64 to bytes
    const binaryStr = atob(fileBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Build S3 PUT request with AWS Signature V4
    const bucketName = "valnix";
    const region = "auto";
    const service = "s3";
    const method = "PUT";
    const host = endpoint.replace("https://", "");
    const url = `${endpoint}/${bucketName}/${fileName}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    // Create canonical request
    const canonicalUri = `/${bucketName}/${fileName}`;
    const canonicalQuerystring = "";

    const payloadHash = await sha256Hex(bytes);

    const canonicalHeaders =
      `content-type:${contentType || "image/webp"}\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;

    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    // Create string to sign
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      await sha256Hex(new TextEncoder().encode(canonicalRequest)),
    ].join("\n");

    // Calculate signature
    const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signature = await hmacHex(signingKey, stringToSign);

    const authorizationHeader =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // Upload to R2
    const r2Response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType || "image/webp",
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        Authorization: authorizationHeader,
        Host: host,
      },
      body: bytes,
    });

    if (!r2Response.ok) {
      const errorText = await r2Response.text();
      console.error("R2 upload failed:", r2Response.status, errorText);
      return new Response(
        JSON.stringify({ error: `R2 upload failed: ${r2Response.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build public URL
    const fileUrl = `${publicUrl}/${fileName}`;

    console.log(`✅ Uploaded to R2: ${fileName}`);

    return new Response(
      JSON.stringify({ url: fileUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Upload error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ---- AWS Signature V4 helpers ----

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string | Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const encoded = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return crypto.subtle.sign("HMAC", cryptoKey, encoded);
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  const sig = await hmacSha256(key, data);
  return arrayToHex(new Uint8Array(sig));
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return arrayToHex(new Uint8Array(hash));
}

function arrayToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getSignatureKey(
  key: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}
