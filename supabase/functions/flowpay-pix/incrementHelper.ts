
async function incrementFirestoreField(collection: string, docId: string, fieldName: string, amount: number = 1) {
  const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY")!);
  const accessToken = await getAccessToken(serviceAccount);
  const projectId = serviceAccount.project_id;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;

  const body = {
    writes: [
      {
        transform: {
          document: `projects/${projectId}/databases/(default)/documents/${collection}/${docId}`,
          fieldTransforms: [
            {
              fieldPath: fieldName,
              increment: { integerValue: amount.toString() }
            }
          ]
        }
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Firestore increment error: ${errorText}`);
    throw new Error(`Firestore increment failed: ${response.statusText}`);
  }
}
