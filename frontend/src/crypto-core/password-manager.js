import { stringToBuffer, bufferToString, encodeBuffer, decodeBuffer, getRandomBytes } from "./lib";
const subtle = window.crypto.subtle;
/********* Constants ********/
const PBKDF2_ITERATIONS = 100000;
// Tạo sự chậm trễ đối với việc dò mật khẩu brute-force
const VERIFIER_STRING = "keychain-verification-ok"; // Dùng để kiểm tra mật khẩu đúng

/********* Helper Functions ********/
// Hàm dẫn xuất khoá (Key Derivation)
// MEK: Master Encryption Key
// Biến mật khẩu người dùng thành một khoá bí mật
async function _deriveMEK(password, salt_b64) {
  // Mật khẩu được đưa vào dưới định dạng mà Web Crypto API yêu cầu
  const pwKey = await subtle.importKey(
    "raw",
    stringToBuffer(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  // Trả về một khoá AES-GCM 256-bit được dẫn xuất từ mật khẩu
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: decodeBuffer(salt_b64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    pwKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
// Băm dữ liệu theo SHA-256 và trả về chuỗi Base64
async function _hash(data) {
  const hashBuffer = await subtle.digest("SHA-256", stringToBuffer(data));
  return encodeBuffer(hashBuffer); // Trả về Base64 hash string
}

/********* Implementation ********/
class Keychain {
  
  /**
   * Chú ý: Constructor này chỉ nên được gọi bởi .init() và .load()
   */
  constructor(salt, keychainID, verifier, MEK, kvs = {}) {
    this.data = {
      salt: salt,         
      keychainID: keychainID, 
      verifier: verifier, // {iv: b64, ct: b64} - Dùng để check mật khẩu
      kvs: kvs            // { hash(domain): { iv: b64, ct: b64 }, ... }
    };
    this.secrets = {
      MEK: MEK            
    };
  };

  /** * Creates an empty keychain with the given password.
    */
  static async init(password) {
    const saltBuffer = getRandomBytes(16);
    const salt_b64 = encodeBuffer(saltBuffer);

    const keychainIDBuffer = getRandomBytes(16);
    const keychainID_b64 = encodeBuffer(keychainIDBuffer);

    const MEK = await _deriveMEK(password, salt_b64);

    // Tạo Password Verifier
    const verifier_iv = getRandomBytes(12);
    const verifier_ct_buf = await subtle.encrypt(
      { name: "AES-GCM", iv: verifier_iv },
      MEK,
      stringToBuffer(VERIFIER_STRING)
    );
    const verifier = {
      iv: encodeBuffer(verifier_iv),
      ct: encodeBuffer(verifier_ct_buf)
    };

    return new Keychain(salt_b64, keychainID_b64, verifier, MEK, {});
  }

  /**
    * Loads the keychain state from the provided representation (repr).
    */
  static async load(password, repr, trustedDataCheck) {
    // 1. Rollback Attack Defense
    if (trustedDataCheck) {
      const computedCheck = await _hash(repr);
      if (computedCheck !== trustedDataCheck) {
        throw new Error("Integrity check failed: Hashes do not match.");
      }
    }

    // 2. Parse data
    let parsedData;
    try {
      parsedData = JSON.parse(repr);
    } catch (e) {
      throw new Error("Failed to parse keychain data (JSON).");
    }

    if (!parsedData.salt || !parsedData.keychainID || !parsedData.verifier || typeof parsedData.kvs !== 'object') {
      throw new Error("Invalid keychain format: missing required fields.");
    }

    // 3. Derive the MEK.
    const MEK = await _deriveMEK(password, parsedData.salt);

    // 4. KIỂM TRA MẬT KHẨU (Yêu cầu mới của file test)
    // Thử giải mã verifier. Nếu thất bại -> sai mật khẩu.
    try {
      const v_iv = decodeBuffer(parsedData.verifier.iv);
      const v_ct = decodeBuffer(parsedData.verifier.ct);
      
      const pt_buf = await subtle.decrypt(
        { name: "AES-GCM", iv: v_iv },
        MEK,
        v_ct
      );

      if (bufferToString(pt_buf) !== VERIFIER_STRING) {
        throw new Error(); // Dữ liệu verifier bị hỏng
      }
    } catch (e) {
      // Bất kỳ lỗi nào ở đây (decrypt, so sánh) đều có nghĩa là mật khẩu sai
      throw new Error("Invalid password or corrupted keychain.");
    }

    // 5. Create and return the new keychain instance
    return new Keychain(parsedData.salt, parsedData.keychainID, parsedData.verifier, MEK, parsedData.kvs);
  };

  /**
    * Returns a JSON serialization.
    */ 
  async dump() {
    const repr = JSON.stringify(this.data);
    const checksum = await _hash(repr);
    return [repr, checksum];
  };

  /**
   * Helper function to generate AAD
   */
  _getAAD(name) {
    // AAD vẫn dùng tên miền (name) dạng rõ để chống swap attack
    return stringToBuffer(this.data.keychainID + name);
  }

  /**
    * Fetches the data.
    */
  async get(name) {
    // Key trong KVS là hash của tên miền
    const key = await _hash(name); 
    const entry = this.data.kvs[key];
    if (!entry) {
      return null;
    }

    try {
      const iv = decodeBuffer(entry.iv);
      const ciphertext = decodeBuffer(entry.ct);
      const aad = this._getAAD(name); // AAD vẫn dùng tên miền gốc

      const decryptedBuffer = await subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv,
          additionalData: aad
        },
        this.secrets.MEK,
        ciphertext
      );

      return bufferToString(decryptedBuffer);
    } catch (e) {
      throw new Error(`Decryption failed for domain "${name}".`);
    }
  };

  /** * Inserts or updates data.
  */
  async set(name, value) {
    const key = await _hash(name); // Dùng hash làm key
    const iv = getRandomBytes(12);
    const data = stringToBuffer(value);
    const aad = this._getAAD(name); // Dùng tên miền gốc làm AAD

    const ciphertext = await subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
        additionalData: aad
      },
      this.secrets.MEK,
      data
    );

    this.data.kvs[key] = {
      iv: encodeBuffer(iv),
      ct: encodeBuffer(ciphertext)
    };
  };

  /**
    * Removes the record.
  */
  async remove(name) {
    const key = await _hash(name); // Dùng hash làm key
    if (key in this.data.kvs) {
      delete this.data.kvs[key];
      return true;
    } else {
      return false;
    }
  };
};

export { Keychain };