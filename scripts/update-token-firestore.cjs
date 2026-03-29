const https = require('https');
const crypto = require('crypto');

    const sa = {
      "type": "service_account",
      "project_id": "valnix",
      "private_key_id": "833d0637ade3ef585a6b394f70ee7d406f8e3693",
      "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDhaY9BIym3n5tx\nEV2d/x2lPhtU4YqpL2i9Tdvnx9YlD1+CedFUrDeUn/Oa1Q9wVDfCKbMy50k7w1j6\nIVP95a4zidGs3qOZ42YOLSVOkcrRHomKBotBTwS4OmpR+BLWn8FgXFjBjbHoo+Y/\nWFVRNF7G8L3ZGxr/BZi7R5i767LN/SjvllN/HtZokEaQ402JQ6qU4aeecA56iDkZ\nIH+iD2fhyogJdFo6g3vv1nsn1b1Br1znGmn9vZI/0D8+FoDhfc863l3hvUI31ej2\nd6OBq4DZ3MfCPQo4CQwRInd8X33HwtHwCA9dybvCku9A7Olv9xKUF2BUJ7Kko+CJ\naSwsclXPAgMBAAECggEAUGI/duAeQWBGo3So6O4QWVwjjQp9U0YX2OJKGIbYJBEu\nYy4j60ka7QJ5ce6m+czesXwDbpSyNgC82z5FYJamn7R3NGmU+Azy2P1af4FYTWjR\nbYpV4K1YJoaWYbLQrP79i+qCsEtidW71bgOHMVU2s0UovqJ+5xDM3YRzwBgWhIQm\n1Argij7BCNsW37QwM/eLstyPmarRi/vcxnu8xOInug9RGi5QyJPIBTYhQBhUFQQq\nV5UCwXrJCa0eYWXTW/NX+9Z/eE0Y3yKDBJksM+TSOxnWCPsbEYUc/BRT+ozCU/eU\njDqD7iKE3X+N63+r+3IT9U1Lg3sXDdtwDfEz7H0BWQKBgQD1thY1V2gUB5f5KAvg\n4fyfbOc2LjeJyVvzalzMjGEJlijimGGX0Fnn5jyehhCm9jW370CPlpp8nVvXeoL3\naM6G/rUyI21BpMkoSDClYzr5rpGP5g8qxMhFXONMRiCBMZC3lBU9PVIo8M1jgYCn\nZoZU2hQ859tK1T7Fiyo/F0CpwwKBgQDq2eCixVL6gpMdWMWMhvHe9A4AXw06DjAK\n/RxpQrZ6d1NQcjU4Zg89KdYUmmRD1jOfx2NDoVFChJqiHq/0JDZw7+gRw2kmcGCD\np/+szC06EQl2HLpjEEXi1MlywI0Ij+jF4AGVsBlANMGN3HoIUf9SVPjdo6FS9GyW\ne0TgHe+XBQKBgQChsB7RHyF3/L8+z+FxLITGjC1h8+vMGdsORPGoEMBSRKPG6Ktf\n8VUYSuOdFW+jzuTuktwTIPGsCwjCtPW1xRwSrU2jHrjot30/qrGIQ9ItN3jGDofw\nhuma61MPgB4npewrQaDwWYfVNRCS6Ec24TqIX7Ftms0tY0IZUEiOl8iPbQKBgEtW\2dlds+DpQoiHkdgi8jSz1koINBYLtx3PVO3vmNpwrSmBedE97GWSpjq1zLR2Ytk+\n/XkUpxzPrUuUzJ1lgJF6ZNhN9818/3k8y6iDV37OD/Lt39QGRtLZ9SIMLYudF4G\nHnwGohMW2YDI2d0RcPbYi32OoJIcFzmvEclT0SiBAoGBAMpH8lNt6TGRJRUa8vmr\nLu8t7lYPI2fVjdvWQZhOmKGd2YsskKDYt95OqM+dImHj5ONqN86Cqm33XQgil3AC\n92mwNX0z/n0fA0en12H5o7qwO7SjS8CIj8jfDcQkJLz9inNV0XqZHwTGxIhh8R5f\n1NVh+PLyLS4Rx7nDUrlmMJ1k\n-----END PRIVATE KEY-----\n".split(String.raw`\n`).join('\n'),
      "client_email": "firebase-adminsdk-fbsvc@valnix.iam.gserviceaccount.com"
    };

    // ───── INPUTS ─────────────────────────────────────────────────────────────
    const NEW_TOKEN = process.argv[2] || "EAAXCTJFcZAckBRNKsxI3MuVp51Mv3IQVcMC6nZCv3JvqjAxeVC1ZCmPfa4AfiJFaXSRlmIHrFalKLxo0symr2jjjC00fzogCx63GZBadtsLHtQk0JeDK7nqs1EjVPPggKjBi0QZAUXM2ZAPY0qxdtYB01G8XcVvZAQqh3PedZC0ZAgz88yYZC1wdt4hghS4RVUWgZDZD";
    const NEW_PIXEL = process.argv[3] || "843361478785940"; 
// ─────────────────────────────────────────────────────────────────────────

function base64url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getAccessToken() {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: exp,
    iat: iat
  };

  const headerB64 = base64url(JSON.stringify(header));
  const claimSetB64 = base64url(JSON.stringify(claimSet));
  const signatureInput = `${headerB64}.${claimSetB64}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signatureInput);
  const signature = signer.sign(sa.private_key, 'base64');
  const jwt = `${signatureInput}.${signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`;

  return new Promise((resolve, reject) => {
    const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data).access_token));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function updateFirestore(token) {
  // Alinhado com o que as APIs esperam: documento 'meta_capi'
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/system_credentials/meta_capi?updateMask.fieldPaths=token&updateMask.fieldPaths=pixel_id&updateMask.fieldPaths=updated_at`;
  
  const body = JSON.stringify({
    fields: {
      token: { stringValue: NEW_TOKEN },
      pixel_id: { stringValue: NEW_PIXEL },
      updated_at: { stringValue: new Date().toISOString() }
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(true);
        else reject(new Error(`Status ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  try {
    const token = await getAccessToken();
    await updateFirestore(token);
    console.log("✅ META CAPI credentials (token + pixel_id) updated successfully in Firestore!");
  } catch (err) {
    console.error("❌ Error updating token:", err.message);
    process.exit(1);
  }
}

run();
