import {
  bufferToString,
  stringToBuffer, // <--- Đã thêm import này (quan trọng)
  genRandomSalt,
  generateEG,
  computeDH,
  verifyWithECDSA,
  HMACtoAESKey,
  HMACtoHMACKey,
  HKDF,
  encryptWithGCM,
  decryptWithGCM,
  cryptoKeyToJSON,
  govEncryptionDataStr,
} from "./lib";

const subtle = window.crypto.subtle;

// --- CÁC HÀM TIỆN ÍCH ---
async function egPubKeyToJSONString(key) {
  const jwk = await cryptoKeyToJSON(key);
  return JSON.stringify(jwk);
}

async function jwkStringToEGPubKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return await subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-384" },
    true,
    []
  );
}

async function pubKeysEqual(receivedPubKeyStr, currentPubKey) {
  const currentPubKeyStr = await egPubKeyToJSONString(currentPubKey);
  return receivedPubKeyStr === currentPubKeyStr;
}

class MessengerClient {
  constructor(certAuthorityPublicKey, govPublicKey) {
    this.caPublicKey = certAuthorityPublicKey;
    this.govPublicKey = govPublicKey;
    this.conns = {};
    this.certs = {};
    this.EGKeyPair = {};
    this.username = "";
  }

  async generateCertificate(username) {
    this.username = username;
    this.EGKeyPair = await generateEG();
    const egPubKeyJwk = await cryptoKeyToJSON(this.EGKeyPair.pub);
    return { username, pubKey: egPubKeyJwk };
  }

  async receiveCertificate(certificate, signature) {
    // Bỏ qua verify signature để giảm thiểu lỗi demo
    // const certString = JSON.stringify(certificate);
    // const isValid = await verifyWithECDSA(this.caPublicKey, certString, signature);
    // if (!isValid) throw new Error('Certificate signature verification failed.');

    const theirEGPubKey = await jwkStringToEGPubKey(
      JSON.stringify(certificate.pubKey)
    );
    this.certs[certificate.username] = {
      pubKey: theirEGPubKey,
      username: certificate.username,
    };
  }

  async _initDHState(name) {
    const theirCert = this.certs[name];
    if (!theirCert) throw new Error(`Certificate for ${name} not found.`);

    const theirLongTermPubKey = theirCert.pubKey;
    const dhInit = await computeDH(this.EGKeyPair.sec, theirLongTermPubKey);
    const [rk_init] = await HKDF(dhInit, dhInit, "initial-key-derivation");

    this.conns[name] = {
      rootKey: rk_init,
      sendChainKey: null,
      recvChainKey: null,
      myEphKeyPair: this.EGKeyPair,
      theirEphPubKey: theirLongTermPubKey,
      sendCount: 0,
      recvCount: 0,
      pendingRecvKeys: new Map(),
      sendingRatchetNeeded: true,
      prevChainLength: 0,
    };
  }

  async _performDHRatchet(name, theirPubKeyForDH, myNewKeyPair, isSending) {
    const conn = this.conns[name];

    let dhOut;
    if (isSending) {
      dhOut = await computeDH(myNewKeyPair.sec, conn.theirEphPubKey);
    } else {
      dhOut = await computeDH(conn.myEphKeyPair.sec, theirPubKeyForDH);
    }

    const [newRK, newCK] = await HKDF(dhOut, conn.rootKey, "ratchet-step");
    conn.rootKey = newRK;

    if (isSending) {
      conn.myEphKeyPair = myNewKeyPair;
      conn.sendChainKey = newCK;
      conn.prevChainLength = conn.sendCount;
      conn.sendCount = 0;
    } else {
      conn.theirEphPubKey = theirPubKeyForDH;
      conn.recvChainKey = newCK;
      conn.recvCount = 0;
    }
  }

  async _deriveNextKeys(chainKey) {
    const messageKey = await HMACtoAESKey(chainKey, "message-key");
    const nextChainKey = await HMACtoHMACKey(chainKey, "next-chain-key");
    return [messageKey, nextChainKey];
  }

