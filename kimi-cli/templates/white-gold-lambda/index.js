const { InvokeCommand, LambdaClient } = require("@aws-sdk/client-lambda");
const { defaultProvider } = require("@aws-sdk/credential-provider-node");
const { spawn } = require("node:child_process");
const path = require("node:path");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headerValue(headers, name) {
  if (!headers) return null;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return String(value ?? "");
  }
  return null;
}

function bearerToken(headers) {
  const authorization = headerValue(headers, "authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null;
}

function parseBody(event) {
  if (event?.payload && typeof event.payload === "object") return event.payload;
  if (typeof event?.body === "string") return JSON.parse(event.body || "{}");
  return event?.body && typeof event.body === "object" ? event.body : {};
}

function isAuthorized(event) {
  const secret =
    process.env.WHITE_GOLD_BUILD_WEBHOOK_SECRET?.trim() ||
    process.env.DIAMOND_BUILD_WEBHOOK_SECRET?.trim();
  if (!secret) return true;
  return (
    bearerToken(event.headers) === secret ||
    headerValue(event.headers, "x-white-gold-build-secret") === secret ||
    headerValue(event.headers, "x-diamond-build-secret") === secret
  );
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function selfInvoke(payload) {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("AWS_LAMBDA_FUNCTION_NAME is not available");
  }

  const client = new LambdaClient({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION });
  await client.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: Buffer.from(JSON.stringify({
      whiteGoldAsync: true,
      payload,
    })),
  }));
}

async function runWhiteGoldBuild(payload) {
  const campaignId = String(payload.campaignId || payload.campaign_id || "");
  if (!UUID_PATTERN.test(campaignId)) {
    throw new Error("Valid campaignId is required");
  }

  const scriptPath = path.join(__dirname, "scripts", "build-white-gold-pmtiles.ts");
  const args = [scriptPath, campaignId];
  if (payload.dryRun === true) args.push("--dry-run");
  if (payload.keepWorkdir === true) args.push("--keep-workdir");
  if (payload.minzoom) args.push(`--minzoom=${payload.minzoom}`);
  if (payload.maxzoom) args.push(`--maxzoom=${payload.maxzoom}`);
  if (payload.forceOverwriteDiamond === true) args.push("--force-overwrite-diamond");

  console.log("[WhiteGoldBuild] Starting PMTiles build", {
    campaignId,
    reason: payload.reason ?? null,
    source: payload.source ?? null,
    addressCount: payload.addressCount ?? null,
    buildingCount: payload.buildingCount ?? null,
  });

  const credentials = process.env.S3_UPLOAD_ACCESS_KEY_ID && process.env.S3_UPLOAD_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.S3_UPLOAD_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_UPLOAD_SECRET_ACCESS_KEY,
        sessionToken: process.env.S3_UPLOAD_SESSION_TOKEN || "",
      }
    : await defaultProvider()();
  const awsCredentialEnv = {
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_SESSION_TOKEN: credentials.sessionToken || "",
  };

  await new Promise((resolve, reject) => {
    const child = spawn(
      path.join(__dirname, "node_modules", ".bin", "tsx"),
      args,
      {
        cwd: __dirname,
        env: {
          ...process.env,
          ...awsCredentialEnv,
          HOME: "/tmp",
          XDG_CACHE_HOME: "/tmp",
          XDG_CONFIG_HOME: "/tmp",
          TIPPECANOE_BIN: process.env.TIPPECANOE_BIN || "/usr/local/bin/tippecanoe",
          OVERTUREMAPS_BIN: process.env.OVERTUREMAPS_BIN || "/usr/local/bin/overturemaps",
          PATH: `${process.env.PATH || ""}:/usr/local/bin`,
        },
      }
    );

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`White Gold build exited with code ${code}`));
    });
  });

  console.log("[WhiteGoldBuild] PMTiles build completed", { campaignId });
  return { campaign_id: campaignId, built: true };
}

exports.handler = async (event) => {
  try {
    if (event?.whiteGoldAsync === true) {
      const result = await runWhiteGoldBuild(parseBody(event));
      return json(200, { success: true, ...result });
    }

    if (!isAuthorized(event)) {
      return json(401, { error: "Unauthorized" });
    }

    const payload = parseBody(event);
    const campaignId = String(payload.campaignId || payload.campaign_id || "");
    if (!UUID_PATTERN.test(campaignId)) {
      return json(400, { error: "Valid campaignId is required" });
    }

    await selfInvoke({
      ...payload,
      campaignId,
      requestedAt: new Date().toISOString(),
    });

    return json(202, {
      success: true,
      queued: true,
      campaign_id: campaignId,
      worker: process.env.AWS_LAMBDA_FUNCTION_NAME ?? null,
    });
  } catch (error) {
    console.error("[WhiteGoldBuild] Request failed", error);
    return json(500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
