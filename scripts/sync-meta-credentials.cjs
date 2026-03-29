const admin = require('firebase-admin');
const path = require('path');

// Service Account Credentials
const serviceAccount = require('./service-account.json');

const NEW_TOKEN = process.argv[2] || "EAAXCTJFcZAckBRNKsxI3MuVp51Mv3IQVcMC6nZCv3JvqjAxeVC1ZCmPfa4AfiJFaXSRlmIHrFalKLxo0symr2jjjC00fzogCx63GZBadtsLHtQk0JeDK7nqs1EjVPPggKjBi0QZAUXM2ZAPY0qxdtYB01G8XcVvZAQqh3PedZC0ZAgz88yYZC1wdt4hghS4RVUWgZDZD";
const NEW_PIXEL = process.argv[3] || "843361478785940";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function sync() {
  try {
    console.log(`📡 Sincronizando credenciais Meta...`);
    console.log(`- Pixel: ${NEW_PIXEL}`);
    console.log(`- Token: ${NEW_TOKEN.substring(0, 15)}...`);

    const docRef = db.collection('system_credentials').doc('meta_capi');
    await docRef.set({
      token: NEW_TOKEN,
      pixel_id: NEW_PIXEL,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log("✅ Firestore atualizado com sucesso!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao sincronizar Firestore:", error);
    process.exit(1);
  }
}

sync();