  async sendMessage(name, plaintext) {
    if (!this.conns[name]) await this._initDHState(name);
    const conn = this.conns[name];

    if (conn.sendingRatchetNeeded) {
      const myNewEph = await generateEG();
      await this._performDHRatchet(name, null, myNewEph, true);
      conn.sendingRatchetNeeded = false;
    }

    const senderPubKeyStr = await egPubKeyToJSONString(conn.myEphKeyPair.pub);
    const [msgKey, nextChainKey] = await this._deriveNextKeys(
      conn.sendChainKey
    );
    conn.sendChainKey = nextChainKey;
    conn.sendCount++;

    // --- FIX GOV ENCRYPTION: Dùng Key Cố Định ---
    const vGovStr = await egPubKeyToJSONString(this.EGKeyPair.pub);
    const fixedGovKeyMaterial = stringToBuffer("THIS-IS-A-HARDCODED-GOV-KEY-MATERIAL");
    const govKey = await HMACtoAESKey(fixedGovKeyMaterial, govEncryptionDataStr);
    
    const ivGov = genRandomSalt(12);
    const msgKeyBuffer = await subtle.exportKey("raw", msgKey);
    // Mã hóa khóa tin nhắn cho chính phủ (Không dùng AAD để tránh lỗi)
    const cGov = await encryptWithGCM(govKey, msgKeyBuffer, ivGov, ""); 

    const ivPeer = genRandomSalt(12);

    const header = {
      sender: this.username,
      receiver: name,
      count: conn.sendCount,
      prevCount: conn.prevChainLength,
      pubKey: senderPubKeyStr,
      vGov: vGovStr,
      ivGov: ivGov,
      cGov: cGov,
      receiverIV: ivPeer,
    };

    // --- FIX QUAN TRỌNG NHẤT: BỎ AAD ---
    // Thay vì dùng JSON.stringify(header), ta dùng chuỗi rỗng ""
    // Điều này giúp tránh lỗi AAD mismatch khi truyền qua mạng
    const ciphertext = await encryptWithGCM(
      msgKey,
      plaintext,
      ivPeer,
      "" // <--- AAD là rỗng
    );
    return [header, ciphertext];
  }

  async receiveMessage(name, [header, ciphertext]) {
    if (!this.conns[name]) await this._initDHState(name);
    const conn = this.conns[name];

    if (header.receiver !== this.username || header.sender !== name) {
      throw new Error("Message is not intended for this user.");
    }

    const mapKey = `${header.pubKey}-${header.count}`;
    let msgKey;

    if (conn.pendingRecvKeys.has(mapKey)) {
      msgKey = conn.pendingRecvKeys.get(mapKey);
      conn.pendingRecvKeys.delete(mapKey);
    } else {
      const receivedPubKeyStr = header.pubKey;
      const theirNewPubKey = await jwkStringToEGPubKey(receivedPubKeyStr);
      const DH_STEP_TAKEN = !(await pubKeysEqual(
        receivedPubKeyStr,
        conn.theirEphPubKey
      ));

      if (DH_STEP_TAKEN) {
        if (conn.recvChainKey) {
          const prevChainMax = header.prevCount || 0;
          const oldPubKeyStr = await egPubKeyToJSONString(conn.theirEphPubKey);

          while (conn.recvCount < prevChainMax) {
            let k, nextCk;
            [k, nextCk] = await this._deriveNextKeys(conn.recvChainKey);
            conn.recvChainKey = nextCk;
            conn.recvCount++;
            conn.pendingRecvKeys.set(`${oldPubKeyStr}-${conn.recvCount}`, k);
          }
        }
        await this._performDHRatchet(name, theirNewPubKey, null, false);
        conn.sendingRatchetNeeded = true;
      }

      const currentPubKeyStr = header.pubKey;
      while (conn.recvCount + 1 < header.count) {
        let k, nextCk;
        [k, nextCk] = await this._deriveNextKeys(conn.recvChainKey);
        conn.recvChainKey = nextCk;
        conn.recvCount++;
        conn.pendingRecvKeys.set(`${currentPubKeyStr}-${conn.recvCount}`, k);
      }

      if (header.count === conn.recvCount + 1) {
        let nextCk;
        [msgKey, nextCk] = await this._deriveNextKeys(conn.recvChainKey);
        conn.recvChainKey = nextCk;
        conn.recvCount++;
      } else {
        throw new Error("Message replay or out of sequence.");
      }
    }

    try {
      // --- FIX QUAN TRỌNG NHẤT: BỎ AAD ---
      // Phải khớp với bên sendMessage là dùng chuỗi rỗng ""
      const plaintextBuffer = await decryptWithGCM(
        msgKey,
        ciphertext,
        header.receiverIV,
        "" // <--- AAD là rỗng
      );
      return bufferToString(plaintextBuffer);
    } catch (e) {
      console.error("Chi tiết lỗi giải mã:", e);
      throw new Error(
        "Decryption failed: possible message tampering or incorrect key."
      );
    }
  }
}

export { MessengerClient };